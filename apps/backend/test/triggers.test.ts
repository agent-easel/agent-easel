import { assert, expect, it } from "@effect/vitest";
import type { TriggerSave } from "@t3-factory/contracts";
import { remotePrepared } from "./support/remote-clients.ts";
import { triggerSaved } from "./support/scenarios.ts";
import {
  atlasRepository,
  movedRepository,
  otherProjectWatcher,
  pendingTriggerUpdate,
  remoteCheckingWorld,
  remoteProject,
  reviewingWorld,
  startedIssues,
  triggerEdit,
  triggerWorld,
} from "./support/triggers.ts";

it("a new Trigger takes the default query, schedule and limit, derives its ready label and starts disabled", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger(triggerInput);

  // Assert
  assert(saved.ok);
  expect(saved.value.trigger).toMatchObject({
    kind: "github_issues",
    name: "Ready issues",
    enabled: false,
    schedule: { enabled: true, intervalMinutes: 5 },
    maxActiveRuns: 1,
    revision: 1,
    nextCheckAt: null,
    latestCheck: null,
    error: null,
    github: {
      repository: {
        host: "github.com",
        nameWithOwner: "factory-maintainer/atlas",
        nodeId: "R_atlas",
      },
      query: "label:factory:ready author:@me",
      readyLabel: "factory:ready",
    },
  });
  expect(saved.value.warnings).toStrictEqual([]);
});

it("a Trigger of an unknown kind is refused", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger({ ...triggerInput, kind: "shell_script" });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("trigger_kind");
});

it("a Trigger carrying a command is refused and nothing is saved", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger({ ...triggerInput, command: "gh issue list --json" });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]).toMatchObject({ code: "trigger_unknown_field", path: "command" });
  expect(await f.listTriggers()).toStrictEqual({ ok: true, value: [] });
});

it("a query whose label names several labels is refused with an explanation", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger({
    ...triggerInput,
    github: { ...triggerInput.github, query: "label:factory:ready,bug" },
  });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]).toMatchObject({
    code: "trigger_query_label_or",
    path: "github.query",
  });
});

it("a query GitHub rejects blocks the save with GitHub's explanation", async (c) => {
  // Arrange
  const { f, github, triggerInput } = await triggerWorld(c);
  github.failures.set("openIssues", {
    reason: "query_rejected",
    message: "The listed users cannot be searched.",
  });

  // Act
  const saved = await f.createTrigger({
    ...triggerInput,
    github: { ...triggerInput.github, query: "label:factory:ready author:nobody-here" },
  });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]).toMatchObject({
    code: "trigger_query_rejected",
    message: expect.stringContaining("The listed users cannot be searched."),
  });
  expect(await f.listTriggers()).toStrictEqual({ ok: true, value: [] });
});

it("a schedule longer than 24 hours is refused", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger({
    ...triggerInput,
    schedule: { enabled: true, intervalMinutes: 24 * 60 + 1 },
  });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("trigger_interval");
});

it("more than 10 active Runs are refused", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger({ ...triggerInput, maxActiveRuns: 11 });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("trigger_max_active_runs");
});

it("a 24-hour schedule with 10 active Runs is saved", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger({
    ...triggerInput,
    schedule: { enabled: false, intervalMinutes: 24 * 60 },
    maxActiveRuns: 10,
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.trigger).toMatchObject({
    schedule: { enabled: false, intervalMinutes: 1440 },
    maxActiveRuns: 10,
  });
});

it("a name another Trigger has, in any letter case, is refused", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);
  await triggerSaved(f, triggerInput);

  // Act
  const saved = await f.createTrigger({ ...triggerInput, name: "READY issues" });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("trigger_name_taken");
});

it("a removed Trigger's name can be used again", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);
  const removed = await triggerSaved(f, triggerInput);
  assert((await f.removeTrigger(removed.id)).ok);

  // Act
  const saved = await f.createTrigger(triggerInput);

  // Assert
  assert(saved.ok);
  expect(await f.listTriggers()).toStrictEqual({ ok: true, value: [saved.value.trigger] });
});

it("a Trigger cannot be created for a Project that has left T3", async (c) => {
  // Arrange
  const { f, t3, triggerInput } = await triggerWorld(c);
  t3.projects.catalog = [];
  assert((await f.recheckProjects()).ok);

  // Act
  const saved = await f.createTrigger(triggerInput);

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("trigger_project_unavailable");
  expect(await f.listTriggers()).toStrictEqual({ ok: true, value: [] });
});

it("a Project on a remote T3 environment is refused", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);
  const remote = await remoteProject(f);

  // Act
  const saved = await f.createTrigger({ ...triggerInput, projectId: remote.id });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("trigger_project_remote");
});

it("a Flow of another Project is refused and nothing is saved", async (c) => {
  // Arrange
  const { f, flow, triggerInput } = await triggerWorld(c);
  const other = await f.addRepository({ path: "/repos/other" });
  assert(other.ok);
  assert(
    (await f.changeFlowOwner(flow.id, { expectedProjectId: null, projectId: other.value.id })).ok,
  );

  // Act
  const saved = await f.createTrigger(triggerInput);

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("flow_project_mismatch");
  expect(await f.listTriggers()).toStrictEqual({ ok: true, value: [] });
});

it("a repository other than the Project's current one is refused", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);

  // Act
  const saved = await f.createTrigger({ ...triggerInput, github: { repositoryNodeId: "R_fork" } });

  // Assert
  assert(!saved.ok);
  expect(saved.error.code).toBe("conflict");
  expect(saved.error.issues[0]?.code).toBe("trigger_repository_mismatch");
});

it("a public repository without an author filter saves with a warning", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c, { ...atlasRepository, visibility: "public" });

  // Act
  const saved = await f.createTrigger({
    ...triggerInput,
    github: { ...triggerInput.github, query: "label:factory:ready" },
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.warnings.map((warning) => warning.code)).toStrictEqual([
    "trigger_author_filter_removed",
  ]);
});

it("a second Trigger on the same repository saves with a warning naming the first", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);
  await triggerSaved(f, triggerInput);

  // Act
  const saved = await f.createTrigger({ ...triggerInput, name: "Docs issues" });

  // Assert
  assert(saved.ok);
  expect(saved.value.warnings).toMatchObject([
    { code: "trigger_repository_shared", message: expect.stringContaining("Ready issues") },
  ]);
});

it("an edit saved from an older revision is refused and the newer settings stay", async (c) => {
  // Arrange
  const { f, triggerInput } = await triggerWorld(c);
  const trigger = await triggerSaved(f, triggerInput);
  const edit = (name: string) => ({
    ...triggerInput,
    expectedRevision: 1,
    name,
    schedule: trigger.schedule,
    maxActiveRuns: trigger.maxActiveRuns,
    github: { ...triggerInput.github, query: trigger.github.query },
  });
  assert((await f.updateTrigger(trigger.id, edit("Laptop edit"))).ok);

  // Act
  const saved = await f.updateTrigger(trigger.id, edit("Browser edit"));

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("stale_revision");
  const current = await f.getTrigger(trigger.id);
  assert(current.ok);
  expect(current.value).toMatchObject({ name: "Laptop edit", revision: 2 });
});

it("an edit from an older revision is refused as stale before the Project's moved remote is read", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  assert(
    (
      await world.f.updateTrigger(
        world.trigger.id,
        triggerEdit(world.trigger, { name: "Laptop edit" }),
      )
    ).ok,
  );
  world.github.repositories.set(world.project.workspaceRoot, movedRepository);

  // Act
  const saved = await world.f.updateTrigger(
    world.trigger.id,
    triggerEdit(world.trigger, {
      github: { repositoryNodeId: "R_atlas", query: "label:factory:ready" },
    }),
  );

  // Assert
  assert(!saved.ok);
  expect(saved.error).toMatchObject({
    code: "conflict",
    issues: [{ code: "stale_revision", path: "expectedRevision" }],
  });
});

it("reconfirming the Project's new repository with the same Project and query saves that repository", async (c) => {
  // Arrange
  const { f, github, project, triggerInput } = await triggerWorld(c);
  const trigger = await triggerSaved(f, triggerInput);
  github.repositories.set(project.workspaceRoot, movedRepository);

  // Act
  const saved = await f.updateTrigger(
    trigger.id,
    triggerEdit(trigger, {
      github: { repositoryNodeId: movedRepository.nodeId, query: trigger.github.query },
    }),
  );

  // Assert
  assert(saved.ok);
  expect(saved.value.trigger.github.repository).toStrictEqual({
    host: "github.com",
    nameWithOwner: "someone-else/atlas",
    nodeId: "R_other",
  });
});

it("reconfirming a repository the Project does not name is refused and the saved repository stays", async (c) => {
  // Arrange
  const { f, github, project, triggerInput } = await triggerWorld(c);
  const trigger = await triggerSaved(f, triggerInput);
  github.repositories.set(project.workspaceRoot, movedRepository);

  // Act
  const saved = await f.updateTrigger(
    trigger.id,
    triggerEdit(trigger, { github: { repositoryNodeId: "R_fork", query: trigger.github.query } }),
  );

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("trigger_repository_mismatch");
  expect(await f.getTrigger(trigger.id)).toStrictEqual({ ok: true, value: trigger });
});

it("an edit naming the saved repository is refused once the Project's remote names another, and the saved settings stay", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  world.github.repositories.set(world.project.workspaceRoot, movedRepository);

  // Act
  const saved = await world.f.updateTrigger(
    world.trigger.id,
    triggerEdit(world.trigger, { maxActiveRuns: 2 }),
  );

  // Assert
  assert(!saved.ok);
  expect(saved.error).toMatchObject({
    code: "conflict",
    issues: [{ code: "trigger_repository_mismatch", path: "github.repositoryNodeId" }],
  });
  expect(await world.f.getTrigger(world.trigger.id)).toStrictEqual({
    ok: true,
    value: world.trigger,
  });
});

it("an edit that leaves out the repository keeps the saved one without reading the Project's moved remote", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  world.github.repositories.set(world.project.workspaceRoot, movedRepository);
  world.github.calls.length = 0;

  // Act
  const saved = await world.f.updateTrigger(world.trigger.id, {
    ...triggerEdit(world.trigger, { maxActiveRuns: 2 }),
    github: { query: world.trigger.github.query },
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.trigger).toMatchObject({
    maxActiveRuns: 2,
    revision: world.trigger.revision + 1,
    github: { repository: { nodeId: atlasRepository.nodeId } },
  });
  expect(world.github.calls).toStrictEqual([]);
});

it("an edit whose repository node id is null is refused and the saved settings stay", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);

  // Act
  const saved = await world.f.updateTrigger(world.trigger.id, {
    ...triggerEdit(world.trigger, { maxActiveRuns: 2 }),
    github: { repositoryNodeId: null, query: world.trigger.github.query },
  });

  // Assert
  assert(!saved.ok);
  expect(saved.error).toMatchObject({
    code: "validation",
    issues: [{ path: "github.repositoryNodeId" }],
  });
  expect(await world.f.getTrigger(world.trigger.id)).toStrictEqual({
    ok: true,
    value: world.trigger,
  });
});

it("enabling with the revision a review showed is refused once a newer revision was saved, and the Trigger stays off", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  world.readyIssue(1, "Ready");
  const reviewed = world.trigger.revision;
  assert(
    (
      await world.f.updateTrigger(
        world.trigger.id,
        triggerEdit(world.trigger, { maxActiveRuns: 5 }),
      )
    ).ok,
  );

  // Act
  const enabled = await world.f.setTriggerEnabled(world.trigger.id, {
    enabled: true,
    reviewedRevision: reviewed,
  });

  // Assert
  assert(!enabled.ok);
  expect(enabled.error.code).toBe("conflict");
  expect(enabled.error.issues[0]?.code).toBe("trigger_changed");
  const current = await world.f.getTrigger(world.trigger.id);
  assert(current.ok);
  expect(current.value).toMatchObject({ enabled: false, revision: 2, nextCheckAt: null });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([]);
});

it("an edit begun while the Trigger was off is refused once the reviewed revision is enabled, and the enabled settings stay", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  const reviewed = world.trigger;
  const widening = await pendingTriggerUpdate(
    world,
    triggerEdit(reviewed, {
      github: { repositoryNodeId: reviewed.github.repository.nodeId, query: "label:factory:ready" },
    }),
  );

  // Act
  const [enabled, saved] = await Promise.all([
    world.f
      .setTriggerEnabled(reviewed.id, { enabled: true, reviewedRevision: reviewed.revision })
      .finally(widening.release),
    widening.saved,
  ]);

  // Assert
  assert(enabled.ok);
  assert(!saved.ok);
  expect(saved.error.issues[0]?.code).toBe("stale_revision");
  const current = await world.f.getTrigger(reviewed.id);
  assert(current.ok);
  expect(current.value).toMatchObject({
    enabled: true,
    revision: reviewed.revision + 1,
    github: { query: reviewed.github.query },
  });
});

it("readiness names the login @me resolves to, the Project's repository and the Flow's readiness", async (c) => {
  // Arrange
  const { f, project, flow } = await triggerWorld(c);

  // Act
  const readiness = await f.getTriggerReadiness(project.id, flow.id, "");

  // Assert
  expect(readiness).toStrictEqual({
    ok: true,
    value: {
      gitHub: { ready: true, login: "factory-maintainer" },
      repository: { ready: true, repository: atlasRepository },
      repositoryWarnings: [{ nodeId: "R_atlas", warnings: [] }],
      flow: { ready: true, issues: [] },
    },
  });
});

it("readiness for a new draft warns that other Triggers watch the Project's repository", async (c) => {
  // Arrange
  const world = await triggerWorld(c);
  await triggerSaved(world.f, world.triggerInput);
  await otherProjectWatcher(world, "Docs issues");

  // Act
  const readiness = await world.f.getTriggerReadiness(world.project.id, "", "");

  // Assert
  assert(readiness.ok);
  expect(readiness.value.repositoryWarnings).toStrictEqual([
    {
      nodeId: "R_atlas",
      warnings: [
        {
          code: "trigger_repository_shared",
          path: "projectId",
          message:
            "Triggers Docs issues, Ready issues already watch factory-maintainer/atlas. Each Trigger starts its own Runs for the issues it matches.",
        },
      ],
    },
  ]);
});

it("readiness for a Trigger's editor never names the Trigger being edited", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  await otherProjectWatcher(world, "Docs issues");

  // Act
  const readiness = await world.f.getTriggerReadiness(world.project.id, "", world.trigger.id);

  // Assert
  assert(readiness.ok);
  expect(readiness.value.repositoryWarnings).toMatchObject([
    {
      nodeId: "R_atlas",
      warnings: [
        {
          message:
            "Trigger Docs issues already watches factory-maintainer/atlas. Each Trigger starts its own Runs for the issues it matches.",
        },
      ],
    },
  ]);
});

it("readiness for a Trigger's editor still warns about its confirmed repository after the Project's remote moved", async (c) => {
  // Arrange
  const world = await reviewingWorld(c);
  await otherProjectWatcher(world, "Docs issues");
  world.github.repositories.set(world.project.workspaceRoot, movedRepository);

  // Act
  const readiness = await world.f.getTriggerReadiness(world.project.id, "", world.trigger.id);

  // Assert
  assert(readiness.ok);
  expect(readiness.value.repositoryWarnings).toMatchObject([
    { nodeId: "R_other", warnings: [] },
    {
      nodeId: "R_atlas",
      warnings: [
        {
          message:
            "Trigger Docs issues already watches factory-maintainer/atlas. Each Trigger starts its own Runs for the issues it matches.",
        },
      ],
    },
  ]);
});

it("readiness reports gh missing from the Factory host", async (c) => {
  // Arrange
  const { f, github } = await triggerWorld(c);
  github.found = false;

  // Act
  const readiness = await f.getTriggerReadiness("", "", "");

  // Assert
  assert(readiness.ok);
  expect(readiness.value).toMatchObject({
    gitHub: {
      ready: false,
      problem: expect.stringContaining("Install GitHub CLI (gh) on the Factory host"),
    },
    repository: null,
    flow: null,
  });
});

it("readiness reports gh signed out on the Factory host", async (c) => {
  // Arrange
  const { f, github, project } = await triggerWorld(c);
  github.signedIn = false;

  // Act
  const readiness = await f.getTriggerReadiness(project.id, "", "");

  // Assert
  assert(readiness.ok);
  expect(readiness.value.gitHub).toStrictEqual({
    ready: false,
    problem:
      "On the Factory host, run gh auth login --hostname github.com as the user Factory runs as.",
  });
});

it("readiness reports a repository the host's login cannot read", async (c) => {
  // Arrange
  const { f, github, project } = await triggerWorld(c);
  github.failures.set("repository", { reason: "unreadable", message: "Not Found (HTTP 404)" });

  // Act
  const readiness = await f.getTriggerReadiness(project.id, "", "");

  // Assert
  assert(readiness.ok);
  expect(readiness.value).toMatchObject({
    gitHub: { ready: true, login: "factory-maintainer" },
    repository: { ready: false, problem: expect.stringContaining("cannot read this repository") },
  });
});

it("an approved client creates a Trigger over REST that the host lists", async (c) => {
  // Arrange
  const { server, laptop, github, project, flow } = await remotePrepared(c);
  github.repositories.set(project.workspaceRoot, atlasRepository);

  // Act
  const reply = await laptop.send<TriggerSave>("POST", "/api/triggers", {
    kind: "github_issues",
    name: "Ready issues",
    projectId: project.id,
    flowId: flow.id,
    github: { repositoryNodeId: atlasRepository.nodeId },
  });

  // Assert
  expect(reply.status).toBe(201);
  assert(reply.body.ok);
  expect(await server.factory.listTriggers()).toStrictEqual({
    ok: true,
    value: [reply.body.value.trigger],
  });
});

it("a run check over REST without a body checks whatever is saved", async (c) => {
  // Arrange
  const world = await remoteCheckingWorld(c);

  // Act
  const reply = await world.send("POST", world.runPath);

  // Assert
  expect(reply.body).toMatchObject({ ok: true, value: { revision: world.trigger.revision } });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([1]);
});

it("a run check over REST with a stale expectedRevision is refused as a conflict and starts nothing", async (c) => {
  // Arrange
  const world = await remoteCheckingWorld(c);

  // Act
  const reply = await world.send("POST", world.runPath, {
    expectedRevision: world.trigger.revision - 1,
  });

  // Assert
  expect(reply.body).toMatchObject({
    ok: false,
    error: { code: "conflict", issues: [{ code: "stale_revision" }] },
  });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([]);
});

it("a run check over REST whose JSON body is null is refused and starts nothing", async (c) => {
  // Arrange
  const world = await remoteCheckingWorld(c);

  // Act
  const reply = await world.send("POST", world.runPath, null);

  // Assert
  expect(reply.body).toMatchObject({ ok: false, error: { code: "validation" } });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([]);
});

it("a run check over REST whose JSON body is an array is refused and starts nothing", async (c) => {
  // Arrange
  const world = await remoteCheckingWorld(c);

  // Act
  const reply = await world.send("POST", world.runPath, [{ expectedRevision: 2 }]);

  // Assert
  expect(reply.body).toMatchObject({ ok: false, error: { code: "validation" } });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([]);
});

it("a run check over REST whose JSON body is a number is refused and starts nothing", async (c) => {
  // Arrange
  const world = await remoteCheckingWorld(c);

  // Act
  const reply = await world.send("POST", world.runPath, 2);

  // Assert
  expect(reply.body).toMatchObject({ ok: false, error: { code: "validation" } });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([]);
});
