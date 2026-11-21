import { assert, expect, it } from "@effect/vitest";
import { flowInput } from "./support/scenarios.ts";
import { composition, subflowBlock } from "./support/subflow.ts";

it("a global Flow cannot place a Project Flow, and the refused save writes nothing", async (c) => {
  // Arrange
  const { factory, first, endingFlow } = await composition(c);
  const projectChild = await endingFlow("Project review", first.id);

  // Act
  const created = await factory.createFlow({
    name: "Global parent",
    graph: {
      flowInput: flowInput("inner"),
      blocks: [subflowBlock("inner", "Inner", projectChild.id)],
      connections: [],
    },
  });

  // Assert
  assert(!created.ok);
  expect(created.error.issues).toStrictEqual([
    {
      code: "flow_scope_mismatch",
      path: "graph.blocks.0.flowId",
      message: "Inner: Project review is a Project Flow, so this global Flow cannot place it.",
    },
  ]);
  const flows = await factory.listFlows();
  assert(flows.ok);
  expect(flows.value.map((flow) => flow.name)).not.toContain("Global parent");
});

it("a Project Flow places a global Flow and a Flow of its own Project", async (c) => {
  // Arrange
  const { first, endingFlow, placing } = await composition(c);
  const globalChild = await endingFlow("Shared review", null);
  const projectChild = await endingFlow("Project review", first.id);

  // Act
  const parent = await placing("Project parent", first.id, globalChild.id, projectChild.id);

  // Assert
  expect(parent.readiness).toMatchObject({ ready: true, issues: [] });
});

it("a Project Flow cannot place another Project's Flow", async (c) => {
  // Arrange
  const { factory, first, second, endingFlow } = await composition(c);
  const otherChild = await endingFlow("Other review", second.id);

  // Act
  const created = await factory.createFlow({
    name: "Project parent",
    projectId: first.id,
    graph: {
      flowInput: flowInput("inner"),
      blocks: [subflowBlock("inner", "Inner", otherChild.id)],
      connections: [],
    },
  });

  // Assert
  assert(!created.ok);
  expect(created.error.issues.map((issue) => issue.code)).toStrictEqual(["flow_scope_mismatch"]);
});

it("moving a placed Flow into a Project is refused while a global Flow places it", async (c) => {
  // Arrange
  const { factory, first, child, parent } = await composition(c);

  // Act
  const moved = await factory.changeFlowOwner(child.id, {
    expectedProjectId: null,
    projectId: first.id,
  });

  // Assert
  assert(!moved.ok);
  expect(moved.error.issues).toStrictEqual([
    {
      code: "owner_change_blocked",
      path: "projectId",
      message: `Flow "Release" (${parent.id}) places this Flow and may not place it under the new owner.`,
    },
  ]);
  expect(await factory.getFlow(child.id)).toMatchObject({ ok: true, value: { projectId: null } });
});

it("moving a Flow to Global is refused while it places a Project Flow", async (c) => {
  // Arrange
  const { factory, first, endingFlow, placing } = await composition(c);
  const projectChild = await endingFlow("Project review", first.id);
  const parent = await placing("Project parent", first.id, projectChild.id);

  // Act
  const moved = await factory.changeFlowOwner(parent.id, {
    expectedProjectId: first.id,
    projectId: null,
  });

  // Assert
  assert(!moved.ok);
  expect(moved.error.issues).toStrictEqual([
    {
      code: "owner_change_blocked",
      path: "projectId",
      message: `This Flow places Flow "Project review" (${projectChild.id}), which the new owner may not place.`,
    },
  ]);
});

it("moving a Flow into the Project of the Flow placing it is allowed", async (c) => {
  // Arrange
  const { factory, first, endingFlow, placing } = await composition(c);
  const globalChild = await endingFlow("Shared review", null);
  const parent = await placing("Project parent", first.id, globalChild.id);

  // Act
  const moved = await factory.changeFlowOwner(globalChild.id, {
    expectedProjectId: null,
    projectId: first.id,
  });

  // Assert
  assert(moved.ok);
  expect(await factory.getFlow(parent.id)).toMatchObject({
    ok: true,
    value: { readiness: { ready: true } },
  });
});

it("removing a placed Flow leaves the parent with a repairable missing reference", async (c) => {
  // Arrange
  const { factory, child, parent } = await composition(c);

  // Act
  const removed = await factory.removeFlow(child.id);

  // Assert
  assert(removed.ok);
  const reread = await factory.getFlow(parent.id);
  assert(reread.ok);
  expect(reread.value.graph.blocks[1]).toMatchObject({ kind: "subflow", flowId: child.id });
  expect(reread.value.readiness.issues).toStrictEqual([
    {
      code: "subflow_flow_missing",
      path: "graph.blocks.1.flowId",
      message: `Review: its Flow ${child.id} was removed or does not exist. Choose a saved Flow.`,
    },
  ]);
  expect(reread.value.readiness.closure?.missing).toStrictEqual([{ kind: "flow", id: child.id }]);
});
