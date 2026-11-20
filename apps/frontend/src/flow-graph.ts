import type { CanvasGraph, WireSource } from "@t3-factory/flow-layout";
import {
  CONDITION_OTHERWISE_ID,
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type FlowBlock,
  type FlowConnection,
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

/** A node on the canvas: one block, or the Flow input block. */
export type CanvasNode =
  | { readonly kind: "block"; readonly blockId: string }
  | { readonly kind: "flow-input" };

export function sameNode(a: CanvasNode | null, b: CanvasNode | null) {
  if (a?.kind === "block" && b?.kind === "block") return a.blockId === b.blockId;
  return a?.kind === b?.kind;
}

/** Whether a wire leaves the node: from any of a block's exits, or from the Flow input. */
export function leavesNode(wire: FlowWire, node: CanvasNode) {
  if (node.kind === "flow-input") return wire.source.kind === "flow-input";
  return wire.source.kind === "exit" && wire.source.sourceBlockId === node.blockId;
}

export function hasWire(graph: FlowGraph, wire: FlowWire) {
  if (wire.source.kind === "flow-input")
    return graph.flowInput.targetBlockIds.includes(wire.targetBlockId);
  return graph.connections.some((c) => sameWire(connectionWire(c), wire));
}

/**
 * Whether `source` may gain a wire to the block: any block for an exit, only Agent blocks
 * for the Flow input (never a Human step or a Continuation), and never a target the source
 * already reaches.
 */
export function canConnect(graph: FlowGraph, source: WireSource, targetBlockId: string) {
  const target = graph.blocks.find((b) => b.id === targetBlockId);
  if (!target || hasWire(graph, { source, targetBlockId })) return false;
  return source.kind === "exit" || target.kind === "agent";
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

/**
 * The names of the blocks each exit's connections reach, in graph order, indexed once per graph
 * since a canvas asks for every exit row; undefined for a target the graph lacks. Wires into
 * Finish endings reach no block and are not listed until Studio shows endings.
 */
export function exitRecipients(graph: FlowGraph) {
  const names = new Map<string, string>();
  for (const block of graph.blocks) if (!names.has(block.id)) names.set(block.id, block.name);
  const recipients = new Map<string, (string | undefined)[]>();
  for (const { sourceBlockId, exitId, targetBlockId } of graph.connections) {
    if (targetBlockId === FINISH_BLOCK_ID) continue;
    const key = JSON.stringify([sourceBlockId, exitId]);
    const list = recipients.get(key) ?? [];
    list.push(names.get(targetBlockId));
    recipients.set(key, list);
  }
  return (blockId: string, exitId: string): readonly (string | undefined)[] =>
    recipients.get(JSON.stringify([blockId, exitId])) ?? [];
}

/**
 * The names of the blocks each of one block's exits reaches, in graph order: a single pass that
 * keeps only that block's connections, for views that show one block rather than the whole canvas.
 * Wires into Finish endings are left out, as in `exitRecipients`.
 */
export function blockExitRecipients(graph: FlowGraph, blockId: string) {
  const recipients = new Map<string, (string | undefined)[]>();
  for (const { sourceBlockId, exitId, targetBlockId } of graph.connections) {
    if (sourceBlockId !== blockId || targetBlockId === FINISH_BLOCK_ID) continue;
    const list = recipients.get(exitId) ?? [];
    list.push(graph.blocks.find((block) => block.id === targetBlockId)?.name);
    recipients.set(exitId, list);
  }
  return (exitId: string): readonly (string | undefined)[] => recipients.get(exitId) ?? [];
}

/**
 * Undoes a removal that turned `before` into `after` on the current graph: blocks and wires the
 * removal took come back, edits made since are kept, and a wire returns only while both its ends
 * exist; a wire into Finish needs its ending.
 */
export function undoRemoval(current: FlowGraph, before: FlowGraph, after: FlowGraph): FlowGraph {
  const has = (graph: FlowGraph, id: string) => graph.blocks.some((b) => b.id === id);
  const blocks = [
    ...current.blocks,
    ...before.blocks.filter((b) => !has(after, b.id) && !has(current, b.id)),
  ];
  const exists = (id: string) => blocks.some((b) => b.id === id);
  const targetExists = ({ targetBlockId, targetEndingId }: FlowWire) =>
    targetBlockId === FINISH_BLOCK_ID
      ? current.finish.endings.some((ending) => ending.id === targetEndingId)
      : exists(targetBlockId);
  const restored = (graph: FlowGraph, wire: FlowWire) =>
    !hasWire(after, wire) && !hasWire(graph, wire) && targetExists(wire);
  let next: FlowGraph = { ...current, blocks };
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
