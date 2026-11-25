import {
  SUBFLOW_EXPANDED_BLOCKS_LIMIT,
  SUBFLOW_EXPANDED_CONNECTIONS_LIMIT,
  type AgentDefinition,
  type FlowBlock,
  type FlowDraft,
  type FlowGraph,
  type FlowReadiness,
} from "@agent-easel/contracts";
import {
  canvasGraph,
  createFlowLayoutDimensions,
  type BlockFrame,
  type CanvasBlock,
  type CanvasDimensions,
  type CanvasGraph,
} from "@agent-easel/flow-layout";
import {
  applyLayoutPositions,
  type FlowLayoutDimensions,
  type FlowLayoutResult,
} from "./flow-layout-elk.ts";
import { createCanvasGeometry } from "./flow-geometry.ts";

export const SUBFLOW_HEADER_HEIGHT = 36;
const SUBFLOW_PADDING = { top: 20, right: 32, bottom: 20, left: 32 } as const;
const SUBFLOW_MIN_WIDTH = 360;
const SUBFLOW_MIN_HEIGHT = 180;
const BROKEN_EXIT_STEP = 24;
const executionFooters = () => 2;

const BUDGET_CODES: ReadonlySet<string> = new Set([
  "subflow_capture_bytes_exceeded",
  "subflow_expanded_blocks_exceeded",
  "subflow_expanded_connections_exceeded",
]);

export type SubflowCollapseReason = "cycle" | "budget" | "missing" | "unset";

export type SubflowPreviewPoint = { readonly x: number; readonly y: number };

export type SubflowEndingRoute = {
  readonly endingId: string;
  readonly from: SubflowPreviewPoint;
  readonly to: SubflowPreviewPoint;
};

export type CanvasFlow = Pick<FlowDraft, "id" | "name" | "graph">;

export const placementKey = (parent: string, blockId: string) =>
  `${parent}/${encodeURIComponent(blockId)}`;

export type SubflowPreview = {
  readonly blockId: string;
  readonly childFlow: CanvasFlow;
  readonly width: number;
  readonly height: number;
  readonly inputY: number;
  readonly exitPositions: ReadonlyMap<string, number>;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly innerGraph: CanvasGraph;
  readonly innerGeometry: ReturnType<typeof createCanvasGeometry>;
  readonly innerPreviews: ReadonlyMap<string, SubflowPreview>;
  readonly incomingEntry: SubflowPreviewPoint;
  readonly endingRoutes: readonly SubflowEndingRoute[];
};

export function blockedSubflowReasons(
  graph: FlowGraph,
  readiness: FlowReadiness | null,
  flows: ReadonlyMap<string, CanvasFlow>,
): ReadonlyMap<string, SubflowCollapseReason> {
  const reasons = new Map<string, SubflowCollapseReason>();
  const overBudget = readiness?.issues.some((issue) => BUDGET_CODES.has(issue.code)) ?? false;
  const cyclicIndices = new Set<number>();
  for (const issue of readiness?.issues ?? []) {
    if (issue.code !== "subflow_cycle") continue;
    const match = /^graph\.blocks\.(\d+)/.exec(issue.path);
    if (match) cyclicIndices.add(Number(match[1]));
  }
  graph.blocks.forEach((block, index) => {
    if (block.kind !== "subflow") return;
    if (block.flowId === null) {
      reasons.set(block.id, "unset");
      return;
    }
    if (!flows.has(block.flowId)) {
      reasons.set(block.id, "missing");
      return;
    }
    if (cyclicIndices.has(index)) {
      reasons.set(block.id, "cycle");
      return;
    }
    if (overBudget) reasons.set(block.id, "budget");
  });
  return reasons;
}

function previewExitPositions(
  block: CanvasBlock,
  childFlow: CanvasFlow,
  innerGeometry: ReturnType<typeof createCanvasGeometry>,
  offsetY: number,
  bodyBottom: number,
) {
  const exitPositions = new Map<string, number>();
  const endingRoutes: SubflowEndingRoute[] = [];
  const finishBox = innerGeometry.finishBox;
  const finishRight = finishBox ? finishBox.x + finishBox.width : 0;
  childFlow.graph.finish?.endings.forEach((ending, index) => {
    const point = innerGeometry.endingPoint(index);
    const y = offsetY + point.y;
    exitPositions.set(ending.id, y);
    endingRoutes.push({
      endingId: ending.id,
      from: { x: finishRight, y: point.y },
      to: { x: 0, y },
    });
  });
  let brokenY = Math.max(bodyBottom - 16, SUBFLOW_HEADER_HEIGHT + 44);
  for (const exit of block.exits) {
    if (exitPositions.has(exit.id)) continue;
    exitPositions.set(exit.id, brokenY);
    brokenY += BROKEN_EXIT_STEP;
  }
  const maxExitY = Math.max(bodyBottom, ...[...exitPositions.values()].map((y) => y + 18));
  return { exitPositions, endingRoutes, height: Math.max(SUBFLOW_MIN_HEIGHT, maxExitY) };
}

type PreviewGeometry = Pick<
  SubflowPreview,
  "childFlow" | "innerGraph" | "innerGeometry" | "innerPreviews"
>;

type PreviewBuild = {
  readonly flows: ReadonlyMap<string, CanvasFlow>;
  readonly agents: readonly Pick<AgentDefinition, "id" | "exits">[];
  readonly dimensions: CanvasDimensions;
  readonly ancestors: Set<string>;
  readonly runCollapsed?: ReadonlySet<string> | undefined;
  readonly affected: ReadonlySet<string>;
  readonly arranged?: boolean | undefined;
  readonly revisions: Map<string, PreviewGeometry>;
  remainingBlocks: number;
  remainingConnections: number;
};

function previewBudget(graph: CanvasGraph, execution: boolean) {
  return execution
    ? { remainingBlocks: Infinity, remainingConnections: Infinity }
    : {
        remainingBlocks: SUBFLOW_EXPANDED_BLOCKS_LIMIT - graph.blocks.length,
        remainingConnections: SUBFLOW_EXPANDED_CONNECTIONS_LIMIT - graph.connections.length,
      };
}

function buildSubflowPreview(
  block: CanvasBlock,
  path: string,
  build: PreviewBuild,
): SubflowPreview | null {
  const { flows, ancestors, runCollapsed, affected, revisions } = build;
  if (block.kind !== "subflow" || block.flowId === null) return null;
  if (ancestors.has(block.flowId)) return null;
  const childFlow = flows.get(block.flowId);
  if (!childFlow) return null;
  const cached = revisions.get(childFlow.id);
  const share = runCollapsed !== undefined && !affected.has(path);
  if (share && cached)
    return frameSubflow(
      block,
      childFlow,
      cached.innerGraph,
      cached.innerGeometry,
      cached.innerPreviews,
    );
  const { blocks, connections } = childFlow.graph;
  if (blocks.length > build.remainingBlocks || connections.length > build.remainingConnections)
    return null;
  build.remainingBlocks -= blocks.length;
  build.remainingConnections -= connections.length;
  const geometry = buildPreviewGeometry(childFlow, path, build);
  if (share) revisions.set(childFlow.id, geometry);
  return frameSubflow(
    block,
    childFlow,
    geometry.innerGraph,
    geometry.innerGeometry,
    geometry.innerPreviews,
  );
}

function buildPreviewGeometry(
  childFlow: CanvasFlow,
  path: string,
  build: PreviewBuild,
): PreviewGeometry {
  const { flows, agents, dimensions, ancestors, runCollapsed, arranged } = build;
  ancestors.add(childFlow.id);
  let innerGraph = canvasGraph(childFlow.graph, agents, flows);
  const innerPreviews = new Map<string, SubflowPreview>();
  for (const innerBlock of innerGraph.blocks) {
    const key = placementKey(path, innerBlock.id);
    if (runCollapsed?.has(key)) continue;
    const nested = buildSubflowPreview(innerBlock, key, build);
    if (nested) innerPreviews.set(innerBlock.id, nested);
  }
  ancestors.delete(childFlow.id);
  if (runCollapsed && !arranged)
    innerGraph = displaceSubflowSiblings(innerGraph, innerPreviews, dimensions);
  const innerGeometry = createCanvasGeometry(innerGraph, dimensions, {
    ...(runCollapsed && { prompt: "line", footerCount: executionFooters }),
    blockFrame: previewBlockFrame(innerPreviews),
  });
  return { childFlow, innerGraph, innerGeometry, innerPreviews };
}

function frameSubflow(
  block: CanvasBlock,
  childFlow: CanvasFlow,
  innerGraph: CanvasGraph,
  innerGeometry: ReturnType<typeof createCanvasGeometry>,
  innerPreviews: ReadonlyMap<string, SubflowPreview>,
): SubflowPreview {
  const innerBounds = innerGeometry.bounds();
  const offsetX = SUBFLOW_PADDING.left - innerBounds.minX;
  const offsetY = SUBFLOW_HEADER_HEIGHT + SUBFLOW_PADDING.top - innerBounds.minY;
  const width = Math.max(
    SUBFLOW_MIN_WIDTH,
    innerBounds.width + SUBFLOW_PADDING.left + SUBFLOW_PADDING.right,
  );
  const bodyBottom =
    SUBFLOW_HEADER_HEIGHT + SUBFLOW_PADDING.top + innerBounds.height + SUBFLOW_PADDING.bottom;
  const { exitPositions, endingRoutes, height } = previewExitPositions(
    block,
    childFlow,
    innerGeometry,
    offsetY,
    bodyBottom,
  );
  const routes = endingRoutes.map((route) => ({
    endingId: route.endingId,
    from: { x: offsetX + route.from.x, y: offsetY + route.from.y },
    to: { x: width, y: route.to.y },
  }));
  const inputY = Math.max(SUBFLOW_HEADER_HEIGHT + 24, offsetY + innerGeometry.flowInputPoint.y);
  const incomingEntry = {
    x: offsetX + innerGeometry.flowInputBox.x,
    y: offsetY + innerGeometry.flowInputPoint.y,
  };
  return {
    blockId: block.id,
    childFlow,
    width,
    height,
    inputY,
    exitPositions,
    offsetX,
    offsetY,
    innerGraph,
    innerGeometry,
    innerPreviews,
    incomingEntry,
    endingRoutes: routes,
  };
}

export function computeSubflowPreviews({
  rootFlowId,
  graph,
  flows,
  agents,
  dimensions,
  collapsed,
  blocked,
  runCollapsed,
  arranged,
}: {
  readonly rootFlowId: string;
  readonly graph: CanvasGraph;
  readonly flows: ReadonlyMap<string, CanvasFlow>;
  readonly agents: readonly Pick<AgentDefinition, "id" | "exits">[];
  readonly dimensions: CanvasDimensions;
  readonly collapsed: ReadonlySet<string>;
  readonly blocked: ReadonlyMap<string, SubflowCollapseReason>;
  readonly runCollapsed?: ReadonlySet<string>;
  readonly arranged?: boolean;
}): ReadonlyMap<string, SubflowPreview> {
  const previews = new Map<string, SubflowPreview>();
  const affected = new Set<string>();
  for (const path of runCollapsed ?? []) {
    for (let slash = path.lastIndexOf("/"); slash > 0; slash = path.lastIndexOf("/", slash - 1))
      affected.add(path.slice(0, slash));
  }
  const build: PreviewBuild = {
    flows,
    agents,
    dimensions,
    ancestors: new Set([rootFlowId]),
    runCollapsed,
    affected,
    arranged,
    revisions: new Map(),
    ...previewBudget(graph, runCollapsed !== undefined),
  };
  for (const block of graph.blocks) {
    if (block.kind !== "subflow") continue;
    if (collapsed.has(block.id) || blocked.has(block.id)) continue;
    const key = placementKey("", block.id);
    if (runCollapsed?.has(key)) continue;
    const preview = buildSubflowPreview(block, key, build);
    if (preview) previews.set(block.id, preview);
  }
  return previews;
}

export function previewBlockFrame(
  previews: ReadonlyMap<string, SubflowPreview>,
): (block: FlowBlock) => BlockFrame | undefined {
  return (block) => {
    const preview = previews.get(block.id);
    if (!preview) return undefined;
    return {
      width: preview.width,
      height: preview.height,
      inputY: preview.inputY,
      exitY: (exitId) => preview.exitPositions.get(exitId),
    };
  };
}

export function displaceSubflowSiblings(
  graph: CanvasGraph,
  previews: ReadonlyMap<string, SubflowPreview>,
  dimensions: CanvasDimensions,
): CanvasGraph {
  if (!previews.size) return graph;
  const geometry = createCanvasGeometry(graph, dimensions, {
    prompt: "line",
    footerCount: executionFooters,
    blockFrame: previewBlockFrame(previews),
  });
  const items = [
    ...graph.blocks.map((block) => ({
      id: block.id,
      box: geometry.blockBox(block),
      group: previews.has(block.id),
    })),
    ...(geometry.finishBox ? [{ id: null, box: geometry.finishBox, group: false }] : []),
  ].sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y);
  const moved = new Map<string | null, { x: number; y: number }>();
  const occupied = [{ box: geometry.flowInputBox, group: false }];
  for (const { id, box, group } of items) {
    let x = box.x;
    for (const other of occupied) {
      const b = other.box;
      if (
        (group || other.group) &&
        box.y < b.y + b.height + 24 &&
        box.y + box.height + 24 > b.y &&
        x < b.x + b.width + 32 &&
        x + box.width > b.x
      ) {
        x = b.x + b.width + 32;
      }
    }
    const next = { ...box, x };
    const index = occupied.findIndex((other) => other.box.x > x);
    occupied.splice(index < 0 ? occupied.length : index, 0, { box: next, group });
    moved.set(id, { x, y: box.y });
  }
  return {
    ...graph,
    blocks: graph.blocks.map((block) => ({ ...block, position: moved.get(block.id)! })),
    ...(graph.finish && { finish: { ...graph.finish, position: moved.get(null)! } }),
  };
}

type ArrangeScope = (
  graph: FlowGraph,
  canvas: CanvasGraph,
  dimensions: FlowLayoutDimensions,
) => Promise<FlowLayoutResult>;

export async function arrangeSubflowComposition(
  root: FlowGraph,
  flows: ReadonlyMap<string, CanvasFlow>,
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
  dimensions: CanvasDimensions,
  arrange: ArrangeScope,
): Promise<FlowLayoutResult> {
  const arrangedFlows = new Map<string, CanvasFlow>();
  const geometryByFlow = new Map<string, PreviewGeometry>();

  async function visit(source: FlowGraph) {
    const graph = canvasGraph(source, agents, flows);
    const children = new Map<string, SubflowPreview>();
    for (const block of graph.blocks) {
      if (block.kind !== "subflow" || !block.flowId) continue;
      const child = flows.get(block.flowId)!;
      let arranged = geometryByFlow.get(child.id);
      if (!arranged) {
        const model = await visit(child.graph);
        const childFlow = { ...child, graph: model.positioned };
        arranged = {
          childFlow,
          innerGraph: model.graph,
          innerGeometry: model.geometry,
          innerPreviews: model.children,
        };
        geometryByFlow.set(child.id, arranged);
        arrangedFlows.set(child.id, childFlow);
      }
      children.set(
        block.id,
        frameSubflow(
          block,
          arranged.childFlow,
          arranged.innerGraph,
          arranged.innerGeometry,
          arranged.innerPreviews,
        ),
      );
    }
    const facts = {
      prompt: "line" as const,
      footerCount: executionFooters,
      blockFrame: previewBlockFrame(children),
    };
    const result = await arrange(
      source,
      graph,
      createFlowLayoutDimensions(graph, dimensions, facts, false),
    );
    const positioned = applyLayoutPositions(source, result);
    const drawn = canvasGraph(positioned, agents, flows);
    return {
      result,
      positioned,
      graph: drawn,
      geometry: createCanvasGeometry(drawn, dimensions, facts),
      children,
    };
  }
  const { result } = await visit(root);
  return { ...result, arrangedFlows };
}
