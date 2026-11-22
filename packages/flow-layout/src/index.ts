import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import type { FlowBlock, FlowGraph } from "@t3-factory/contracts";
import { CANVAS_COORD_MAX, isCanvasPosition } from "@t3-factory/domain-validation";
import { exitRows, incomingIndex, wireRouteKey, type IncomingIndex } from "./graph.ts";

export type LayoutBlock = FlowBlock & {
  readonly exits: readonly { readonly id: string; readonly name: string }[];
};
export type LayoutGraph<B extends LayoutBlock = LayoutBlock> = Omit<FlowGraph, "blocks"> & {
  readonly blocks: readonly B[];
};
export type FlowLayoutPositions = {
  readonly flowInput: { x: number; y: number };
  readonly finish?: { x: number; y: number };
  readonly blocks: ReadonlyMap<string, { x: number; y: number }>;
};

function elkInputPortId(targetBlockId: string, index: number) {
  return `in:${targetBlockId}:${index}`;
}

const FLOW_INPUT_NODE_ID = "flow-input";
const FINISH_NODE_ID = "finish";
const BLOCK_NODE_PREFIX = "block:";

import type { BlockFrame } from "./dimensions.ts";

export type FlowLayoutDimensions<B extends LayoutBlock = LayoutBlock> = {
  readonly flowInput: { readonly width: number; readonly height: number; readonly outputY: number };
  readonly finish: { readonly firstEndingY: number };
  readonly blockWidth: number;
  readonly blockHeight: (block: B) => number;
  readonly blockInputY: (block: B, index: number) => number;
  readonly blockExitY: (block: B, exitId: string, index: number) => number;
  readonly blockFrame?: ((block: B) => BlockFrame | undefined) | undefined;
  readonly ports: { readonly exitRow: number };
  readonly labels: boolean;
  readonly labelSize: (text: string) => { readonly width: number; readonly height: number };
};

const ROOT_LAYOUT = {
  "org.eclipse.elk.algorithm": "layered",
  "org.eclipse.elk.direction": "RIGHT",
  "org.eclipse.elk.edgeRouting": "ORTHOGONAL",
  "org.eclipse.elk.spacing.nodeNode": "48",
  "org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "org.eclipse.elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
  "org.eclipse.elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
  "org.eclipse.elk.separateConnectedComponents": "false",
  "org.eclipse.elk.portConstraints": "FIXED_POS",
  "org.eclipse.elk.randomSeed": "1",
  "org.eclipse.elk.layered.mergeEdges": "false",
} as const;

function exitPortId(blockId: string, exitId: string) {
  return `out:${JSON.stringify([blockId, exitId])}`;
}

function flowInputPortId() {
  return "out:flow-input";
}

function finishPortId(endingIndex: number) {
  return `ending:${endingIndex}`;
}

function finishNode<B extends LayoutBlock>(
  finish: NonNullable<FlowGraph["finish"]>,
  dims: FlowLayoutDimensions<B>,
) {
  const { ports } = dims;
  const { firstEndingY } = dims.finish;
  const rows = Math.max(1, finish.endings.length);
  return {
    id: FINISH_NODE_ID,
    width: dims.blockWidth,
    height: firstEndingY + rows * ports.exitRow,
    layoutOptions: {
      "org.eclipse.elk.portConstraints": "FIXED_POS",
      "org.eclipse.elk.layered.layering.layerConstraint": "LAST_SEPARATE",
    },
    ports: finish.endings.map((_ending, index) => ({
      id: finishPortId(index),
      width: 0,
      height: 0,
      x: 0,
      y: firstEndingY + index * ports.exitRow,
      layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
    })),
  } satisfies ElkNode;
}

const LAYER_GAP = 80;

export function defaultFinishPosition(
  graph: Pick<FlowGraph, "blocks" | "flowInput">,
  dimensions: { readonly flowInputWidth: number; readonly blockWidth: number },
) {
  const right = Math.max(
    graph.flowInput.position.x + dimensions.flowInputWidth,
    ...graph.blocks.map((block) => block.position.x + dimensions.blockWidth),
  );
  return { x: Math.min(CANVAS_COORD_MAX, right + LAYER_GAP), y: graph.flowInput.position.y };
}

function blockPorts<B extends LayoutBlock>(
  block: B,
  index: IncomingIndex,
  dims: FlowLayoutDimensions<B>,
) {
  const width = dims.blockFrame?.(block)?.width ?? dims.blockWidth;
  const inputs = Math.max(1, index.ports(block.id).length);
  return [
    ...Array.from({ length: inputs }, (_port, index) => ({
      id: elkInputPortId(block.id, index),
      width: 0,
      height: 0,
      x: 0,
      y: dims.blockInputY(block, index),
      layoutOptions: { "org.eclipse.elk.port.side": "WEST" },
    })),
    ...block.exits.map((exit, index) => ({
      id: exitPortId(block.id, exit.id),
      width: 0,
      height: 0,
      x: width,
      y: dims.blockExitY(block, exit.id, index),
      layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
    })),
  ];
}

function orderedBlocks<B extends LayoutBlock>(graph: LayoutGraph<B>): B[] {
  const byId = new Map(graph.blocks.map((block) => [block.id, block]));
  const successors = new Map<string, string[]>();
  for (const connection of graph.connections) {
    if (connection.targetEndingId !== undefined) continue;
    const targets = successors.get(connection.sourceBlockId) ?? [];
    targets.push(connection.targetBlockId);
    successors.set(connection.sourceBlockId, targets);
  }
  const visited = new Set<string>();
  const ordered: B[] = [];
  function traverse(roots: readonly string[]) {
    const finished: B[] = [];
    const stack = roots.map((id) => ({ id, finish: false })).reverse();
    while (stack.length) {
      const entry = stack.pop()!;
      const block = byId.get(entry.id);
      if (!block) continue;
      if (entry.finish) {
        finished.push(block);
        continue;
      }
      if (visited.has(entry.id)) continue;
      visited.add(entry.id);
      stack.push({ id: entry.id, finish: true });
      for (const id of [...(successors.get(entry.id) ?? [])].reverse()) {
        stack.push({ id, finish: false });
      }
    }
    ordered.push(...finished.reverse());
  }
  traverse(graph.flowInput.targetBlockIds);
  traverse(graph.blocks.map((block) => block.id));
  return ordered;
}

function flowInputNode<B extends LayoutBlock>(dims: FlowLayoutDimensions<B>): ElkNode {
  const { width, height, outputY } = dims.flowInput;
  const node: ElkNode = {
    id: FLOW_INPUT_NODE_ID,
    width,
    height,
    layoutOptions: {
      "org.eclipse.elk.portConstraints": "FIXED_POS",
      "org.eclipse.elk.layered.layering.layerConstraint": "FIRST_SEPARATE",
    },
    ports: [
      {
        id: flowInputPortId(),
        width: 0,
        height: 0,
        x: width,
        y: outputY,
        layoutOptions: { "org.eclipse.elk.port.side": "EAST" },
      },
    ],
  };
  return node;
}

function blockNode<B extends LayoutBlock>(
  block: B,
  incoming: IncomingIndex,
  dims: FlowLayoutDimensions<B>,
): ElkNode {
  const frame = dims.blockFrame?.(block);
  const node: ElkNode = {
    id: `${BLOCK_NODE_PREFIX}${block.id}`,
    width: frame?.width ?? dims.blockWidth,
    height: dims.blockHeight(block),
    layoutOptions: { "org.eclipse.elk.portConstraints": "FIXED_POS" },
    ports: blockPorts(block, incoming, dims),
  };
  return node;
}

function edgeLabeller<B extends LayoutBlock>(graph: LayoutGraph<B>, dims: FlowLayoutDimensions<B>) {
  const blocks = new Map<string, B>();
  for (const block of graph.blocks) if (!blocks.has(block.id)) blocks.set(block.id, block);
  const rows = exitRows(graph.blocks);
  const endings = new Map(graph.finish?.endings.map((ending) => [ending.id, ending.name]));
  return (connection: FlowGraph["connections"][number]) => {
    const source = blocks.get(connection.sourceBlockId);
    if (!dims.labels || source?.kind === "continuation") return [];
    const target =
      connection.targetEndingId !== undefined
        ? `Finish · ${endings.get(connection.targetEndingId ?? "") || "Unnamed ending"}`
        : blocks.get(connection.targetBlockId)?.name || "Unnamed block";
    const row = rows(connection.sourceBlockId, connection.exitId);
    const exit = (row === undefined ? undefined : source?.exits[row]?.name) || "exit";
    const text = `${exit} → ${target}`;
    return [{ text, ...dims.labelSize(text) }];
  };
}

function buildEdges<B extends LayoutBlock>(
  graph: LayoutGraph<B>,
  incoming: IncomingIndex,
  dims: FlowLayoutDimensions<B>,
): ElkExtendedEdge[] {
  const edgeLabels = edgeLabeller(graph, dims);
  const edges: ElkExtendedEdge[] = [];
  for (const targetBlockId of graph.flowInput.targetBlockIds) {
    const id = wireRouteKey({ kind: "flow-input" }, targetBlockId);
    edges.push({
      id,
      sources: [flowInputPortId()],
      targets: [
        elkInputPortId(targetBlockId, incoming.portIndex(targetBlockId, { kind: "flow-input" })),
      ],
    });
  }
  const endingPorts = new Map(graph.finish?.endings.map((ending, index) => [ending.id, index]));
  for (const connection of graph.connections) {
    const { sourceBlockId, exitId, targetBlockId, targetEndingId } = connection;
    const source = { kind: "exit", sourceBlockId, exitId } as const;
    const target =
      targetEndingId !== undefined
        ? finishPortId(endingPorts.get(connection.targetEndingId ?? "") ?? 0)
        : elkInputPortId(targetBlockId, incoming.portIndex(targetBlockId, source));
    edges.push({
      id: wireRouteKey(source, targetBlockId, connection.targetEndingId),
      sources: [exitPortId(sourceBlockId, exitId)],
      targets: [target],
      labels: edgeLabels(connection),
    });
  }
  return edges;
}

export function buildElkGraph<B extends LayoutBlock>(
  graph: LayoutGraph<B>,
  dims: FlowLayoutDimensions<B>,
): ElkNode {
  const incoming = incomingIndex(graph);
  return {
    id: "root",
    layoutOptions: ROOT_LAYOUT,
    children: [
      flowInputNode(dims),
      ...orderedBlocks(graph).map((block) => blockNode(block, incoming, dims)),
      ...(graph.finish ? [finishNode(graph.finish, dims)] : []),
    ],
    edges: buildEdges(graph, incoming, dims),
  };
}

export class FlowLayoutLimitError extends Error {
  constructor() {
    super("This Flow is too large to auto-arrange within the canvas limits.");
  }
}

export function parseLayoutPositions(graph: FlowGraph, laidOut: ElkNode): FlowLayoutPositions {
  const blocks = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    const position = { x: child.x, y: child.y };
    if (!isCanvasPosition(position)) throw new FlowLayoutLimitError();
    if (child.id.startsWith(BLOCK_NODE_PREFIX))
      blocks.set(child.id.slice(BLOCK_NODE_PREFIX.length), position);
  }
  const placed = (id: string, fallback: { x: number; y: number }) => {
    const child = laidOut.children?.find((c) => c.id === id);
    return child?.x !== undefined && child.y !== undefined ? { x: child.x, y: child.y } : fallback;
  };
  return {
    flowInput: placed(FLOW_INPUT_NODE_ID, graph.flowInput.position),
    ...(graph.finish && { finish: placed(FINISH_NODE_ID, graph.finish.position) }),
    blocks,
  };
}

type ElkConstructor = new () => ELK;

function elkConstructor(
  value: ElkConstructor | { readonly default: ElkConstructor },
): ElkConstructor {
  return typeof value === "function" ? value : value.default;
}

export async function arrangeFlow<B extends LayoutBlock>(
  graph: LayoutGraph<B>,
  dimensions: FlowLayoutDimensions<B>,
): Promise<FlowLayoutPositions> {
  const { default: bundle } = await import("elkjs/lib/elk.bundled.js");
  const Elk = elkConstructor(bundle);
  const elk = new Elk();
  return parseLayoutPositions(graph, await elk.layout(buildElkGraph(graph, dimensions)));
}

export {
  AUTHORING_DIMENSIONS,
  createNodeGeometry,
  createFlowLayoutDimensions,
  incomingPortY,
  type BlockFrame,
  type CanvasDimensions,
  type GeometryFacts,
} from "./dimensions.ts";
export {
  canvasGraph,
  CONDITION_UNWIRED_PORTS,
  exitRows,
  type CanvasBlock,
  type CanvasGraph,
  wireRouteKey,
  type WireSource,
} from "./graph.ts";
