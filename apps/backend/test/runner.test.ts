import { runFactoryProcess, spawnFactoryProcess } from "./support/factory-process.ts";
import { changeReportSupportAtCapabilityRead } from "./support/controlled-t3-projects.ts";
import { assert, expect, it } from "@effect/vitest";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { restoreLaunches } from "./support/lifecycle-setup.ts";
import { dirname, join } from "node:path";
import { prepared } from "./support/prepared-runner.ts";
import {
  blockedLaterFlow,
  collidingEntryFlow,
  divergingLaterAgentsFlow,
  modelLessLaterFlow,
  projectWorkerFlow,
} from "./support/scenarios.ts";
import { assertOk, ownerChangedInStorage } from "./support/domain-setup.ts";
import { clearStoredExecution } from "./support/run-worker.ts";

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
    projectOverrides: [],
  });

  // Assert
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.definitions.agents[0]?.prompt).toBe("Follow repository instructions.");
  expect(t3.threads.launches.size).toBe(1);
});

it("after lost launch replies and a Run rename, restart binds each colliding worker by its frozen title", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c, collidingEntryFlow);
  t3.threads.loseLaunchReply = true;
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  await f.reconcileRuns();
  const [first, second] = [...t3.threads.launches.values()];
  assert(first && second);
  assert((await f.renameRun(accepted.value.id, { title: "Polish search" })).ok);
  await f.close();
  t3.threads.loseLaunchReply = false;

  // Act
  const restored = await h.open({ t3, connectionRetryMs: 60_000 });
  c.onTestFinished(() => restored.close());

  // Assert
  const r = await restored.getRun(accepted.value.id);
  assert(r.ok);
  expect(r.value.runCoordinator).toBeNull();
  expect(r.value.title).toBe("Polish search");
  expect([first.payload.title, second.payload.title]).toStrictEqual([
    "F#1 Entry worker (1) · Improve search",
    "F#1 Entry worker (2) · Improve search",
  ]);
  expect(
    r.value.blocks.map(({ blockId, threadId, executionId, recovery }) => [
      blockId,
      threadId,
      executionId,
      recovery,
    ]),
  ).toStrictEqual([
    ["worker", first.reference.threadId, first.reference.runId, null],
    ["second", second.reference.threadId, second.reference.runId, null],
  ]);
  expect(t3.threads.launchCalls).toBe(2);
});

it("changed grant identity leaves an uncertain worker launch unresolved", async (c) => {
  // Arrange
  const { h, f, t3, input } = await prepared(c);
  t3.threads.loseLaunchReply = true;
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  await f.reconcileRuns();
  await f.close();
  t3.threads.loseLaunchReply = false;
  t3.connection.approve("different-grant");

  // Act
  const changed = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  const r = await changed.getRun(accepted.value.id);
  assert(r.ok);
  expect(r.value.runCoordinator).toBeNull();
  expect(r.value.blocks[0]?.threadId).toBeNull();
  expect(r.value.blocks[0]?.recovery).toBe("pending");
  expect(t3.threads.launches.size).toBe(1);
});

it("runtime readiness without report support blocks Start", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c);
  t3.contract.support.reportReads = false;

  // Act
  const blocked = await f.startRun(input);

  // Assert
  assert(!blocked.ok);
  expect(t3.threads.launches.size).toBe(0);
});

it("a fresh process cannot displace a live database owner", async (c) => {
  // Arrange
  const { h, t3, input } = await prepared(c);
  const fixturePath = join(dirname(h.databasePath), "external-engine.json");
  await writeFile(
    fixturePath,
    JSON.stringify({ input, projects: t3.projects.catalog, launches: [] }),
  );
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
  await writeFile(
    fixturePath,
    JSON.stringify({ input, projects: t3.projects.catalog, launches: [] }),
  );
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
  expect(t3.threads.launches.size).toBe(1);
});

it("runtime readiness rejects a saved model option outside the permitted domain", async (c) => {
  // Arrange
  const { f, t3, project, agent } = await prepared(c);
  t3.projects.controlledProviders[0] = {
    ...t3.projects.controlledProviders[0]!,
    models: [
      {
        ...t3.projects.controlledProviders[0]!.models[0]!,
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
    projectOverrides: [],
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
  t3.threads.loseLaunchReply = true;
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  await f.reconcileRuns();
  await f.close();
  t3.threads.loseLaunchReply = false;
  t3.contract.support.launchRetryScope = null;

  // Act
  const changed = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  const r = await changed.getRun(accepted.value.id);
  assert(r.ok);
  expect(r.value.blocks[0]?.threadId).toBe("thread-1");
  expect(r.value.blocks[0]?.executionId).toBe("execution-1");
  expect(r.value.blocks[0]?.recovery).toBeNull();
  expect(t3.threads.launches.size).toBe(1);
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
  expect(t3.threads.launches.size).toBe(0);
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
  expect(t3.threads.launches.size).toBe(0);
});

it("Start reports a model-less Agent and an Agent that cannot be read, and creates no Run", async (c) => {
  // Arrange
  // The saved Flow is ready. Start's Flow read therefore passes, and only the Agent re-read can
  // see Reviewer lose its model and Missing disappear. That is the pass which used to stop at the
  // first Agent it could not read.
  const { h, f, t3, input, project } = await prepared(c, divergingLaterAgentsFlow);
  const listed = await f.listAgents();
  assert(listed.ok);
  const reviewer = listed.value.find((agent) => agent.name === "Reviewer");
  const missing = listed.value.find((agent) => agent.name === "Missing");
  assert(reviewer && missing);
  const diverge = divergeAgentsAfterFlowRead(h.databasePath, reviewer.id, missing.id);
  c.onTestFinished(diverge.restore);

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(diverge.fired(), diverge.seen().join("\n"));
  assert(!result.ok);
  expect(result.error.issues).toStrictEqual([
    {
      code: "agent_unavailable",
      path: `agents.${missing.id}`,
      message: `Agent ${missing.id}: This Agent does not exist.`,
    },
    {
      code: "agent_model_required",
      path: "graph.blocks.1.agentId",
      message: "Review: Reviewer needs a model.",
    },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
  expect(t3.threads.launches.size).toBe(0);
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
  expect(t3.threads.launches.size).toBe(0);
});

it("Start refuses a Project Flow whose Project T3 no longer lists, with that reason, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, projectWorkerFlow);
  t3.projects.catalog = [];

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
  t3.projects.catalog = t3.projects.catalog.map((entry) => ({ ...entry, available: false }));

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
  t3.connection.available = false;

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_connection-unavailable", path: "projectId" },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("Start refuses an Agent whose report support its T3 snapshot lacked, though a later check finds it, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c);
  t3.contract.support.reportReads = false;
  changeReportSupportAtCapabilityRead(t3, () => f.recheckConnection(), true);

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map(({ code }) => code)).toStrictEqual(["reporting_unsupported"]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("Start refuses with a recheck-and-retry explanation when T3's launch replay proof cannot be established, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c);
  t3.contract.support.launchProofFails = true;

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.issues).toStrictEqual([
    {
      code: "launch_unsupported",
      path: "connection.contract",
      message:
        "T3 launch capabilities are unavailable. Recheck the connection and retry this Start.",
    },
  ]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("Start refuses a Project Flow after T3 switched environment, with that reason, and creates no Run", async (c) => {
  // Arrange
  const { f, t3, input, project } = await prepared(c, projectWorkerFlow);
  t3.connection.environmentId = "other-environment";

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
  expect(t3.threads.launches.size).toBe(0);
});

it("an Agent owner change while Start validates is caught at acceptance and creates no Run", async (c) => {
  // Arrange
  const { h, f, t3, input, agent, project } = await prepared(c);
  const readCatalog = t3.projects.orchestratorCapabilities.bind(t3.projects);
  t3.projects.orchestratorCapabilities = async (target) => {
    // The Agent's readiness check reads the model catalog after Start read the Agent.
    t3.projects.orchestratorCapabilities = readCatalog;
    ownerChangedInStorage(h.databasePath, { kind: "agent", id: agent.id }, project.id);
    return readCatalog(target);
  };

  // Act
  const result = await f.startRun(input);

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("conflict");
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
  expect(t3.threads.launches.size).toBe(0);
});

/**
 * After the next unfiltered saved-Agent read (Start's Flow readiness snapshot), stores Reviewer
 * without a model and marks Missing removed. Start's later per-Agent read then sees both.
 */
function divergeAgentsAfterFlowRead(databasePath: string, reviewerId: string, missingId: string) {
  // `all` has two overloads, so the wrapper is stored as the same callable the prototype uses.
  const statements = StatementSync.prototype as unknown as { all: Function };
  const original = statements.all;
  const seen: string[] = [];
  let fired = false;
  const restore = () => {
    statements.all = original;
  };
  statements.all = function all(this: StatementSync, ...params: readonly unknown[]) {
    const sql = this.sourceSQL;
    if (sql.includes("agents")) seen.push(sql);
    const rows = original.apply(this, params) as readonly Record<string, unknown>[];
    if (
      !fired &&
      sql.includes("FROM agents") &&
      sql.includes("removed_at IS NULL") &&
      sql.includes("agent_revisions") &&
      !sql.includes("AND a.id")
    ) {
      fired = true;
      restore();
      clearStoredExecution(databasePath, reviewerId);
      const database = new DatabaseSync(databasePath);
      database.exec("PRAGMA busy_timeout = 5000");
      const updated = database
        .prepare("UPDATE agents SET removed_at = ? WHERE id = ?")
        .run("2026-11-07T08:00:00.000Z", missingId);
      database.close();
      if (updated.changes !== 1) throw new Error(`removed ${updated.changes} Agents`);
    }
    return rows;
  };
  return { restore, fired: () => fired, seen: () => seen };
}
