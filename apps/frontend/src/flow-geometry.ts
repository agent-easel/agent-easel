import {
  createNodeGeometry,
  exitRows,
  type CanvasDimensions,
  type GeometryFacts,
} from "@t3-factory/flow-layout";
import {
  FINISH_SELECTION,
  type CanvasBlockSelection,
  type CanvasBlock,
  type CanvasGraph,
} from "./flow-graph.ts";
import { EXECUTION_DIMENSIONS } from "./components/canvas-dimensions.ts";
import { mergeGraphBounds } from "./canvas-fit.ts";
import type { Rect } from "./canvas-culling.ts";

type Point = { x: number; y: number };
export function createCanvasGeometry(
  graph: CanvasGraph,
  dimensions: CanvasDimensions,
  facts: GeometryFacts<CanvasBlock> = {},
) {
  const input = dimensions.flowInput;
  const {
    ports,
    incoming,
    flowInputBox,
    finishBox,
    finishEndingY,
    blockWidth,
    blockHeight,
    blockInputY,
    blockExitY,
    reservedHeight,
    incomingGrowth,
  } = createNodeGeometry(graph, dimensions, facts);
  const finishBoxes = finishBox ? [finishBox] : [];
  const rowOf = exitRows(graph.blocks);
  const blockBox = (block: CanvasBlock) => ({
    ...block.position,
    width: blockWidth(block),
    height: blockHeight(block),
  });
  const bounds = () => {
    const box = mergeGraphBounds(flowInputBox, [...graph.blocks.map(blockBox), ...finishBoxes]);
    return graph.blocks.length || !facts.emptyGraphSize
      ? box
      : {
          ...box,
          width: Math.max(box.width, facts.emptyGraphSize.width),
          height: Math.max(box.height, facts.emptyGraphSize.height),
        };
  };
  const inputPoint = (block: CanvasBlock, index: number): Point => ({
    x: block.position.x,
    y: block.position.y + blockInputY(block, index),
  });
  const incomingPorts = (block: CanvasBlock) =>
    incoming.wires(block.id).map((source, index) => ({
      source,
      ...inputPoint(block, index),
    }));
  const focusBounds = (targetIds: readonly CanvasBlockSelection[]) => {
    const ids = new Set(targetIds);
    const [first, ...rest] = [
      ...graph.blocks.filter((block) => ids.has(block.id)).map(blockBox),
      ...(ids.has(FINISH_SELECTION) ? finishBoxes : []),
    ];
    return first ? mergeGraphBounds(first, rest) : bounds();
  };
  return {
    ports,
    flowInputBox,
    /** The Flow input and every block, in graph coordinates. */
    boxes: () => [flowInputBox, ...graph.blocks.map(blockBox), ...finishBoxes],
    blockBox,
    finishBox,
    endingPoint: (index: number): Point => ({
      x: finishBox!.x,
      y: finishBox!.y + finishEndingY + index * ports.exitRow,
    }),
    blockHeight,
    bounds,
    incomingPorts,
    /** The input port a wire from `source` attaches to on the target block. */
    incomingPortIndex: incoming.portIndex,
    reservedHeight,
    focusBounds,
    inputPoint,
    /** A block's drawn exit by id; undefined when the block draws no such exit. */
    exit: (block: CanvasBlock, exitId: string) => {
      const row = rowOf(block.id, exitId);
      return row === undefined ? undefined : block.exits[row];
    },
    exitPoint: (block: CanvasBlock, exitId: string): Point => {
      const index = rowOf(block.id, exitId) ?? 0;
      return {
        x: block.position.x + blockWidth(block),
        y: block.position.y + blockExitY(block, exitId, index),
      };
    },
    flowInputPoint: {
      x: graph.flowInput.position.x + input.width,
      y: graph.flowInput.position.y + input.outputY,
    },
    /** Room below the rows for incoming ports. */
    incomingGrowth,
  };
}

export function pointsBounds(points: readonly Point[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Forward connections curve; backward and self connections route above both blocks. */
export function wirePath(from: Point, to: Point, approachLane = 0) {
  if (to.x > from.x + 40) {
    const bend = Math.max(40, (to.x - from.x) / 2);
    return {
      d: `M${from.x},${from.y} C${from.x + bend},${from.y} ${to.x - bend},${to.y} ${to.x},${to.y}`,
      label: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      bounds: pointsBounds([from, to]),
    };
  }
  const top = Math.max(8, Math.min(from.y, to.y) - 70);
  const away = to.x - 20 - approachLane;
  return {
    d: `M${from.x},${from.y} H${from.x + 20} V${top} H${away} V${to.y} H${to.x}`,
    label: { x: (from.x + to.x) / 2, y: top },
    bounds: pointsBounds([from, to, { x: from.x + 20, y: top }, { x: away, y: top }]),
  };
}

const CORNER = 4;
/** Ports are 10 px circles centred on the block edge; edges start and end at their rims. */
export const PORT_RIM = EXECUTION_DIMENSIONS.port.size / 2;

/** A polyline with 4 px rounded corners (Figma execution edges). */
export function roundedPolyline(points: readonly Point[]) {
  const [first, ...rest] = points;
  if (!first) return "";
  let d = `M${first.x},${first.y}`;
  rest.forEach((point, index) => {
    const previous = points[index] ?? first;
    const next = rest[index + 1];
    if (!next) {
      d += ` L${point.x},${point.y}`;
      return;
    }
    const inLength = Math.hypot(point.x - previous.x, point.y - previous.y);
    const outLength = Math.hypot(next.x - point.x, next.y - point.y);
    const radius = Math.min(CORNER, inLength / 2, outLength / 2);
    const before = {
      x: point.x - (Math.sign(point.x - previous.x) * radius || 0),
      y: point.y - (Math.sign(point.y - previous.y) * radius || 0),
    };
    const after = {
      x: point.x + (Math.sign(next.x - point.x) * radius || 0),
      y: point.y + (Math.sign(next.y - point.y) * radius || 0),
    };
    d += ` L${before.x},${before.y} Q${point.x},${point.y} ${after.x},${after.y}`;
  });
  return d;
}

/**
 * Orthogonal execution edge in one neutral style: forward connections bend at the
 * midpoint; backward and self connections run below both blocks (`below`).
 */
export function orthogonalWirePath(exit: Point, input: Point, below: number, approachLane = 0) {
  const from = { x: exit.x + PORT_RIM, y: exit.y };
  const to = { x: input.x - PORT_RIM, y: input.y };
  const approachX = to.x - 16 - approachLane;
  const middle = Math.round((from.x + to.x) / 2);
  const points =
    to.x > from.x + 24
      ? [from, { x: middle, y: from.y }, { x: middle, y: to.y }, to]
      : [
          from,
          { x: from.x + 12, y: from.y },
          { x: from.x + 12, y: below },
          { x: approachX, y: below },
          { x: approachX, y: to.y },
          to,
        ];
  return { d: roundedPolyline(points), bounds: pointsBounds(points) };
}

/** Horizontal lane offset for backward manual routes so returns do not share one vertical. */
export function incomingApproachLane(index: number) {
  return index * 14;
}
