import {
  type AgentDefinition,
  type FlowBlock,
  type FlowDraft,
  type FlowGraph,
  type FlowReadiness,
} from "@t3-factory/contracts";
import {
  canvasGraph,
  type BlockFrame,
  type CanvasBlock,
  type CanvasDimensions,
  type CanvasGraph,
} from "@t3-factory/flow-layout";
import { createCanvasGeometry } from "./flow-geometry.ts";

export const SUBFLOW_HEADER_HEIGHT = 36;
const SUBFLOW_PADDING = { top: 20, right: 32, bottom: 20, left: 32 } as const;
const SUBFLOW_MIN_WIDTH = 360;
const SUBFLOW_MIN_HEIGHT = 180;
const BROKEN_EXIT_STEP = 24;
const MAX_PREVIEW_NODES = 120;

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

export type SubflowPreview = {
  readonly blockId: string;
  readonly childFlow: FlowDraft;
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
  flows: ReadonlyMap<string, FlowDraft>,
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
  childFlow: FlowDraft,
  innerGeometry: ReturnType<typeof createCanvasGeometry>,
  offsetY: number,
  bodyBottom: number,
) {
  const exitPositions = new Map<string, number>();
  const endingRoutes: SubflowEndingRoute[] = [];
  const finishRight = innerGeometry.finishBox.x + innerGeometry.finishBox.width;
  childFlow.graph.finish.endings.forEach((ending, index) => {
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

function buildSubflowPreview(
  block: CanvasBlock,
  flows: ReadonlyMap<string, FlowDraft>,
  agents: readonly Pick<AgentDefinition, "id" | "exits">[],
  dimensions: CanvasDimensions,
  ancestors: ReadonlySet<string>,
  budget: { remaining: number },
): SubflowPreview | null {
  if (block.kind !== "subflow" || block.flowId === null) return null;
  if (ancestors.has(block.flowId) || budget.remaining <= 0) return null;
  const childFlow = flows.get(block.flowId);
  if (!childFlow) return null;
  const childNodes = childFlow.graph.blocks.length + 2;
  if (childNodes > budget.remaining) return null;
  budget.remaining -= childNodes;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(childFlow.id);
  const innerGraph = canvasGraph(childFlow.graph, agents, flows);
  const innerPreviews = new Map<string, SubflowPreview>();
  for (const innerBlock of innerGraph.blocks) {
    const nested = buildSubflowPreview(
      innerBlock,
      flows,
      agents,
      dimensions,
      nextAncestors,
      budget,
    );
    if (nested) innerPreviews.set(innerBlock.id, nested);
  }
  const innerGeometry = createCanvasGeometry(innerGraph, dimensions, {
    finish: true,
    blockFrame: previewBlockFrame(innerPreviews),
  });
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
}: {
  readonly rootFlowId: string;
  readonly graph: CanvasGraph;
  readonly flows: ReadonlyMap<string, FlowDraft>;
  readonly agents: readonly Pick<AgentDefinition, "id" | "exits">[];
  readonly dimensions: CanvasDimensions;
  readonly collapsed: ReadonlySet<string>;
  readonly blocked: ReadonlyMap<string, SubflowCollapseReason>;
}): ReadonlyMap<string, SubflowPreview> {
  const previews = new Map<string, SubflowPreview>();
  const ancestors = new Set<string>([rootFlowId]);
  const budget = { remaining: MAX_PREVIEW_NODES };
  for (const block of graph.blocks) {
    if (block.kind !== "subflow") continue;
    if (collapsed.has(block.id) || blocked.has(block.id)) continue;
    const preview = buildSubflowPreview(block, flows, agents, dimensions, ancestors, budget);
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
