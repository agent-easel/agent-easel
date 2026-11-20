import {
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type FlowBlock,
  type FlowGraph,
} from "@t3-factory/contracts";
import { effectiveExits, inheritedExits, type EffectiveExit } from "@t3-factory/domain-validation";

/** Invalid saved wires keep their own display endpoint without offering a worker exit. */
type CanvasExit = EffectiveExit & { readonly unavailable?: "hidden" | "removed" };

/** A block as a canvas draws it: effective exits plus endpoints of invalid saved wires. */
export type CanvasBlock = FlowBlock & { readonly exits: readonly CanvasExit[] };
export type CanvasGraph = Omit<FlowGraph, "blocks"> & { readonly blocks: readonly CanvasBlock[] };

/** The graph with each block's effective exits, resolved against `agents`. */
export function canvasGraph(
  graph: FlowGraph,
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
): CanvasGraph {
  return {
    ...graph,
    blocks: graph.blocks.map((block) => ({ ...block, exits: canvasExits(graph, block, agents) })),
  };
}

/** A Condition draws a port for at most this many of its unwired rules. */
export const CONDITION_UNWIRED_PORTS = 8;

/**
 * A Condition's drawn outputs: every wired rule, its first `CONDITION_UNWIRED_PORTS` unwired rules
 * and Otherwise, in rule order. A Condition may hold tens of thousands of rules within the
 * definition size limit; drawing a row for each would make one block hundreds of thousands of
 * pixels tall, so the rest are edited in its block panel.
 */
function conditionCanvasExits(graph: FlowGraph, exits: EffectiveExit[], blockId: string) {
  const wired = new Set(
    graph.connections.flatMap((wire) => (wire.sourceBlockId === blockId ? [wire.exitId] : [])),
  );
  let unwired = 0;
  return exits.filter(
    (exit, index) =>
      index === exits.length - 1 || wired.has(exit.id) || unwired++ < CONDITION_UNWIRED_PORTS,
  );
}

/** Hidden or removed wired exits stay distinct from every usable output port. */
function canvasExits(
  graph: FlowGraph,
  block: FlowBlock,
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
): CanvasExit[] {
  const effective = effectiveExits(block, agents);
  if (block.kind === "condition") return conditionCanvasExits(graph, effective, block.id);
  const exits: CanvasExit[] = effective;
  const inherited = inheritedExits(block, agents);
  for (const wire of graph.connections) {
    if (wire.sourceBlockId !== block.id || exits.some((exit) => exit.id === wire.exitId)) continue;
    const hidden = inherited.find((exit) => exit.id === wire.exitId);
    exits.push({
      id: wire.exitId,
      name: hidden?.name ?? wire.exitId,
      description: "",
      messageRequired: hidden?.messageRequired ?? false,
      source: "agent",
      unavailable: hidden ? "hidden" : "removed",
    });
  }
  return exits;
}

/** Where a wire starts: one exit of a block, or the Flow input block. */
export type WireSource =
  | { readonly kind: "exit"; readonly sourceBlockId: string; readonly exitId: string }
  | { readonly kind: "flow-input" };

/** The id of a wire's ELK edge, which is also the key the canvas looks its route up by. */
export function wireRouteKey(source: WireSource, targetBlockId: string, targetEndingId?: string) {
  if (source.kind === "flow-input") return `flow-input:${targetBlockId}`;
  const target =
    targetEndingId === undefined ? targetBlockId : `${targetBlockId}:${targetEndingId}`;
  return `${source.sourceBlockId}:${source.exitId}:${target}`;
}

/** A source's identity among one block's incoming wires; ids are free text, so the key is JSON. */
function sourceKey(source: WireSource) {
  return source.kind === "flow-input" ? "" : JSON.stringify([source.sourceBlockId, source.exitId]);
}

/** Every block's incoming wires and the input port each source attaches to. */
export type IncomingIndex = {
  /** A block's incoming wires in input-port order: the Flow input first, then connections in graph order. */
  readonly wires: (targetBlockId: string) => readonly WireSource[];
  /** The input port a wire from `source` attaches to; port 0 when the block has no such wire yet. */
  readonly portIndex: (targetBlockId: string, source: WireSource) => number;
};

/**
 * The graph's incoming wires, indexed in one pass. A canvas asks for a port per wire and a block
 * may have thousands of incoming wires, so a lookup must not rescan the connections.
 */
export function incomingIndex(graph: FlowGraph): IncomingIndex {
  const incoming = new Map<string, { wires: WireSource[]; ports: Map<string, number> }>();
  const add = (targetBlockId: string, source: WireSource) => {
    let target = incoming.get(targetBlockId);
    if (!target) incoming.set(targetBlockId, (target = { wires: [], ports: new Map() }));
    const key = sourceKey(source);
    if (!target.ports.has(key)) target.ports.set(key, target.wires.length);
    target.wires.push(source);
  };
  for (const targetBlockId of new Set(graph.flowInput.targetBlockIds))
    add(targetBlockId, { kind: "flow-input" });
  // Wires into Finish attach to their ending's own port, never to a block input.
  for (const { sourceBlockId, exitId, targetBlockId } of graph.connections)
    if (targetBlockId !== FINISH_BLOCK_ID)
      add(targetBlockId, { kind: "exit", sourceBlockId, exitId });
  return {
    wires: (targetBlockId) => incoming.get(targetBlockId)?.wires ?? [],
    portIndex: (targetBlockId, source) =>
      incoming.get(targetBlockId)?.ports.get(sourceKey(source)) ?? 0,
  };
}

/**
 * Where each exit sits in its block's rows, by block and exit id; the first block and row win
 * where an id repeats. Undefined for an exit the block does not draw.
 */
export function exitRows(
  blocks: readonly { readonly id: string; readonly exits: readonly { readonly id: string }[] }[],
) {
  const rows = new Map<string, Map<string, number>>();
  for (const block of blocks) {
    if (rows.has(block.id)) continue;
    const exits = new Map<string, number>();
    block.exits.forEach((exit, index) => {
      if (!exits.has(exit.id)) exits.set(exit.id, index);
    });
    rows.set(block.id, exits);
  }
  return (blockId: string, exitId: string) => rows.get(blockId)?.get(exitId);
}
