import { CONDITION_OTHERWISE_ID, type FlowBlock } from "@t3-factory/contracts";
import { canvasGraph, type CanvasBlock, type CanvasGraph } from "../../src/flow-graph.ts";

export function geometryGraph(): CanvasGraph {
  const block: CanvasBlock = {
    id: "target",
    name: "Target",
    kind: "human",
    position: { x: 400, y: 200 },
    exits: [],
  };
  return {
    flowInput: { position: { x: -100, y: 0 }, targetBlockIds: ["target"] },
    finish: { position: { x: 800, y: 0 }, endings: [] },
    blocks: [
      block,
      ...Array.from({ length: 9 }, (_, index): CanvasBlock => ({
        id: `source-${index}`,
        name: `Source ${index}`,
        kind: "agent",
        agentId: null,
        hiddenExitIds: [],
        localExits: [{ id: "done", name: "Done", description: "", messageRequired: false }],
        revisitInstruction: "",
        position: { x: 0, y: 0 },
        exits: [
          { id: "done", name: "Done", description: "", messageRequired: false, source: "local" },
        ],
      })),
    ],
    connections: Array.from({ length: 9 }, (_, index) => ({
      sourceBlockId: `source-${index}`,
      exitId: "done",
      targetBlockId: "target",
    })),
  };
}

const agentBlock = (id: string, exitId: string, x: number): FlowBlock => ({
  id,
  name: `Agent ${id}`,
  kind: "agent",
  agentId: null,
  hiddenExitIds: [],
  localExits: [{ id: exitId, name: `Exit ${exitId}`, description: "", messageRequired: false }],
  revisitInstruction: "",
  position: { x, y: 0 },
});

/**
 * Wires into one block from every kind of source: the Flow input listed twice, block and exit ids
 * that read alike once joined, a repeated connection, a removed exit, a Continuation, a Condition
 * and a connection to a missing block.
 */
export function wiringGraph(): CanvasGraph {
  return canvasGraph(
    {
      flowInput: { position: { x: -300, y: 0 }, targetBlockIds: ["target", "target", "a"] },
      finish: { position: { x: 800, y: 0 }, endings: [] },
      blocks: [
        { id: "target", name: "Target", kind: "human", position: { x: 600, y: 300 } },
        agentBlock("a:b", "c", 0),
        agentBlock("a", "b:c", 300),
        { id: "relay", name: "", kind: "continuation", prompt: "", position: { x: 900, y: 0 } },
        {
          id: "gate",
          name: "Gate",
          kind: "condition",
          rules: [{ id: "early", name: "Early", fromArrival: 2 }],
          otherwise: { id: CONDITION_OTHERWISE_ID },
          position: { x: 300, y: 600 },
        },
      ],
      connections: [
        { sourceBlockId: "a:b", exitId: "c", targetBlockId: "target" },
        { sourceBlockId: "a", exitId: "b:c", targetBlockId: "target" },
        { sourceBlockId: "a:b", exitId: "c", targetBlockId: "target" },
        { sourceBlockId: "relay", exitId: "output", targetBlockId: "target" },
        { sourceBlockId: "gate", exitId: CONDITION_OTHERWISE_ID, targetBlockId: "target" },
        { sourceBlockId: "a", exitId: "gone", targetBlockId: "target" },
        { sourceBlockId: "gate", exitId: "early", targetBlockId: "a" },
        { sourceBlockId: "a:b", exitId: "c", targetBlockId: "missing" },
      ],
    },
    [],
  );
}

/** Rules a Condition at the definition size limit holds with every rule wired, as the journey
 * fixture saves it. */
const SIZE_LIMIT_RULES = 4_998;

/**
 * The Run canvas's largest Condition: a worker reaching Condition `escalate`, whose every rule and
 * Otherwise reach Human step `review`, 5,000 connections in all.
 */
export function sizeLimitConditionGraph(): CanvasGraph {
  const rules = Array.from({ length: SIZE_LIMIT_RULES }, (_, index) => ({
    id: `rule-${String(index).padStart(31, "0")}`,
    name: `Route ${index + 1}`,
    fromArrival: SIZE_LIMIT_RULES - index + 1,
  }));
  return canvasGraph(
    {
      flowInput: { position: { x: 40, y: 60 }, targetBlockIds: ["worker"] },
      finish: { position: { x: 800, y: 0 }, endings: [] },
      blocks: [
        { ...agentBlock("worker", "done", 80), position: { x: 80, y: 260 } },
        {
          id: "escalate",
          name: "Escalate",
          kind: "condition",
          rules,
          otherwise: { id: CONDITION_OTHERWISE_ID },
          position: { x: 380, y: 60 },
        },
        { id: "review", name: "Review", kind: "human", position: { x: 720, y: 60 } },
      ],
      connections: [
        { sourceBlockId: "worker", exitId: "done", targetBlockId: "escalate" },
        { sourceBlockId: "escalate", exitId: CONDITION_OTHERWISE_ID, targetBlockId: "review" },
        ...rules.map((rule) => ({
          sourceBlockId: "escalate",
          exitId: rule.id,
          targetBlockId: "review",
        })),
      ],
    },
    [],
  );
}
