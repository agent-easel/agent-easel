import { type AgentDefinition, type FlowBlock, type FlowGraph } from "@t3-factory/contracts";
import { effectiveExits, inheritedExits, type EffectiveExit } from "@t3-factory/domain-validation";

type CanvasExit = EffectiveExit & { readonly unavailable?: "hidden" | "removed" };

export type CanvasBlock = FlowBlock & { readonly exits: readonly CanvasExit[] };
export type CanvasGraph = Omit<FlowGraph, "blocks"> & { readonly blocks: readonly CanvasBlock[] };

function wiredExitIds(graph: FlowGraph) {
  const wired = new Map<string, string[]>();
  for (const { sourceBlockId, exitId } of graph.connections) {
    const exits = wired.get(sourceBlockId);
    if (exits) exits.push(exitId);
    else wired.set(sourceBlockId, [exitId]);
  }
  return wired;
}

export function canvasGraph(
  graph: FlowGraph,
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
): CanvasGraph {
  const wired = wiredExitIds(graph);
  return {
    ...graph,
    blocks: graph.blocks.map((block) => ({
      ...block,
      exits: canvasExits(block, wired.get(block.id) ?? [], agents),
    })),
  };
}

export const CONDITION_UNWIRED_PORTS = 8;

function conditionCanvasExits(exits: EffectiveExit[], wiredIds: readonly string[]) {
  const wired = new Set(wiredIds);
  let unwired = 0;
  return exits.filter(
    (exit, index) =>
      index === exits.length - 1 || wired.has(exit.id) || unwired++ < CONDITION_UNWIRED_PORTS,
  );
}

function canvasExits(
  block: FlowBlock,
  wiredIds: readonly string[],
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
): CanvasExit[] {
  const effective = effectiveExits(block, agents);
  if (block.kind === "condition") return conditionCanvasExits(effective, wiredIds);
  const exits: CanvasExit[] = effective;
  const drawn = new Set(exits.map((exit) => exit.id));
  const inherited = inheritedExits(block, agents);
  for (const exitId of wiredIds) {
    if (drawn.has(exitId)) continue;
    drawn.add(exitId);
    const hidden = inherited.find((exit) => exit.id === exitId);
    exits.push({
      id: exitId,
      name: hidden?.name ?? exitId,
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

export function wireRouteKey(source: WireSource, targetBlockId: string, targetEndingId?: string) {
  return JSON.stringify(
    source.kind === "flow-input"
      ? [source.kind, targetBlockId]
      : [source.kind, source.sourceBlockId, source.exitId, targetBlockId, targetEndingId ?? null],
  );
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
  for (const { sourceBlockId, exitId, targetBlockId, targetEndingId } of graph.connections)
    if (targetEndingId === undefined) add(targetBlockId, { kind: "exit", sourceBlockId, exitId });
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
