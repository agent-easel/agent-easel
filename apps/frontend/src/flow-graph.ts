import {
  AUTHORING_DIMENSIONS,
  defaultFinishPosition,
  type CanvasGraph,
  type WireSource,
} from "@t3-factory/flow-layout";
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
      revisitContext: "keep",
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

export type CanvasNode =
  | { readonly kind: "block"; readonly blockId: string }
  | { readonly kind: "flow-input" }
  | { readonly kind: "finish" };

export function sameNode(a: CanvasNode | null, b: CanvasNode | null) {
  if (a?.kind === "block" && b?.kind === "block") return a.blockId === b.blockId;
  return a?.kind === b?.kind;
}

export function leavesNode(wire: FlowWire, node: CanvasNode) {
  if (node.kind === "finish") return false;
  if (node.kind === "flow-input") return wire.source.kind === "flow-input";
  return wire.source.kind === "exit" && wire.source.sourceBlockId === node.blockId;
}

export function hasWire(graph: FlowGraph, wire: FlowWire) {
  if (wire.source.kind === "flow-input")
    return (
      wire.targetEndingId === undefined &&
      graph.flowInput.targetBlockIds.includes(wire.targetBlockId)
    );
  return graph.connections.some((c) => sameWire(connectionWire(c), wire));
}

export const FINISH_SELECTION = Symbol("Finish block");
export type CanvasBlockSelection = string | typeof FINISH_SELECTION;

export type WireTarget = Pick<FlowWire, "targetBlockId" | "targetEndingId">;

export function canConnect(graph: FlowGraph, source: WireSource, target: WireTarget) {
  if (hasWire(graph, { source, ...target })) return false;
  if (target.targetEndingId !== undefined)
    return (
      source.kind === "exit" &&
      target.targetBlockId === FINISH_BLOCK_ID &&
      !!graph.finish?.endings.some((ending) => ending.id === target.targetEndingId)
    );
  const block = graph.blocks.find((b) => b.id === target.targetBlockId);
  if (!block) return false;
  return source.kind === "exit" || block.kind === "agent";
}

export function addWire<G extends FlowGraph | CanvasGraph>(
  graph: G,
  { source, targetBlockId, targetEndingId }: FlowWire,
): G {
  if (source.kind === "flow-input") {
    if (targetEndingId !== undefined) return graph;
    return {
      ...graph,
      flowInput: {
        ...graph.flowInput,
        targetBlockIds: [...graph.flowInput.targetBlockIds, targetBlockId],
      },
    };
  }
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
  if (wire.source.kind === "flow-input") {
    if (wire.targetEndingId !== undefined) return graph;
    return {
      ...graph,
      flowInput: {
        ...graph.flowInput,
        targetBlockIds: graph.flowInput.targetBlockIds.filter((id) => id !== wire.targetBlockId),
      },
    };
  }
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
      (c) =>
        c.sourceBlockId !== blockId &&
        (c.targetEndingId !== undefined || c.targetBlockId !== blockId),
    ),
    flowInput: {
      ...graph.flowInput,
      targetBlockIds: graph.flowInput.targetBlockIds.filter((id) => id !== blockId),
    },
  };
}

export function addFinish(graph: FlowGraph, position?: BlockPosition): FlowGraph {
  if (graph.finish) return graph;
  const placed =
    position ??
    defaultFinishPosition(graph, {
      flowInputWidth: AUTHORING_DIMENSIONS.flowInput.width,
      blockWidth: AUTHORING_DIMENSIONS.block.width,
    });
  return { ...graph, finish: { position: placed, endings: [] } };
}

export function removeFinish({ finish: _removed, ...graph }: FlowGraph): FlowGraph {
  return { ...graph, connections: graph.connections.filter((c) => c.targetEndingId === undefined) };
}

function withEndings(
  graph: FlowGraph,
  edit: (endings: readonly FlowEnding[]) => readonly FlowEnding[],
): FlowGraph {
  return graph.finish
    ? { ...graph, finish: { ...graph.finish, endings: edit(graph.finish.endings) } }
    : graph;
}

export function addEnding(graph: FlowGraph): FlowGraph {
  const ending: FlowEnding = {
    id: uid(),
    name: "",
    description: "",
    output: "none",
    outputDescription: "",
  };
  return withEndings(graph, (endings) => [...endings, ending]);
}

export function replaceEnding(graph: FlowGraph, next: FlowEnding): FlowGraph {
  return withEndings(graph, (endings) =>
    endings.map((ending) => (ending.id === next.id ? next : ending)),
  );
}

export function removeEnding(graph: FlowGraph, endingId: string): FlowGraph {
  return {
    ...withEndings(graph, (endings) => endings.filter((ending) => ending.id !== endingId)),
    connections: graph.connections.filter(
      (c) => c.targetBlockId !== FINISH_BLOCK_ID || c.targetEndingId !== endingId,
    ),
  };
}

function restoreInOrder<T>(
  current: readonly T[],
  before: readonly T[],
  key: (item: T) => string,
  restore: (item: T) => boolean,
): T[] {
  const items = [...current];
  const has = (item: T) => items.some((candidate) => key(candidate) === key(item));
  before.forEach((item, index) => {
    if (has(item) || !restore(item)) return;
    const previous = before.slice(0, index).findLast(has);
    const at = previous ? items.findIndex((candidate) => key(candidate) === key(previous)) + 1 : 0;
    items.splice(at, 0, item);
  });
  return items;
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

function recipientNames(graph: FlowGraph) {
  const names = new Map<string, string>();
  for (const block of graph.blocks) if (!names.has(block.id)) names.set(block.id, block.name);
  const endings = new Map<string, string>();
  for (const ending of graph.finish?.endings ?? [])
    if (!endings.has(ending.id)) endings.set(ending.id, ending.name);
  return ({ targetBlockId, targetEndingId }: FlowConnection) => {
    if (targetEndingId === undefined) return names.get(targetBlockId);
    const ending = endings.get(targetEndingId);
    return ending === undefined ? undefined : `Finish · ${ending || "Unnamed ending"}`;
  };
}

const exitRecipientsCache = new WeakMap<
  FlowGraph,
  (blockId: string, exitId: string) => readonly (string | undefined)[]
>();

export function exitRecipients(graph: FlowGraph) {
  const cached = exitRecipientsCache.get(graph);
  if (cached) return cached;
  const name = recipientNames(graph);
  const recipients = new Map<string, (string | undefined)[]>();
  for (const connection of graph.connections) {
    const key = JSON.stringify([connection.sourceBlockId, connection.exitId]);
    const list = recipients.get(key) ?? [];
    list.push(name(connection));
    recipients.set(key, list);
  }
  const lookup = (blockId: string, exitId: string): readonly (string | undefined)[] =>
    recipients.get(JSON.stringify([blockId, exitId])) ?? [];
  exitRecipientsCache.set(graph, lookup);
  return lookup;
}

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

export function undoRemoval(
  current: FlowGraph,
  before: FlowGraph,
  after: FlowGraph,
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
): FlowGraph {
  const removedBy =
    <T>(list: readonly T[], key: (item: T) => string) =>
    (item: T) =>
      !list.some((candidate) => key(candidate) === key(item));
  const byId = (item: { readonly id: string }) => item.id;
  const blocks = restoreInOrder(current.blocks, before.blocks, byId, removedBy(after.blocks, byId));
  const finish = current.finish ?? (after.finish ? undefined : before.finish);
  const endings = restoreInOrder(
    current.finish?.endings ?? [],
    finish ? (before.finish?.endings ?? []) : [],
    byId,
    removedBy(after.finish?.endings ?? [], byId),
  );
  const restored = { ...current, blocks, ...(finish && { finish: { ...finish, endings } }) };
  const exits = new Map(
    blocks.map((block) => [
      block.id,
      new Set(effectiveExits(block, agents).map((exit) => exit.id)),
    ]),
  );
  const restorable = (wire: FlowWire) =>
    !hasWire(after, wire) && canConnect(restored, wire.source, wire);
  const targetBlockIds = restoreInOrder(
    current.flowInput.targetBlockIds,
    before.flowInput.targetBlockIds,
    (id) => id,
    (targetBlockId) => restorable({ source: { kind: "flow-input" }, targetBlockId }),
  );
  const connections = restoreInOrder(
    current.connections,
    before.connections,
    connectionKey,
    (connection) =>
      exits.get(connection.sourceBlockId)?.has(connection.exitId) === true &&
      restorable(connectionWire(connection)),
  );
  return {
    ...restored,
    flowInput: { ...current.flowInput, targetBlockIds },
    connections,
  };
}
