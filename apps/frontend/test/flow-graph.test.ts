import { expect, it } from "vite-plus/test";
import type { ConditionRule, FlowBlock, FlowGraph } from "@t3-factory/contracts";
import { conditionRoutes } from "../src/components/flow-block.tsx";
import {
  canvasGraph,
  blockExitRecipients,
  canConnect,
  exitRecipients,
  removeBlock,
  removeEnding,
  removeFinish,
  replaceBlock,
  undoRemoval,
} from "../src/flow-graph.ts";
import { wiringGraph } from "./support/geometry.ts";

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
  const undone = undoRemoval(edited, before, after, []);

  // Assert
  expect(undone.blocks.map((block) => block.id)).toStrictEqual(["gate", "next"]);
  expect(undone.connections).toStrictEqual(before.connections);
  expect(undone.flowInput.position).toStrictEqual({ x: 90, y: 40 });
});

it("undoing a Block removal brings back its wires into Finish endings unchanged", () => {
  // Arrange
  const wired = conditionFlow([rule("first", 2)], ["first"]);
  const before: FlowGraph = {
    ...wired,
    connections: [
      ...wired.connections,
      {
        sourceBlockId: "gate",
        exitId: "otherwise",
        targetBlockId: "finish",
        targetEndingId: "done",
      },
    ],
    finish: {
      position: { x: 800, y: 0 },
      endings: [
        { id: "done", name: "Done", description: "", output: "none", outputDescription: "" },
      ],
    },
  };
  const after = removeBlock(before, "gate");

  // Act
  const undone = undoRemoval(after, before, after, []);

  // Assert
  expect(undone.connections).toStrictEqual(before.connections);
  expect(undone.finish).toStrictEqual(before.finish);
});

function endingFlow(): FlowGraph {
  const wired = conditionFlow([rule("first", 2)], ["first"]);
  const ending = (id: string) => ({
    id,
    name: id,
    description: "",
    output: "none" as const,
    outputDescription: "",
  });
  return {
    ...wired,
    connections: [
      ...wired.connections,
      {
        sourceBlockId: "gate",
        exitId: "otherwise",
        targetBlockId: "finish",
        targetEndingId: "delivered",
      },
    ],
    finish: { position: { x: 800, y: 0 }, endings: [ending("delivered"), ending("blocked")] },
  };
}

it("undoing an ending removal brings the ending back in its place with its wires", () => {
  // Arrange
  const before = endingFlow();
  const after = removeEnding(before, "delivered");
  const edited = { ...after, flowInput: { ...after.flowInput, position: { x: 90, y: 40 } } };

  // Act
  const undone = undoRemoval(edited, before, after, []);

  // Assert
  expect(after.connections).toStrictEqual(before.connections.slice(0, 1));
  expect(undone.finish?.endings).toStrictEqual(before.finish?.endings);
  expect(undone.connections).toStrictEqual(before.connections);
  expect(undone.flowInput.position).toStrictEqual({ x: 90, y: 40 });
});

it("removing the Finish block takes the wires into its endings, and undo restores the saved graph in its order", () => {
  // Arrange
  const flow = endingFlow();
  const before = { ...flow, connections: [...flow.connections].reverse() };
  const after = removeFinish(before);

  // Act
  const undone = undoRemoval(after, before, after, []);

  // Assert
  expect(after).not.toHaveProperty("finish");
  expect(after.connections).toStrictEqual(before.connections.slice(1));
  expect(undone).toStrictEqual(before);
});

it("undo restores Finish without reconnecting a Condition rule deleted since its removal", () => {
  // Arrange
  const flow = endingFlow();
  const endingWire = flow.connections[1]!;
  const before = { ...flow, connections: [endingWire, { ...endingWire, exitId: "first" }] };
  const after = removeFinish(before);
  const edited = replaceBlock(after, condition([]));

  // Act
  const undone = undoRemoval(edited, before, after, []);

  // Assert
  expect(undone.finish).toStrictEqual(before.finish);
  expect(undone.connections).toStrictEqual([endingWire]);
});

it("undo restores Finish wires only for Agent exits still available after editing the block", () => {
  // Arrange
  const flow = endingFlow();
  const exits = ["keep", "hide", "local"].map((id) => ({
    id,
    name: id,
    description: "",
    messageRequired: false,
  }));
  const agent = { id: "agent", exits: exits.slice(0, 2) };
  const block = {
    id: "worker",
    name: "Worker",
    position,
    kind: "agent",
    agentId: agent.id,
    hiddenExitIds: [],
    localExits: exits.slice(2),
    revisitInstruction: "",
    revisitContext: "keep",
  } as const satisfies FlowBlock;
  const connections = exits.map(({ id }) => ({
    ...flow.connections[1]!,
    sourceBlockId: block.id,
    exitId: id,
  }));
  const before = { ...flow, blocks: [block], connections };
  const after = removeFinish(before);
  const edited = replaceBlock(after, { ...block, hiddenExitIds: ["hide"], localExits: [] });

  // Act
  const undone = undoRemoval(edited, before, after, [agent]);

  // Assert
  expect(undone.connections).toStrictEqual(connections.slice(0, 1));
});

it("an exit reaches each ending at most once, and the Flow input reaches no ending", () => {
  // Arrange
  const graph = endingFlow();
  const otherwise = { kind: "exit", sourceBlockId: "gate", exitId: "otherwise" } as const;

  // Act
  const reachable = {
    wired: canConnect(graph, otherwise, { targetBlockId: "finish", targetEndingId: "delivered" }),
    open: canConnect(graph, otherwise, { targetBlockId: "finish", targetEndingId: "blocked" }),
    missing: canConnect(graph, otherwise, { targetBlockId: "finish", targetEndingId: "gone" }),
    flowInput: canConnect(
      graph,
      { kind: "flow-input" },
      { targetBlockId: "finish", targetEndingId: "blocked" },
    ),
  };

  // Assert
  expect(reachable).toStrictEqual({ wired: false, open: true, missing: false, flowInput: false });
});

it("each exit's recipients follow connection order, and a missing target has no name", () => {
  // Arrange
  const graph = wiringGraph();

  // Act
  const recipients = exitRecipients(graph);

  // Assert
  expect(recipients("a:b", "c")).toStrictEqual(["Target", "Target", undefined]);
  expect(recipients("a", "b:c")).toStrictEqual(["Target"]);
  expect(recipients("gate", "early")).toStrictEqual(["Agent a"]);
  expect(recipients("gate", "otherwise")).toStrictEqual(["Target"]);
  expect(recipients("a", "unwired")).toStrictEqual([]);
});

it("one block's recipients follow connection order and leave out other blocks' exits", () => {
  // Arrange
  const graph = wiringGraph();

  // Act
  const recipients = blockExitRecipients(graph, "a:b");

  // Assert
  expect(recipients("c")).toStrictEqual(["Target", "Target", undefined]);
  expect(recipients("b:c")).toStrictEqual([]);
  expect(recipients("unwired")).toStrictEqual([]);
});

it("a Condition output's row reads its rule's first arrival, a draft rule's missing number or Otherwise's fallback", () => {
  // Arrange
  const block = condition([rule("late", 12_345), rule("draft"), rule("late", 1)]);

  // Act
  const route = conditionRoutes(block);

  // Assert
  expect(route("late")).toBe("from arrival 12,345 onward");
  expect(route("draft")).toBe("no arrival number yet");
  expect(route("otherwise")).toBe("when no rule matches");
});
