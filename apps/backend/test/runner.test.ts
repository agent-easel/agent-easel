import { runFactoryProcess, spawnFactoryProcess } from "./support/factory-process.ts";
import { assert, expect, it } from "@effect/vitest";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { restoreLaunches } from "./support/lifecycle-setup.ts";
import { dirname, join } from "node:path";
import { prepared } from "./support/prepared-runner.ts";
import { blockedLaterFlow, modelLessLaterFlow, projectWorkerFlow } from "./support/scenarios.ts";
import { assertOk, ownerChangedInStorage } from "./support/domain-setup.ts";

it("Start atomically deduplicates concurrent requests for the same Run", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);

  // Act
  const [one, two] = await Promise.all([f.startRun(input), f.startRun(input)]);

  // Assert
  assert(one.ok && two.ok);
  expect(one.value.id).toBe(two.value.id);
});

it("editing an Agent preserves the dispatched Run definitions", async (c) => {
  // Arrange
  const { f, t3, input, agent } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();

  // Act
  await f.updateAgent(agent.id, {
    ...agent,
    name: "Changed",
    prompt: "Changed prompt",
    expectedRevision: agent.revision,
    expectedProjectId: agent.projectId,
  });

  // Assert
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.definitions.agents[0]?.prompt).toBe("Follow repository instructions.");
  expect(t3.launches.size).toBe(1);
});

it("a lost worker launch acknowledgement recovers the same thread and execution after restart", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c);
  t3.loseLaunchReply = true;
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  await f.reconcileRuns();
  const original = [...t3.launches.values()][0]!.reference;
  await f.close();
  t3.loseLaunchReply = false;

  // Act
  const restored = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  const r = await restored.getRun(accepted.value.id);
  assert(r.ok);
  expect(r.value.runCoordinator).toBeNull();
  expect(r.value.blocks[0]?.threadId).toBe(original.threadId);
  expect(r.value.blocks[0]?.executionId).toBe(original.runId);
  expect(r.value.blocks[0]?.recovery).toBeNull();
  expect(t3.launches.size).toBe(1);
});

it("changed grant identity leaves an uncertain worker launch unresolved", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c);
  t3.loseLaunchReply = true;
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  await f.reconcileRuns();
  await f.close();
  t3.loseLaunchReply = false;
  t3.approve("different-grant");

  // Act
  const changed = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  const r = await changed.getRun(accepted.value.id);
  assert(r.ok);
  expect(r.value.runCoordinator).toBeNull();
  expect(r.value.blocks[0]?.threadId).toBeNull();
  expect(r.value.blocks[0]?.recovery).toBe("pending");
  expect(t3.launches.size).toBe(1);
});

it("runtime readiness without report support blocks Start", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c);
  t3.reportSupported = false;

  // Act
  const blocked = await f.startRun(input);

  // Assert
  assert(!blocked.ok);
  expect(t3.launches.size).toBe(0);
});

it("a fresh process cannot displace a live database owner", async (c) => {
  // Arrange
  const { h, t3, input } = await prepared(c);
  const fixturePath = join(dirname(h.databasePath), "external-engine.json");
  await writeFile(fixturePath, JSON.stringify({ input, projects: t3.projects, launches: [] }));
  // Act
  const child = runFactoryProcess(
    [
      fileURLToPath(new URL("./support/runner-process.ts", import.meta.url)),
      h.databasePath,
      fixturePath,
      "read",
    ],
    dirname(h.databasePath),
  );

  // Assert
  await expect(child).rejects.toMatchObject({
    code: 73,
    stdout: expect.stringMatching(/OWNER_REJECTED/),
  });
});

it("SIGKILL of the live owner allows recovery of an uncertain Run conversation launch reservation", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c);
  const fixturePath = join(dirname(h.databasePath), "external-engine.json");
  await writeFile(fixturePath, JSON.stringify({ input, projects: t3.projects, launches: [] }));
  function spawnChild(mode: string) {
    return spawnFactoryProcess(
      [
        fileURLToPath(new URL("./support/runner-process.ts", import.meta.url)),
        h.databasePath,
        fixturePath,
        mode,
      ],
      dirname(h.databasePath),
    );
  }
  await f.close();
  const holder = spawnChild("hold");
  await once(holder.stdout, "data");
  holder.kill("SIGKILL");
  await once(holder, "exit");
  const crash = spawnChild("crash");
  expect((await once(crash, "exit"))[0]).toBe(86);
  const external = JSON.parse(await readFile(fixturePath, "utf8"));
  restoreLaunches(t3, external.launches);

  // Act
  const recovered = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  const list = await recovered.listRuns(input.projectId);
  assert(list.ok && list.value[0]);
  const r = await recovered.getRun(list.value[0].id);
  assert(r.ok);
  expect(r.value.runCoordinator).toBeNull();
  expect(r.value.blocks[0]?.threadId).toBe("thread-1");
  expect(r.value.blocks[0]?.executionId).toBe("execution-1");
  expect(r.value.blocks[0]?.recovery).toBeNull();
  expect(t3.launches.size).toBe(1);
});

it("runtime readiness rejects a saved model option outside the permitted domain", async (c) => {
  // Arrange
  const { f, t3, project, agent } = await prepared(c);
  t3.controlledProviders[0] = {
    ...t3.controlledProviders[0]!,
    models: [
      {
        ...t3.controlledProviders[0]!.models[0]!,
        options: [
          {
            id: "reasoning",
            label: "Reasoning",
            type: "select",
            values: [false, "auto"],
            default: "auto",
          },
        ],
      },
    ],
  };
  await f.updateAgent(agent.id, {
    ...agent,
    expectedRevision: agent.revision,
    expectedProjectId: agent.projectId,
    execution: { ...agent.execution, modelOptions: [{ id: "reasoning", value: true }] },
  });

  // Act
  const rejected = await f.recheckRuntime({ projectId: project.id, agentId: agent.id });

  // Assert
  assert(rejected.ok && !rejected.value.ready);
  assert(rejected.value.issues.some((issue) => issue.code === "settings_unavailable"));
});
it("an unproven retry scope still binds the searched worker and does not launch another", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c);
  t3.loseLaunchReply = true;
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  await f.reconcileRuns();
  await f.close();
  t3.loseLaunchReply = false;
  t3.retryScope = null;

  // Act
  const changed = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  const r = await changed.getRun(accepted.value.id);
  assert(r.ok);
  expect(r.value.blocks[0]?.threadId).toBe("thread-1");
  expect(r.value.blocks[0]?.executionId).toBe("execution-1");
  expect(r.value.blocks[0]?.recovery).toBeNull();
  expect(t3.launches.size).toBe(1);
});

it("reusing a Start request key with different input is rejected", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);
  assert((await f.startRun(input)).ok);

  // Act
  const result = await f.startRun({ ...input, input: "conflicting" });

  // Assert
  assert(!result.ok);
});

it("reusing a Start request key with a different draft title is a conflict", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);
  assert((await f.startRun(input)).ok);

  // Act
  const result = await f.startRun({ ...input, title: "Renamed while uncertain" });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("conflict");
});

it("reusing a Start request key with the same content but another title provenance is a conflict", async (c) => {
  // Arrange
  const { f, input } = await prepared(c);
  assert((await f.startRun(input)).ok);

  // Act
  const result = await f.startRun({ ...input, titleProvenance: "manual" });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("conflict");
  expect(result.error.issues.map((issue) => issue.code)).toStrictEqual(["start_key_conflict"]);
});

it("Start reports all blocked later Agents while the entry Agent is ready and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, agent, project } = await prepared(c, blockedLaterFlow);
  const entry = await f.recheckRuntime({ projectId: project.id, agentId: agent.id });
  assert(entry.ok && entry.value.ready);

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map((issue) => issue.message)).toEqual([
    expect.stringContaining("Code reviewer:"),
    expect.stringContaining("Accessibility reviewer:"),
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
  expect(t3.launches.size).toBe(0);
});

it("Start refuses a Flow whose later-branch Agent Needs a model through readiness and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, modelLessLaterFlow);

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues).toStrictEqual([
    {
      code: "agent_model_required",
      path: "graph.blocks.1.agentId",
      message: "Review: Reviewer needs a model.",
    },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
  expect(t3.launches.size).toBe(0);
});

it("a Project Flow starts in its owning Project and its Run shows no owner", async (c) => {
  // Arrange
  const { f, input, project } = await prepared(c, projectWorkerFlow);

  // Act
  const started = await f.startRun(input);

  // Assert
  assert(started.ok);
  expect(started.value.definitions.flow).not.toHaveProperty("projectId");
  expect(started.value.definitions.agents[0]).not.toHaveProperty("projectId");
  expect(assertOk(await f.listRuns(project.id)).map((run) => run.id)).toStrictEqual([
    started.value.id,
  ]);
});

it("Start refuses a Project Flow in another Project and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, projectWorkerFlow);
  const other = assertOk(await f.addRepository({ path: "/repos/other" }));

  // Act
  const result = await f.startRun({ ...input, projectId: other.id });

  // Assert
  assert(!result.ok);
  expect(result.error.issues).toStrictEqual([
    {
      code: "flow_project_mismatch",
      path: "flowId",
      message: "Choose a global Flow or a Flow of the selected Project.",
    },
  ]);
  expect(await f.listRuns(other.id)).toStrictEqual({ ok: true, value: [] });
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
  expect(t3.launches.size).toBe(0);
});

it("Start refuses a Project Flow whose Project T3 no longer lists, with that reason, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, projectWorkerFlow);
  t3.projects = [];

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_project-unavailable", path: "projectId" },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("Start refuses a Project Flow whose repository directory is missing, with that reason, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, projectWorkerFlow);
  t3.projects = t3.projects.map((entry) => ({ ...entry, available: false }));

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_directory-unavailable", path: "projectId" },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("Start refuses a Project Flow while T3 is unreachable, with that reason, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, projectWorkerFlow);
  t3.available = false;

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_connection-unavailable", path: "projectId" },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("Start refuses a Project Flow after T3 switched environment, with that reason, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, projectWorkerFlow);
  t3.environmentId = "other-environment";

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_different-environment", path: "projectId" },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("Start refuses a global Flow whose Agent became a Project Agent through readiness and creates no Run", async (c) => {
  // Arrange
  const { h, f, t3, input, agent, project } = await prepared(c);
  ownerChangedInStorage(h.databasePath, { kind: "agent", id: agent.id }, project.id);

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues).toStrictEqual([
    {
      code: "agent_scope_mismatch",
      path: "graph.blocks.0.agentId",
      message: "Entry worker: Worker is a Project Agent, so this global Flow cannot place it.",
    },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
  expect(t3.launches.size).toBe(0);
});

it("an Agent owner change while Start validates is caught at acceptance and creates no Run", async (c) => {
  // Arrange
  const { h, f, t3, input, agent, project } = await prepared(c);
  t3.beforeLaunchInspection = async () => {
    ownerChangedInStorage(h.databasePath, { kind: "agent", id: agent.id }, project.id);
  };

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("conflict");
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
  expect(t3.launches.size).toBe(0);
});
