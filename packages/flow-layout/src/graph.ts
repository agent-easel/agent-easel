import type { AgentDefinition, FlowBlock, FlowGraph } from "@t3-factory/contracts";
import { effectiveExits, inheritedExits, type EffectiveExit } from "@t3-factory/domain-validation";

type CanvasExit = EffectiveExit & { readonly unavailable?: "hidden" | "removed" };

export type CanvasBlock = FlowBlock & { readonly exits: readonly CanvasExit[] };
export type CanvasGraph = Omit<FlowGraph, "blocks"> & { readonly blocks: readonly CanvasBlock[] };

export function canvasGraph(
  graph: FlowGraph,
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
): CanvasGraph {
  return {
    ...graph,
    blocks: graph.blocks.map((block) => ({ ...block, exits: canvasExits(graph, block, agents) })),
  };
}

export const CONDITION_UNWIRED_PORTS = 8;

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

export type WireSource =
  | { readonly kind: "exit"; readonly sourceBlockId: string; readonly exitId: string }
  | { readonly kind: "flow-input" };

export function wireRouteKey(source: WireSource, targetBlockId: string) {
  if (source.kind === "flow-input") return `flow-input:${targetBlockId}`;
  return `${source.sourceBlockId}:${source.exitId}:${targetBlockId}`;
}

function sourceKey(source: WireSource) {
  return source.kind === "flow-input" ? "" : JSON.stringify([source.sourceBlockId, source.exitId]);
}

export type IncomingIndex = {
  readonly wires: (targetBlockId: string) => readonly WireSource[];
  readonly portIndex: (targetBlockId: string, source: WireSource) => number;
};

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
  for (const { sourceBlockId, exitId, targetBlockId } of graph.connections)
    add(targetBlockId, { kind: "exit", sourceBlockId, exitId });
  return {
    wires: (targetBlockId) => incoming.get(targetBlockId)?.wires ?? [],
    portIndex: (targetBlockId, source) =>
      incoming.get(targetBlockId)?.ports.get(sourceKey(source)) ?? 0,
  };
}

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
