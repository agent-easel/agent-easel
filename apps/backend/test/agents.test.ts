import { assert, expect, it } from "@effect/vitest";
import {
  assertOk,
  discoveredClones,
  openFactoryWithApprovedT3,
  readAgentAfterRestart,
  sampleAgentInput,
  savedAgentWhileCapabilitiesFail,
} from "./support/domain-setup.ts";
import { subscribe } from "./support/live.ts";
import { agentBlock, flowInput } from "./support/scenarios.ts";

const reviewExits = [
  { id: "pass", name: "pass", description: "The change is ready.", messageRequired: false },
  { id: "fail", name: "fail", description: "Corrections are needed.", messageRequired: true },
];

it("saved Agent definitions survive restart with execution settings and exits intact", async (context) => {
  // Arrange
  const { harness, factory } = await openFactoryWithApprovedT3(context);
  const saved = await factory.createAgent({ ...sampleAgentInput(), exits: reviewExits });
  assert(saved.ok);
  const { id } = saved.value;
  await factory.close();

  // Act
  const recovered = await readAgentAfterRestart(harness, id);

  // Assert
  expect(recovered.ok).toBe(true);
  expect(recovered.value.name).toBe("Coder");
  expect(recovered.value.execution).toStrictEqual(saved.value.execution);
  expect(recovered.value.exits).toStrictEqual(reviewExits);
});

it("an Agent saved without a model reads back after restart with no execution settings", async (context) => {
  // Arrange
  const { harness, factory } = await openFactoryWithApprovedT3(context);
  const created = await factory.createAgent(sampleAgentInput());
  assert(created.ok);
  const cleared = await factory.updateAgent(created.value.id, {
    ...sampleAgentInput(),
    execution: null,
    expectedRevision: created.value.revision,
    expectedProjectId: created.value.projectId,
  });
  assert(cleared.ok);
  await factory.close();

  // Act
  const recovered = await readAgentAfterRestart(harness, created.value.id);

  // Assert
  expect(recovered).toStrictEqual({ ok: true, value: cleared.value });
  expect(cleared.value).toMatchObject({ revision: 2, execution: null });
});

it("renaming an Agent exit appends a revision that keeps the exit's identity", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const saved = await factory.createAgent({ ...sampleAgentInput(), exits: reviewExits });
  assert(saved.ok);
  const renamed = [reviewExits[0], { ...reviewExits[1], name: "changes" }];

  // Act
  const updated = await factory.updateAgent(saved.value.id, {
    ...sampleAgentInput(),
    exits: renamed,
    expectedRevision: saved.value.revision,
    expectedProjectId: saved.value.projectId,
  });

  // Assert
  assert(updated.ok);
  expect(await factory.getAgent(saved.value.id)).toMatchObject({
    ok: true,
    value: { revision: 2, exits: renamed },
  });
});

it("an Agent with two exits of the same name is rejected without creating a definition", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const result = await factory.createAgent({
    ...sampleAgentInput(),
    exits: [reviewExits[0], { ...reviewExits[1], name: " pass " }],
  });

  // Assert
  assert(!result.ok);
  expect(result.error.issues[0]?.path).toBe("exits.1.name");
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("duplicateAgent copies execution settings under a new identity", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);
  const saved = await factory.createAgent(sampleAgentInput());
  assert(saved.ok);

  // Act
  const duplicate = await factory.duplicateAgent(saved.value.id, { name: "Coder variant" });

  // Assert
  assert(duplicate.ok);
  expect(duplicate.value.id).not.toBe(saved.value.id);
  expect(duplicate.value.execution).toStrictEqual(saved.value.execution);
});

it("duplicating a Project Agent into another Project creates a copy owned by the target and leaves the source as it was", async (context) => {
  // Arrange
  const { factory, first, second } = await discoveredClones(context);
  const source = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));

  // Act
  const duplicate = await factory.duplicateAgent(source.id, { projectId: second.id });

  // Assert
  assert(duplicate.ok);
  expect(duplicate.value).toMatchObject({
    name: "Releaser copy",
    revision: 1,
    projectId: second.id,
    prompt: source.prompt,
    execution: source.execution,
  });
  expect(await factory.getAgent(source.id)).toStrictEqual({ ok: true, value: source });
});

it("duplicating an Agent of an unavailable Project into its default target is refused and creates nothing", async (context) => {
  // Arrange
  const { factory, t3, first } = await discoveredClones(context);
  const source = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  t3.projects = [];
  assertOk(await factory.recheckProjects());

  // Act
  const duplicate = await factory.duplicateAgent(source.id, {});

  // Assert
  assert(!duplicate.ok);
  expect(duplicate.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_project-unavailable", path: "projectId" },
  ]);
  expect(assertOk(await factory.listAgents())).toStrictEqual([source]);
});

it("an Agent moved to another owner and back no longer reads as it did before the moves", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);
  const agent = assertOk(await factory.createAgent(sampleAgentInput("Planner")));
  assertOk(
    await factory.changeAgentOwner(agent.id, { expectedProjectId: null, projectId: first.id }),
  );

  // Act
  const back = assertOk(
    await factory.changeAgentOwner(agent.id, { expectedProjectId: first.id, projectId: null }),
  );

  // Assert
  // Live readers send only differences, so a move away and back between two reads must differ.
  const read = assertOk(await factory.getAgent(agent.id));
  expect(read).toStrictEqual(back);
  expect(read).toMatchObject({ projectId: null, revision: agent.revision });
  expect(read.updatedAt > agent.updatedAt).toBe(true);
});

it("a stale Agent save conflicts and the accepted save survives restart", async (context) => {
  // Arrange
  const { harness, factory } = await openFactoryWithApprovedT3(context);
  const saved = await factory.createAgent(sampleAgentInput());
  assert(saved.ok);
  const updated = await factory.updateAgent(saved.value.id, {
    ...sampleAgentInput("Coder updated"),
    expectedRevision: saved.value.revision,
    expectedProjectId: saved.value.projectId,
  });
  assert(updated.ok);

  // Act
  const conflict = await factory.updateAgent(saved.value.id, {
    ...sampleAgentInput("Lost edit"),
    expectedRevision: saved.value.revision,
    expectedProjectId: saved.value.projectId,
  });

  // Assert
  assert(!conflict.ok);
  expect(conflict.error.code).toBe("conflict");
  await factory.close();
  const recovered = await readAgentAfterRestart(harness, saved.value.id);
  expect(recovered.value).toMatchObject({
    name: "Coder updated",
    revision: 2,
    createdAt: saved.value.createdAt,
    updatedAt: updated.value.updatedAt,
  });
});

it("listing Agents answers from saved definitions without calling T3", async (context) => {
  // Arrange
  const { factory, t3, agent, capabilityReads } = await savedAgentWhileCapabilitiesFail(context);

  // Act
  const listed = await factory.listAgents();

  // Assert
  expect(listed).toStrictEqual({ ok: true, value: [agent] });
  expect(t3.capabilityReads).toBe(capabilityReads);
});

it("reading an Agent answers from its saved definition without calling T3", async (context) => {
  // Arrange
  const { factory, t3, agent, capabilityReads } = await savedAgentWhileCapabilitiesFail(context);

  // Act
  const read = await factory.getAgent(agent.id);

  // Assert
  expect(read).toStrictEqual({ ok: true, value: agent });
  expect(t3.capabilityReads).toBe(capabilityReads);
});

it("the Studio snapshot answers from saved definitions without calling T3", async (context) => {
  // Arrange
  const { factory, t3, agent, capabilityReads } = await savedAgentWhileCapabilitiesFail(context);

  // Act
  const [snapshot] = await subscribe(context, factory.live.watchStudio()).until(
    (messages) => messages.length > 0,
  );

  // Assert
  expect(snapshot).toStrictEqual({ _tag: "snapshot", studio: { agents: [agent], flows: [] } });
  expect(t3.capabilityReads).toBe(capabilityReads);
});

it("Agent input missing required fields is rejected without creating a definition", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const result = await factory.createAgent({ name: "x" });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("a whitespace-only Agent name is rejected without creating a definition", async (context) => {
  // Arrange
  const { factory } = await openFactoryWithApprovedT3(context);

  // Act
  const result = await factory.createAgent({ ...sampleAgentInput(), name: "   " });

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("validation");
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

it("an Agent created for a Project is a Project Agent of that Project", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);

  // Act
  const created = await factory.createAgent(sampleAgentInput("Releaser", first.id));

  // Assert
  assert(created.ok);
  expect(created.value.projectId).toBe(first.id);
  expect(assertOk(await factory.getAgent(created.value.id)).projectId).toBe(first.id);
});

it("saving a Project Agent keeps its owning Project even when the save names another", async (context) => {
  // Arrange
  const { factory, first, second } = await discoveredClones(context);
  const created = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));

  // Act
  const saved = await factory.updateAgent(created.id, {
    ...sampleAgentInput("Release manager", second.id),
    expectedRevision: created.revision,
    expectedProjectId: created.projectId,
  });

  // Assert
  assert(saved.ok);
  expect(saved.value).toMatchObject({ name: "Release manager", revision: 2, projectId: first.id });
});

it("an Agent whose owner is not a Factory Project id or null is rejected without creating a definition", async (context) => {
  // Arrange
  const { factory } = await discoveredClones(context);

  // Act
  const created = await factory.createAgent({ ...sampleAgentInput(), projectId: 7 });

  // Assert
  assert(!created.ok);
  expect(created.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "invalid_project", path: "projectId" },
  ]);
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [] });
});

/** Creates Flow `name` owned by `projectId` whose one Agent block places `agentId`. */
const flowPlacing = async (
  factory: Awaited<ReturnType<typeof discoveredClones>>["factory"],
  name: string,
  agentId: string,
  projectId: string | null,
) =>
  assertOk(
    await factory.createFlow({
      name,
      projectId,
      graph: {
        flowInput: flowInput("worker"),
        blocks: [agentBlock("worker", "Worker", agentId)],
        connections: [],
      },
    }),
  );

it("a Project Agent of an unavailable Project moves to global without a revision while its Project's Flow places it", async (context) => {
  // Arrange
  const { factory, t3, first } = await discoveredClones(context);
  const own = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  const flow = await flowPlacing(factory, "Release", own.id, first.id);
  t3.projects = t3.projects.filter((project) => project.projectId !== first.projectId);
  assertOk(await factory.recheckProjects());

  // Act
  const changed = await factory.changeAgentOwner(own.id, {
    expectedProjectId: first.id,
    projectId: null,
  });

  // Assert
  assert(changed.ok);
  expect(changed.value).toStrictEqual({
    ...own,
    projectId: null,
    updatedAt: changed.value.updatedAt,
  });
  expect(await factory.listAgents()).toStrictEqual({ ok: true, value: [changed.value] });
  expect(await factory.listFlows()).toStrictEqual({ ok: true, value: [flow] });
});

it("a global Agent moves to a Project whose Flows are the only ones placing it", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);
  const shared = assertOk(await factory.createAgent(sampleAgentInput("Releaser")));
  await flowPlacing(factory, "Release", shared.id, first.id);

  // Act
  const changed = await factory.changeAgentOwner(shared.id, {
    expectedProjectId: null,
    projectId: first.id,
  });

  // Assert
  assert(changed.ok);
  expect(changed.value).toMatchObject({ projectId: first.id, revision: shared.revision });
});

it("moving a global Agent to a Project is refused naming each global and other-Project Flow placing it", async (context) => {
  // Arrange
  const { factory, first, second } = await discoveredClones(context);
  const shared = assertOk(await factory.createAgent(sampleAgentInput("Releaser")));
  await flowPlacing(factory, "Release", shared.id, first.id);
  const hotfix = await flowPlacing(factory, "Hotfix", shared.id, second.id);
  const review = await flowPlacing(factory, "Review", shared.id, null);

  // Act
  const changed = await factory.changeAgentOwner(shared.id, {
    expectedProjectId: null,
    projectId: first.id,
  });

  // Assert
  assert(!changed.ok);
  expect(changed.error.code).toBe("conflict");
  expect(changed.error.issues).toStrictEqual([
    {
      code: "owner_change_blocked",
      path: "projectId",
      message: `Flow "Hotfix" (${hotfix.id}) places this Agent and may not place it under the new owner.`,
    },
    {
      code: "owner_change_blocked",
      path: "projectId",
      message: `Flow "Review" (${review.id}) places this Agent and may not place it under the new owner.`,
    },
  ]);
  expect(assertOk(await factory.getAgent(shared.id)).projectId).toBeNull();
});

it("moving a Project Agent to the other clone is refused naming its Project's Flow placing it", async (context) => {
  // Arrange
  const { factory, first, second } = await discoveredClones(context);
  const own = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  const release = await flowPlacing(factory, "Release", own.id, first.id);

  // Act
  const changed = await factory.changeAgentOwner(own.id, {
    expectedProjectId: first.id,
    projectId: second.id,
  });

  // Assert
  assert(!changed.ok);
  expect(changed.error.issues).toStrictEqual([
    {
      code: "owner_change_blocked",
      path: "projectId",
      message: `Flow "Release" (${release.id}) places this Agent and may not place it under the new owner.`,
    },
  ]);
  expect(assertOk(await factory.getAgent(own.id)).projectId).toBe(first.id);
});

it("changing an Agent's owner from an owner it no longer has is refused and leaves the owner", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);
  const own = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  assertOk(
    await factory.changeAgentOwner(own.id, { expectedProjectId: first.id, projectId: null }),
  );

  // Act
  const changed = await factory.changeAgentOwner(own.id, {
    expectedProjectId: first.id,
    projectId: null,
  });

  // Assert
  assert(!changed.ok);
  expect(changed.error.code).toBe("conflict");
  expect(changed.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "stale_owner", path: "expectedProjectId" },
  ]);
});

it("saving an Agent under an owner it no longer has is refused and appends no revision", async (context) => {
  // Arrange
  const { factory, first } = await discoveredClones(context);
  const own = assertOk(await factory.createAgent(sampleAgentInput("Releaser", first.id)));
  assertOk(
    await factory.changeAgentOwner(own.id, { expectedProjectId: first.id, projectId: null }),
  );

  // Act
  const saved = await factory.updateAgent(own.id, {
    ...sampleAgentInput("Release manager"),
    expectedRevision: own.revision,
    expectedProjectId: first.id,
  });

  // Assert
  assert(!saved.ok);
  expect(saved.error.code).toBe("conflict");
  expect(saved.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "stale_owner", path: "expectedProjectId" },
  ]);
  expect(assertOk(await factory.getAgent(own.id))).toMatchObject({ name: "Releaser", revision: 1 });
});
