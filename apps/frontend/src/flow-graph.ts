import type { CanvasGraph, WireSource } from "@t3-factory/flow-layout";
import {
  CONDITION_OTHERWISE_ID,
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type FlowBlock,
  type FlowConnection,
  type FlowEnding,
  type FlowGraph,
  type RunDefinitions,
} from "@t3-factory/contracts";
import {
  connectionKey,
  continuationSources,
  effectiveExits,
  type EffectiveExit,
} from "@t3-factory/domain-validation";
import { randomId } from "@/lib/ids";

export type BlockPosition = FlowBlock["position"];

const uid = randomId;

export { canvasGraph, type CanvasBlock, type CanvasGraph } from "@t3-factory/flow-layout";
/** The exits a Run's block offered: its captured Flow revision with its captured Agent revisions. */
export function capturedExits(
  definitions: RunDefinitions,
  blockId: string,
): readonly EffectiveExit[] {
  const block = definitions.flow.graph.blocks.find((item) => item.id === blockId);
  return block ? effectiveExits(block, definitions.agents) : [];
}

const DEFAULT_BLOCK_NAMES: Record<FlowBlock["kind"], string> = {
  agent: "Agent block",
  human: "Human step",
  wait: "Wait",
  continuation: "Continuation",
  condition: "Condition",
};

/** Without a drop position, new blocks fill a three-column grid right of the Flow input. */
export function newBlock(
  graph: FlowGraph,
  kind: FlowBlock["kind"],
  agent?: AgentDefinition,
  position?: BlockPosition,
): FlowBlock {
  const base = {
    id: uid(),
    name: agent?.name ?? DEFAULT_BLOCK_NAMES[kind],
    position: position ?? {
      x: 320 + (graph.blocks.length % 3) * 300,
      y: Math.min(10000, 50 + Math.floor(graph.blocks.length / 3) * 220),
    },
  };
  if (kind === "agent")
    return {
      ...base,
      kind,
      agentId: agent?.id ?? null,
      hiddenExitIds: [],
      localExits: [],
      revisitInstruction: "",
    };
  if (kind === "wait") return { ...base, kind, duration: null };
  if (kind === "condition")
    return { ...base, kind, rules: [], otherwise: { id: CONDITION_OTHERWISE_ID } };
  return kind === "continuation" ? { ...base, kind, prompt: "" } : { ...base, kind };
}

/** The exits a block owns in this Flow and an edit can remove: Agent local exits and Condition
 * rule outputs. */
function removableExitIds(block: FlowBlock | undefined): readonly string[] {
  if (block?.kind === "agent") return block.localExits.map((exit) => exit.id);
  if (block?.kind === "condition") return block.rules.map((rule) => rule.id);
  return [];
}

/** Replaces a block; wires from a local exit or Condition rule the edit removed go with it. */
export function replaceBlock(graph: FlowGraph, next: FlowBlock): FlowGraph {
  const previous = graph.blocks.find((block) => block.id === next.id);
  const kept = new Set(removableExitIds(next));
  const removed = new Set(removableExitIds(previous).filter((id) => !kept.has(id)));
  return {
    ...graph,
    blocks: graph.blocks.map((block) => (block.id === next.id ? next : block)),
    connections: graph.connections.filter(
      (wire) => wire.sourceBlockId !== next.id || !removed.has(wire.exitId),
    ),
  };
}

/**
 * A wire on the canvas: an exit's connection, or the Flow input reaching one of its
 * targets. Wires have no id; a source reaching a target is the identity.
 */
export type FlowWire = {
  readonly source: WireSource;
  readonly targetBlockId: string;
  readonly targetEndingId?: string;
};

export function connectionWire(connection: FlowConnection): FlowWire {
  const { sourceBlockId, exitId, targetBlockId, targetEndingId } = connection;
  return {
    source: { kind: "exit", sourceBlockId, exitId },
    targetBlockId,
    ...(targetEndingId ? { targetEndingId } : {}),
  };
}

function wireConnection(
  source: { readonly sourceBlockId: string; readonly exitId: string },
  { targetBlockId, targetEndingId }: FlowWire,
): Parameters<typeof connectionKey>[0] {
  return {
    sourceBlockId: source.sourceBlockId,
    exitId: source.exitId,
    targetBlockId,
    targetEndingId,
  };
}

export function sameWire(a: FlowWire, b: FlowWire) {
  if (a.source.kind === "flow-input" || b.source.kind === "flow-input")
    return (
      a.source.kind === b.source.kind &&
      a.targetBlockId === b.targetBlockId &&
      a.targetEndingId === b.targetEndingId
    );
  return connectionKey(wireConnection(a.source, a)) === connectionKey(wireConnection(b.source, b));
}

/** A node on the canvas: one block, the Flow input block or the Finish block. */
export type CanvasNode =
  | { readonly kind: "block"; readonly blockId: string }
  | { readonly kind: "flow-input" }
  | { readonly kind: "finish" };

export function sameNode(a: CanvasNode | null, b: CanvasNode | null) {
  if (a?.kind === "block" && b?.kind === "block") return a.blockId === b.blockId;
  return a?.kind === b?.kind;
}

/** Whether a wire leaves the node: from any of a block's exits, or from the Flow input. Nothing
 * leaves the Finish block. */
export function leavesNode(wire: FlowWire, node: CanvasNode) {
  if (node.kind === "finish") return false;
  if (node.kind === "flow-input") return wire.source.kind === "flow-input";
  return wire.source.kind === "exit" && wire.source.sourceBlockId === node.blockId;
}

export function hasWire(graph: FlowGraph, wire: FlowWire) {
  if (wire.source.kind === "flow-input")
    return graph.flowInput.targetBlockIds.includes(wire.targetBlockId);
  return graph.connections.some((c) => sameWire(connectionWire(c), wire));
}

/** Where a wire ends: a block's input, or one ending of the Finish block. */
export type WireTarget = Pick<FlowWire, "targetBlockId" | "targetEndingId">;

/**
 * Whether `source` may gain a wire to the target: any block or existing ending for an exit, only
 * Agent blocks for the Flow input (never a Human step, a Continuation or an ending), and never a
 * target the source already reaches.
 */
export function canConnect(graph: FlowGraph, source: WireSource, target: WireTarget) {
  if (hasWire(graph, { source, ...target })) return false;
  if (target.targetBlockId === FINISH_BLOCK_ID)
    return (
      source.kind === "exit" &&
      graph.finish.endings.some((ending) => ending.id === target.targetEndingId)
    );
  const block = graph.blocks.find((b) => b.id === target.targetBlockId);
  if (!block) return false;
  return source.kind === "exit" || block.kind === "agent";
}

export function addWire<G extends FlowGraph | CanvasGraph>(
  graph: G,
  { source, targetBlockId, targetEndingId }: FlowWire,
): G {
  if (source.kind === "flow-input")
    return {
      ...graph,
      flowInput: {
        ...graph.flowInput,
        targetBlockIds: [...graph.flowInput.targetBlockIds, targetBlockId],
      },
    };
  const { sourceBlockId, exitId } = source;
  return {
    ...graph,
    connections: [
      ...graph.connections,
      { sourceBlockId, exitId, targetBlockId, ...(targetEndingId ? { targetEndingId } : {}) },
    ],
  };
}

export function removeWire(graph: FlowGraph, wire: FlowWire): FlowGraph {
  if (wire.source.kind === "flow-input")
    return {
      ...graph,
      flowInput: {
        ...graph.flowInput,
        targetBlockIds: graph.flowInput.targetBlockIds.filter((id) => id !== wire.targetBlockId),
      },
    };
  return {
    ...graph,
    connections: graph.connections.filter((c) => !sameWire(connectionWire(c), wire)),
  };
}

export function removeBlock(graph: FlowGraph, blockId: string): FlowGraph {
  return {
    ...graph,
    blocks: graph.blocks.filter((b) => b.id !== blockId),
    connections: graph.connections.filter(
      (c) => c.sourceBlockId !== blockId && c.targetBlockId !== blockId,
    ),
    flowInput: {
      ...graph.flowInput,
      targetBlockIds: graph.flowInput.targetBlockIds.filter((id) => id !== blockId),
    },
  };
}

/** A new ending at the end of the list: no name or output yet. */
export function addEnding(graph: FlowGraph): FlowGraph {
  const ending: FlowEnding = {
    id: uid(),
    name: "",
    description: "",
    output: "none",
    outputDescription: "",
  };
  return { ...graph, finish: { ...graph.finish, endings: [...graph.finish.endings, ending] } };
}

/** Replaces an ending in place; its wires enter by id, so a rename keeps them. */
export function replaceEnding(graph: FlowGraph, next: FlowEnding): FlowGraph {
  return {
    ...graph,
    finish: {
      ...graph.finish,
      endings: graph.finish.endings.map((ending) => (ending.id === next.id ? next : ending)),
    },
  };
}

/** Removes an ending and, in the same edit, every wire into it. */
export function removeEnding(graph: FlowGraph, endingId: string): FlowGraph {
  return {
    ...graph,
    finish: {
      ...graph.finish,
      endings: graph.finish.endings.filter((ending) => ending.id !== endingId),
    },
    connections: graph.connections.filter(
      (c) => c.targetBlockId !== FINISH_BLOCK_ID || c.targetEndingId !== endingId,
    ),
  };
}

/**
 * The endings a removal took, back in their former places: each goes in after the nearest
 * ending that preceded it and still exists, or first.
 */
function restoredEndings(
  current: readonly FlowEnding[],
  before: readonly FlowEnding[],
  after: readonly FlowEnding[],
) {
  const endings = [...current];
  const has = (list: readonly FlowEnding[], id: string) => list.some((e) => e.id === id);
  before.forEach((ending, index) => {
    if (has(after, ending.id) || has(endings, ending.id)) return;
    const previous = before.slice(0, index).findLast((candidate) => has(endings, candidate.id));
    const at = previous ? endings.findIndex((e) => e.id === previous.id) + 1 : 0;
    endings.splice(at, 0, ending);
  });
  return endings;
}

/**
 * The thread a Continuation continues, as its block and details name it: the one Agent before
 * it, or the incoming Agent's when several can reach it; null when no Agent precedes it.
 */
export function continuedThread(graph: FlowGraph, blockId: string): string | null {
  const sources = continuationSources(graph, blockId);
  if (sources.length > 1) return "the incoming Agent's thread";
  const agent = graph.blocks.find((block) => block.id === sources[0]);
  return agent ? `${agent.name || "Unnamed block"}'s thread` : null;
}

/** How an exit row names one wire's target: a block's name, or "Finish · <ending>"; undefined
 * for a target the graph lacks. */
function recipientNames(graph: FlowGraph) {
  const names = new Map<string, string>();
  for (const block of graph.blocks) if (!names.has(block.id)) names.set(block.id, block.name);
  const endings = new Map<string, string>();
  for (const ending of graph.finish.endings)
    if (!endings.has(ending.id)) endings.set(ending.id, ending.name);
  return ({ targetBlockId, targetEndingId }: FlowConnection) => {
    if (targetBlockId !== FINISH_BLOCK_ID) return names.get(targetBlockId);
    const ending = endings.get(targetEndingId ?? "");
    return ending === undefined ? undefined : `Finish · ${ending || "Unnamed ending"}`;
  };
}

/**
 * The names of the targets each exit's connections reach, in graph order, indexed once per graph
 * since a canvas asks for every exit row: a block's name, or "Finish · <ending>".
 */
export function exitRecipients(graph: FlowGraph) {
  const name = recipientNames(graph);
  const recipients = new Map<string, (string | undefined)[]>();
  for (const connection of graph.connections) {
    const key = JSON.stringify([connection.sourceBlockId, connection.exitId]);
    const list = recipients.get(key) ?? [];
    list.push(name(connection));
    recipients.set(key, list);
  }
  return (blockId: string, exitId: string): readonly (string | undefined)[] =>
    recipients.get(JSON.stringify([blockId, exitId])) ?? [];
}

/**
 * The names of the targets each of one block's exits reaches, in graph order: a single pass that
 * keeps only that block's connections, for views that show one block rather than the whole canvas.
 */
export function blockExitRecipients(graph: FlowGraph, blockId: string) {
  const name = recipientNames(graph);
  const recipients = new Map<string, (string | undefined)[]>();
  for (const connection of graph.connections) {
    if (connection.sourceBlockId !== blockId) continue;
    const list = recipients.get(connection.exitId) ?? [];
    list.push(name(connection));
    recipients.set(connection.exitId, list);
  }
  return (exitId: string): readonly (string | undefined)[] => recipients.get(exitId) ?? [];
}

/**
 * Undoes a removal that turned `before` into `after` on the current graph: blocks, endings and
 * wires the removal took come back, edits made since are kept, and a wire returns only while both
 * its ends exist; a wire into Finish needs its ending.
 */
export function undoRemoval(current: FlowGraph, before: FlowGraph, after: FlowGraph): FlowGraph {
  const has = (graph: FlowGraph, id: string) => graph.blocks.some((b) => b.id === id);
  const blocks = [
    ...current.blocks,
    ...before.blocks.filter((b) => !has(after, b.id) && !has(current, b.id)),
  ];
  const endings = restoredEndings(
    current.finish.endings,
    before.finish.endings,
    after.finish.endings,
  );
  const exists = (id: string) => blocks.some((b) => b.id === id);
  const targetExists = ({ targetBlockId, targetEndingId }: FlowWire) =>
    targetBlockId === FINISH_BLOCK_ID
      ? endings.some((ending) => ending.id === targetEndingId)
      : exists(targetBlockId);
  const restored = (graph: FlowGraph, wire: FlowWire) =>
    !hasWire(after, wire) && !hasWire(graph, wire) && targetExists(wire);
  let next: FlowGraph = { ...current, blocks, finish: { ...current.finish, endings } };
  for (const targetBlockId of before.flowInput.targetBlockIds) {
    const wire: FlowWire = { source: { kind: "flow-input" }, targetBlockId };
    if (restored(next, wire)) next = addWire(next, wire);
  }
  for (const connection of before.connections) {
    const wire = connectionWire(connection);
    if (exists(connection.sourceBlockId) && restored(next, wire)) next = addWire(next, wire);
  }
  return next;
}
