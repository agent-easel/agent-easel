import { expect, it } from "vite-plus/test";
import type { ConditionRule, FlowBlock, FlowGraph } from "@t3-factory/contracts";
import { canvasGraph, removeBlock, replaceBlock, undoRemoval } from "../src/flow-graph.ts";

const position = { x: 0, y: 0 };

const rule = (id: string, fromArrival: number | null = null): ConditionRule => ({
  id,
  name: id,
  fromArrival,
});

const condition = (rules: readonly ConditionRule[]): Extract<FlowBlock, { kind: "condition" }> => ({
  id: "gate",
  name: "Gate",
  position,
  kind: "condition",
  rules,
  otherwise: { id: "otherwise" },
});

/** A Condition `gate` whose listed outputs each reach a Human step `next`. */
function conditionFlow(rules: readonly ConditionRule[], wired: readonly string[]): FlowGraph {
  return {
    blocks: [condition(rules), { id: "next", name: "Next", position, kind: "human" }],
    connections: wired.map((exitId) => ({ sourceBlockId: "gate", exitId, targetBlockId: "next" })),
    flowInput: { position, targetBlockIds: [] },
  };
}

it("removing a Condition rule removes its wires in the same edit and keeps the others", () => {
  // Arrange
  const graph = conditionFlow([rule("human", 3), rule("end", 2)], ["human", "end", "otherwise"]);

  // Act
  const edited = replaceBlock(graph, condition([rule("end", 2)]));

  // Assert
  expect(edited.connections.map((wire) => wire.exitId)).toStrictEqual(["end", "otherwise"]);
});

it("reordering and renaming Condition rules keeps every wire on the same rule", () => {
  // Arrange
  const graph = conditionFlow([rule("human", 3), rule("end", 5)], ["human", "end"]);

  // Act
  const edited = replaceBlock(
    graph,
    condition([
      { id: "end", name: "End branch", fromArrival: 5 },
      { id: "human", name: "Ask a person", fromArrival: 3 },
    ]),
  );

  // Assert
  expect(edited.connections).toStrictEqual(graph.connections);
});

it("a Condition with many unwired rules draws every wired rule, its first eight unwired rules and Otherwise", () => {
  // Arrange
  const rules = Array.from({ length: 20 }, (_, index) => rule(`r${index + 1}`, 21 - index));
  const graph = conditionFlow(rules, ["r15", "otherwise"]);

  // Act
  const drawn = canvasGraph(graph, []).blocks[0]!.exits.map((exit) => exit.id);

  // Assert
  expect(drawn).toStrictEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r15", "otherwise"]);
});

it("undoing a Block removal brings back its wires and keeps an edit made since", () => {
  // Arrange
  const before = conditionFlow([rule("first", 2)], ["first", "otherwise"]);
  const after = removeBlock(before, "next");
  const edited = { ...after, flowInput: { ...after.flowInput, position: { x: 90, y: 40 } } };

  // Act
  const undone = undoRemoval(edited, before, after);

  // Assert
  expect(undone.blocks.map((block) => block.id)).toStrictEqual(["gate", "next"]);
  expect(undone.connections).toStrictEqual(before.connections);
  expect(undone.flowInput.position).toStrictEqual({ x: 90, y: 40 });
});
