import { assert, expect, it } from "@effect/vitest";
import { readFlowAfterRestart } from "./support/domain-setup.ts";
import { agentBlock, connection, flowInput, waitBlock } from "./support/scenarios.ts";
import {
  composition,
  ending,
  releaseGraph,
  resave,
  reviewPanelGraph,
  savedFlow,
  subflowBlock,
  toEnding,
} from "./support/subflow.ts";

it("a Subflow placing a saved Flow keeps its reference, its exit wires by the child's ending ids and its wire into a parent ending after restart", async (c) => {
  // Arrange
  const { harness, factory, parent, child } = await composition(c);
  await factory.close();

  // Act
  const recovered = await readFlowAfterRestart(harness, parent.id);

  // Assert
  expect(recovered).toStrictEqual({ ok: true, value: parent });
  expect(parent.graph.blocks[1]).toStrictEqual({
    id: "review",
    name: "Review",
    kind: "subflow",
    flowId: child.id,
    position: { x: 300, y: 0 },
  });
  expect(parent.graph.connections.slice(1)).toStrictEqual([
    { sourceBlockId: "review", exitId: "approved", targetBlockId: "notes" },
    {
      sourceBlockId: "review",
      exitId: "needs-changes",
      targetBlockId: "finish",
      targetEndingId: "returned",
    },
  ]);
});

it("a Subflow without a Flow saves as a draft that cannot run until a Flow is chosen", async (c) => {
  // Arrange
  const { factory, parent, coder } = await composition(c);

  // Act
  const saved = await resave(factory, parent.id, releaseGraph(coder.id, null));

  // Assert
  assert(saved.ok);
  expect(saved.value.graph.blocks[1]).toMatchObject({ kind: "subflow", flowId: null });
  expect(saved.value.readiness.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["subflow_flow_required", "graph.blocks.1.flowId"],
  ]);
});

it("the Flow input can start a Subflow and an Agent, each independently, and stays ready", async (c) => {
  // Arrange
  const { factory, parent, coder, child } = await composition(c);
  const graph = releaseGraph(coder.id, child.id);

  // Act
  const saved = await resave(factory, parent.id, {
    ...graph,
    flowInput: flowInput("coder", "review"),
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.graph.flowInput.targetBlockIds).toStrictEqual(["coder", "review"]);
  expect(saved.value.readiness.ready).toBe(true);
});

it("a Wait the Flow input starts saves but reports flow_input_wait", async (c) => {
  // Arrange
  const { factory, parent, coder, child } = await composition(c);
  const graph = releaseGraph(coder.id, child.id);

  // Act
  const saved = await resave(factory, parent.id, {
    ...graph,
    flowInput: flowInput("coder", "pause"),
    blocks: [...graph.blocks, waitBlock("pause", "Cool down", { amount: 5, unit: "minutes" })],
    connections: [...graph.connections, connection("pause", "output", "notes")],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["flow_input_wait", "graph.flowInput.targetBlockIds.1"],
  ]);
});

it("a Subflow names an unknown block field as forbidden and keeps nothing", async (c) => {
  // Arrange
  const { factory, parent, coder, child } = await composition(c);
  const graph = releaseGraph(coder.id, child.id);

  // Act
  const saved = await resave(factory, parent.id, {
    ...graph,
    blocks: [
      graph.blocks[0]!,
      { ...subflowBlock("review", "Review", child.id), agentId: coder.id } as never,
      graph.blocks[2]!,
    ],
  });

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["block_overrides_forbidden", "graph.blocks.1"],
  ]);
});

it("renaming a child's ending keeps the parent's wire and readiness", async (c) => {
  // Arrange
  const { factory, parent, child, reviewer } = await composition(c);
  const graph = reviewPanelGraph(reviewer.id);

  // Act
  const renamed = await resave(factory, child.id, {
    ...graph,
    finish: {
      ...graph.finish!,
      endings: [ending("approved", "Shipped"), graph.finish!.endings[1]!],
    },
  });

  // Assert
  assert(renamed.ok);
  const reread = await factory.getFlow(parent.id);
  assert(reread.ok);
  expect(reread.value.graph.connections).toStrictEqual(parent.graph.connections);
  expect(reread.value.readiness.ready).toBe(true);
});

it("removing a child's ending, even when its old name returns under a new id, leaves the parent's wire broken and actionable", async (c) => {
  // Arrange
  const { factory, parent, child, reviewer } = await composition(c);
  const graph = reviewPanelGraph(reviewer.id);

  // Act
  const replaced = await resave(factory, child.id, {
    ...graph,
    connections: [toEnding("security", "done", "approved-2"), graph.connections[1]!],
    finish: {
      ...graph.finish!,
      endings: [ending("approved-2", "Approved"), graph.finish!.endings[1]!],
    },
  });

  // Assert
  assert(replaced.ok);
  const reread = await factory.getFlow(parent.id);
  assert(reread.ok);
  expect(reread.value.readiness.issues).toStrictEqual([
    {
      code: "subflow_exit_missing",
      path: "graph.connections.1",
      message:
        'Review: Review panel no longer has ending "approved". Wire Review to one of its current endings or remove its connection to Release notes.',
    },
  ]);
});

it("a Subflow whose Flow has no reachable ending cannot run, even with no wire leaving it", async (c) => {
  // Arrange
  const { factory, coder, endingFlow } = await composition(c);
  const endless = await endingFlow("Endless", null, {
    flowInput: flowInput("work"),
    blocks: [agentBlock("work", "Work", coder.id)],
    connections: [],
  });

  // Act
  const parent = await savedFlow(factory, {
    name: "Calls endless",
    graph: {
      flowInput: flowInput("inner"),
      blocks: [subflowBlock("inner", "Inner", endless.id)],
      connections: [],
    },
  });

  // Assert
  expect(endless.readiness.ready).toBe(true);
  expect(parent.readiness.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["subflow_ending_required", "graph.blocks.0.flowId"],
  ]);
});
