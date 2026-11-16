import { assert, expect, it } from "@effect/vitest";
import { assertOk, projectFlowToDuplicate, sampleAgentInput } from "./support/domain-setup.ts";

it("previewing a Duplicate into the source's Project lists each placed Agent once, keeps both and lets only the global Agent be copied", async (context) => {
  // Arrange
  const { factory, first, coder, releaser, flow } = await projectFlowToDuplicate(context);

  // Act
  const plan = await factory.previewFlowDuplicate(flow.id, {});

  // Assert
  expect(plan).toStrictEqual({
    ok: true,
    value: {
      flowId: flow.id,
      revision: 1,
      projectId: first.id,
      name: "Release copy",
      agents: [
        {
          agentId: coder.id,
          name: "Coder",
          projectId: null,
          revision: 1,
          choice: "keep",
          changeable: true,
        },
        {
          agentId: releaser.id,
          name: "Releaser",
          projectId: first.id,
          revision: 1,
          choice: "keep",
          changeable: false,
        },
      ],
    },
  });
});

it("previewing a Duplicate into another Project forces a copy of the source Project's Agent", async (context) => {
  // Arrange
  const { factory, second, flow } = await projectFlowToDuplicate(context);

  // Act
  const plan = await factory.previewFlowDuplicate(flow.id, { projectId: second.id });

  // Assert
  assert(plan.ok);
  expect(plan.value.projectId).toBe(second.id);
  expect(
    plan.value.agents.map(({ name, choice, changeable }) => ({ name, choice, changeable })),
  ).toStrictEqual([
    { name: "Coder", choice: "keep", changeable: true },
    { name: "Releaser", choice: "copy", changeable: false },
  ]);
});

it("a Duplicate keeping every Agent creates a new Flow in the source's Project placing the same Agents and no new Agent", async (context) => {
  // Arrange
  const { factory, first, flow } = await projectFlowToDuplicate(context);
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, {}));

  // Act
  const duplicate = await factory.duplicateFlow(flow.id, {
    expectedRevision: plan.revision,
    agents: plan.agents,
  });

  // Assert
  assert(duplicate.ok);
  expect(duplicate.value.copies).toStrictEqual([]);
  expect(duplicate.value.flow).toMatchObject({
    name: "Release copy",
    projectId: first.id,
    revision: 1,
    graph: flow.graph,
    workspace: flow.workspace,
  });
  expect(duplicate.value.flow.id).not.toBe(flow.id);
  expect(assertOk(await factory.listAgents())).toHaveLength(2);
});

it("a Duplicate into another Project copies each copied Agent once into it, retargets the new Flow and leaves the source unchanged", async (context) => {
  // Arrange
  const { factory, second, coder, releaser, flow } = await projectFlowToDuplicate(context);
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, { projectId: second.id }));
  const choices = plan.agents.map((agent) => ({ ...agent, choice: "copy" as const }));

  // Act
  const duplicate = await factory.duplicateFlow(flow.id, {
    name: "Release for the second clone",
    projectId: second.id,
    expectedRevision: plan.revision,
    agents: choices,
  });

  // Assert
  assert(duplicate.ok);
  const copies = new Map(duplicate.value.copies.map((copy) => [copy.sourceAgentId, copy.agentId]));
  expect([...copies.keys()]).toStrictEqual([coder.id, releaser.id]);
  expect(assertOk(await factory.getAgent(copies.get(coder.id)!))).toMatchObject({
    name: "Coder",
    projectId: second.id,
    revision: 1,
    prompt: coder.prompt,
    execution: coder.execution,
  });
  expect(assertOk(await factory.getAgent(copies.get(releaser.id)!)).projectId).toBe(second.id);
  expect(duplicate.value.flow).toMatchObject({
    name: "Release for the second clone",
    projectId: second.id,
  });
  expect(
    duplicate.value.flow.graph.blocks.map((block) => block.kind === "agent" && block.agentId),
  ).toStrictEqual([
    copies.get(coder.id),
    copies.get(releaser.id),
    copies.get(coder.id),
    "missing-agent",
  ]);
  expect(await factory.getFlow(flow.id)).toStrictEqual({ ok: true, value: flow });
  expect(await factory.getAgent(coder.id)).toStrictEqual({ ok: true, value: coder });
  expect(await factory.getAgent(releaser.id)).toStrictEqual({ ok: true, value: releaser });
});

it("a Duplicate that keeps an Agent the target cannot place is refused and creates nothing", async (context) => {
  // Arrange
  const { factory, second, flow } = await projectFlowToDuplicate(context);
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, { projectId: second.id }));
  const choices = plan.agents.map((agent) => ({ ...agent, choice: "keep" as const }));

  // Act
  const duplicate = await factory.duplicateFlow(flow.id, {
    projectId: second.id,
    expectedRevision: plan.revision,
    agents: choices,
  });

  // Assert
  assert(!duplicate.ok);
  expect(duplicate.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "duplicate_choice_not_allowed", path: "agents.1.choice" },
  ]);
  expect(assertOk(await factory.listFlows())).toHaveLength(1);
  expect(assertOk(await factory.listAgents())).toHaveLength(2);
});

it("a Duplicate whose plan predates a save of a placed Agent is refused as stale and creates nothing", async (context) => {
  // Arrange
  const { factory, coder, flow } = await projectFlowToDuplicate(context);
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, {}));
  assertOk(
    await factory.updateAgent(coder.id, {
      ...sampleAgentInput("Coder v2"),
      expectedRevision: coder.revision,
    }),
  );

  // Act
  const duplicate = await factory.duplicateFlow(flow.id, {
    expectedRevision: plan.revision,
    agents: plan.agents,
  });

  // Assert
  assert(!duplicate.ok);
  expect(duplicate.error.code).toBe("conflict");
  expect(duplicate.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "stale_duplicate_plan", path: "agents" },
  ]);
  expect(assertOk(await factory.listFlows())).toHaveLength(1);
});

it("a Duplicate into a Project that became unavailable after the preview is refused at commit and creates nothing", async (context) => {
  // Arrange
  const { factory, t3, second, flow } = await projectFlowToDuplicate(context);
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, { projectId: second.id }));
  t3.projects = t3.projects.filter((project) => project.projectId !== second.projectId);
  assertOk(await factory.recheckProjects());

  // Act
  const duplicate = await factory.duplicateFlow(flow.id, {
    projectId: second.id,
    expectedRevision: plan.revision,
    agents: plan.agents,
  });

  // Assert
  assert(!duplicate.ok);
  expect(duplicate.error.issues.map(({ code, path }) => ({ code, path }))).toStrictEqual([
    { code: "project_project-unavailable", path: "projectId" },
  ]);
  expect(assertOk(await factory.listFlows())).toHaveLength(1);
  expect(assertOk(await factory.listAgents())).toHaveLength(2);
});

it("a Flow of an unavailable Project is rescued into another Project with copies of its Project Agents", async (context) => {
  // Arrange
  const { factory, t3, first, second, releaser, flow } = await projectFlowToDuplicate(context);
  t3.projects = t3.projects.filter((project) => project.projectId !== first.projectId);
  assertOk(await factory.recheckProjects());
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, { projectId: second.id }));

  // Act
  const rescued = await factory.duplicateFlow(flow.id, {
    projectId: second.id,
    expectedRevision: plan.revision,
    agents: plan.agents,
  });

  // Assert
  assert(rescued.ok);
  expect(rescued.value.flow.projectId).toBe(second.id);
  const [copy] = rescued.value.copies;
  expect(copy?.sourceAgentId).toBe(releaser.id);
  expect(assertOk(await factory.getAgent(copy!.agentId)).projectId).toBe(second.id);
});

it("a Flow of an unavailable Project is rescued as a global Flow that places no out-of-rule Agent", async (context) => {
  // Arrange
  const { factory, t3, releaser, flow } = await projectFlowToDuplicate(context);
  t3.projects = [];
  assertOk(await factory.recheckProjects());
  const plan = assertOk(await factory.previewFlowDuplicate(flow.id, { projectId: null }));

  // Act
  const rescued = await factory.duplicateFlow(flow.id, {
    projectId: null,
    expectedRevision: plan.revision,
    agents: plan.agents,
  });

  // Assert
  assert(rescued.ok);
  expect(rescued.value.flow.projectId).toBeNull();
  expect(rescued.value.copies.map((copy) => copy.sourceAgentId)).toStrictEqual([releaser.id]);
  const issues = rescued.value.flow.readiness.issues.map((issue) => issue.code);
  expect(issues).not.toContain("agent_scope_mismatch");
  expect(issues).toContain("agent_required");
});
