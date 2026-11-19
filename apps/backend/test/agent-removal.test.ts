import { assert, expect, it } from "@effect/vitest";
import { assertOk, discoveredClones, sampleAgentInput } from "./support/domain-setup.ts";
import { agentBlock, flowInput } from "./support/scenarios.ts";
import { prepared } from "./support/prepared-runner.ts";
import { triggerWorld } from "./support/triggers.ts";

it("removing an unused Agent deletes the definition", async (c) => {
  // Arrange
  const { f } = await prepared(c);
  const saved = await f.createAgent(sampleAgentInput());
  assert(saved.ok);

  // Act
  const removed = await f.removeAgent(saved.value.id);

  // Assert
  assert(removed.ok);
  const missing = await f.getAgent(saved.value.id);
  assert(!missing.ok);
  expect(missing.error.code).toBe("not_found");
});

it("removing an Agent referenced by a saved Flow is rejected and keeps the definition", async (c) => {
  // Arrange
  const { f, agent } = await prepared(c);

  // Act
  const removed = await f.removeAgent(agent.id);

  // Assert
  assert(!removed.ok);
  expect(removed.error.code).toBe("conflict");
  expect(removed.error.message).toMatch(/saved Flows/i);
  assert((await f.getAgent(agent.id)).ok);
});

it("removing an Agent after its Flow was removed preserves the Run definitions", async (c) => {
  // Arrange
  const { f, input, flow, agent } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  assert((await f.removeFlow(flow.id)).ok);

  // Act
  const removed = await f.removeAgent(agent.id);

  // Assert
  assert(removed.ok);
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.definitions.agents.some((item) => item.id === agent.id)).toBe(true);
  assert(!(await f.getAgent(agent.id)).ok);
});

it("removing a Flow preserves its active Run definitions and shared Agent", async (c) => {
  // Arrange
  const { f, input, flow, agent } = await prepared(c);
  const started = await f.startRun(input);
  assert(started.ok);
  await f.reconcileRuns();

  // Act
  const removed = await f.removeFlow(flow.id);

  // Assert
  assert(removed.ok);
  const missing = await f.getFlow(flow.id);
  assert(!missing.ok);
  expect(missing.error.code).toBe("not_found");
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("active");
  expect(run.value.gateOpen).toBe(true);
  expect(run.value.definitions).toStrictEqual(started.value.definitions);
  assert((await f.getAgent(agent.id)).ok);
});

it("removing a Flow a Trigger starts is refused until that Trigger is removed", async (c) => {
  // Arrange
  const { f, flow, triggerInput } = await triggerWorld(c);
  const saved = await f.createTrigger(triggerInput);
  assert(saved.ok);

  // Act
  const refused = await f.removeFlow(flow.id);

  // Assert
  assert(!refused.ok);
  expect(refused.error).toMatchObject({
    code: "conflict",
    issues: [
      {
        code: "flow_in_use",
        path: "flowId",
        message: `Trigger "Ready issues" (${saved.value.trigger.id}) starts this Flow.`,
      },
    ],
  });
  assert((await f.getFlow(flow.id)).ok);
  assert((await f.removeTrigger(saved.value.trigger.id)).ok);
  expect(await f.removeFlow(flow.id)).toStrictEqual({ ok: true, value: undefined });
});

it("a removed Flow rejects saves without being recreated and removing it again succeeds", async (c) => {
  // Arrange
  const { f, flow } = await prepared(c);
  assert((await f.removeFlow(flow.id)).ok);

  // Act
  const saved = await f.updateFlow(flow.id, {
    ...flow,
    expectedRevision: flow.revision,
    expectedProjectId: flow.projectId,
  });
  const removedAgain = await f.removeFlow(flow.id);

  // Assert
  assert(!saved.ok);
  expect(saved.error.code).toBe("not_found");
  expect(removedAgain).toStrictEqual({ ok: true, value: undefined });
  expect(await f.listFlows()).toStrictEqual({ ok: true, value: [] });
});

it("starting a removed Flow is rejected without creating a Run", async (c) => {
  // Arrange
  const { f, input, flow } = await prepared(c);
  assert((await f.removeFlow(flow.id)).ok);

  // Act
  const started = await f.startRun(input);

  // Assert
  assert(!started.ok);
  expect(started.error.code).toBe("not_found");
  expect(await f.listRunNavigation()).toStrictEqual({ ok: true, value: [] });
});

it("a removed Agent rejects saves, leaves the catalog and removing it again succeeds", async (c) => {
  // Arrange
  const { f } = await prepared(c);
  const saved = await f.createAgent(sampleAgentInput("Retired"));
  assert(saved.ok);
  assert((await f.removeAgent(saved.value.id)).ok);

  // Act
  const edited = await f.updateAgent(saved.value.id, {
    ...sampleAgentInput("Revived"),
    expectedRevision: saved.value.revision,
    expectedProjectId: saved.value.projectId,
    projectOverrides: [],
  });
  const duplicated = await f.duplicateAgent(saved.value.id, {});
  const removedAgain = await f.removeAgent(saved.value.id);

  // Assert
  assert(!edited.ok);
  expect(edited.error.code).toBe("not_found");
  assert(!duplicated.ok);
  expect(duplicated.error.code).toBe("not_found");
  expect(removedAgain).toStrictEqual({ ok: true, value: undefined });
  const listed = await f.listAgents();
  assert(listed.ok);
  expect(listed.value.some((agent) => agent.id === saved.value.id)).toBe(false);
});

it("an Agent of a Project that became unavailable can be removed", async (c) => {
  // Arrange
  const { factory, t3, first } = await discoveredClones(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  t3.projects = [];
  assertOk(await factory.recheckProjects());

  // Act
  const removed = await factory.removeAgent(agent.id);

  // Assert
  assert(removed.ok);
  const missing = await factory.getAgent(agent.id);
  assert(!missing.ok);
  expect(missing.error.code).toBe("not_found");
});

it("an Agent placed by a Flow of an unavailable Project is still refused as in use", async (c) => {
  // Arrange
  const { factory, t3, first } = await discoveredClones(c);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  const flow = assertOk(
    await factory.createFlow({
      name: "Release",
      projectId: first.id,
      graph: {
        flowInput: flowInput("release"),
        blocks: [agentBlock("release", "Release", agent.id)],
        connections: [],
      },
    }),
  );
  t3.projects = [];
  assertOk(await factory.recheckProjects());

  // Act
  const removed = await factory.removeAgent(agent.id);

  // Assert
  assert(!removed.ok);
  expect(removed.error.issues).toStrictEqual([
    {
      code: "agent_in_use",
      path: "agentId",
      message: `Flow "Release" (${flow.id}) places this Agent.`,
    },
  ]);
});
