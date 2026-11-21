import { assert, expect, it } from "@effect/vitest";
import { assertOk } from "./support/domain-setup.ts";
import {
  composition,
  placedFlowIds,
  placingGraph,
  projectComposition,
  resave,
} from "./support/subflow.ts";

it("a Duplicate into a Project keeps a placed global Flow as the original without copying it", async (c) => {
  // Arrange
  const { factory, first, parent, child } = await composition(c);
  const plan = assertOk(await factory.previewFlowDuplicate(parent.id, { projectId: first.id }));

  // Act
  const duplicate = await factory.duplicateFlow(parent.id, {
    projectId: plan.projectId,
    expectedRevision: plan.revision,
    agents: plan.agents,
    flows: plan.flows,
  });

  // Assert
  expect(plan.flows).toStrictEqual([]);
  assert(duplicate.ok);
  expect(duplicate.value.flowCopies).toStrictEqual([]);
  expect(duplicate.value.flow.graph.blocks[1]).toMatchObject({ kind: "subflow", flowId: child.id });
  expect(duplicate.value.flow.readiness.ready).toBe(true);
});

it("previewing a Project composition to Global lists the Project Flows it copies transitively, not the global Flow they place, and the Agents of every copy", async (c) => {
  // Arrange
  const { factory, root, middle, leaf, coder, releaser } = await projectComposition(c);

  // Act
  const plan = await factory.previewFlowDuplicate(root.id, { projectId: null });

  // Assert
  assert(plan.ok);
  expect(plan.value.flows.map((flow) => [flow.flowId, flow.name])).toStrictEqual([
    [middle.id, "Project middle"],
    [leaf.id, "Project leaf"],
  ]);
  expect(
    plan.value.agents.map(({ agentId, choice, changeable }) => [agentId, choice, changeable]),
  ).toStrictEqual([
    [coder.id, "keep", true],
    [releaser.id, "copy", false],
  ]);
});

it("a committed Duplicate copies each Project Flow once, resolves the loop back to the source among the copies and keeps the global Flow", async (c) => {
  // Arrange
  const { factory, root, middle, leaf, shared } = await projectComposition(c);
  const plan = assertOk(await factory.previewFlowDuplicate(root.id, { projectId: null }));

  // Act
  const duplicate = await factory.duplicateFlow(root.id, {
    projectId: null,
    expectedRevision: plan.revision,
    agents: plan.agents,
    flows: plan.flows,
  });

  // Assert
  assert(duplicate.ok);
  const copies = new Map(
    duplicate.value.flowCopies.map((copy) => [copy.sourceFlowId, copy.flowId]),
  );
  expect([...copies.keys()]).toStrictEqual([middle.id, leaf.id]);
  const rootCopy = duplicate.value.flow;
  expect(rootCopy).toMatchObject({ name: "Project root copy", projectId: null });
  expect(placedFlowIds(rootCopy.graph.blocks)).toStrictEqual([copies.get(middle.id), shared.id]);
  const middleCopy = assertOk(await factory.getFlow(copies.get(middle.id)!));
  expect(middleCopy).toMatchObject({ name: "Project middle copy", projectId: null });
  expect(placedFlowIds(middleCopy.graph.blocks)).toStrictEqual([copies.get(leaf.id), rootCopy.id]);
  expect(assertOk(await factory.getFlow(root.id)).graph).toStrictEqual(root.graph);
});

it("a Duplicate copies a missing Flow reference unchanged", async (c) => {
  // Arrange
  const { factory, first, placing } = await composition(c);
  const draft = await placing("Draft", first.id, "removed-flow", null);
  const plan = assertOk(await factory.previewFlowDuplicate(draft.id, { projectId: null }));

  // Act
  const duplicate = await factory.duplicateFlow(draft.id, {
    projectId: null,
    expectedRevision: plan.revision,
    agents: plan.agents,
    flows: plan.flows,
  });

  // Assert
  assert(duplicate.ok);
  expect(duplicate.value.flow.graph.blocks).toStrictEqual(draft.graph.blocks);
});

it("a Duplicate commit is refused as stale once a Flow the plan copies is saved again", async (c) => {
  // Arrange
  const { factory, root, leaf, shared } = await projectComposition(c);
  const plan = assertOk(await factory.previewFlowDuplicate(root.id, { projectId: null }));
  assert((await resave(factory, leaf.id, placingGraph(shared.id))).ok);

  // Act
  const duplicate = await factory.duplicateFlow(root.id, {
    projectId: null,
    expectedRevision: plan.revision,
    agents: plan.agents,
    flows: plan.flows,
  });

  // Assert
  assert(!duplicate.ok);
  expect(duplicate.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["stale_duplicate_plan", "flows"],
  ]);
});
