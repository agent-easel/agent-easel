import { CANVAS_MAX_FIT_SCALE, clampCanvasScale, type CanvasView } from "./canvas-viewport.ts";

export type GraphBounds = { minX: number; minY: number; width: number; height: number };

type BoundsRect = { x: number; y: number; width: number; height: number };

/** Axis-aligned bounds for a flow input origin plus sized blocks. */
export function mergeGraphBounds(origin: BoundsRect, blocks: readonly BoundsRect[]): GraphBounds {
  let minX = origin.x;
  let minY = origin.y;
  let maxX = origin.x + origin.width;
  let maxY = origin.y + origin.height;
  for (const block of blocks) {
    minX = Math.min(minX, block.x);
    minY = Math.min(minY, block.y);
    maxX = Math.max(maxX, block.x + block.width);
    maxY = Math.max(maxY, block.y + block.height);
  }
  return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function fitGraphView(
  bounds: GraphBounds,
  width: number,
  height: number,
  padding: { x: number; top: number; bottom: number },
): CanvasView {
  const available = height - padding.top - padding.bottom;
  const scale = clampCanvasScale(
    Math.min(
      CANVAS_MAX_FIT_SCALE,
      (width - padding.x * 2) / bounds.width,
      available / bounds.height,
    ),
  );
  return {
    scale,
    x: (width - bounds.width * scale) / 2 - bounds.minX * scale,
    y: padding.top + (available - bounds.height * scale) / 2 - bounds.minY * scale,
  };
}

type Size = { readonly width: number; readonly height: number };

const EPSILON = 0.001;

/** Where `box` lies after the shift: fully in the surface, fully outside it, or cut by its edge. */
function placement(box: BoundsRect, dx: number, dy: number, surface: Size) {
  const left = box.x + dx;
  const top = box.y + dy;
  const right = left + box.width;
  const bottom = top + box.height;
  if (
    left >= -EPSILON &&
    top >= -EPSILON &&
    right <= surface.width + EPSILON &&
    bottom <= surface.height + EPSILON
  )
    return "inside";
  if (
    right <= EPSILON ||
    bottom <= EPSILON ||
    left >= surface.width - EPSILON ||
    top >= surface.height - EPSILON
  )
    return "outside";
  return "cut";
}

/** Shifts on one axis that put some box's edge on a surface edge, and no shift. */
function edgeShifts(starts: readonly number[], ends: readonly number[], extent: number) {
  return [
    ...new Set([
      0,
      ...starts.flatMap((s) => [-s, extent - s]),
      ...ends.flatMap((e) => [-e, extent - e]),
    ]),
  ];
}

/**
 * `view` (at 100 %) moved by the smallest shift after which every box (in graph coordinates) is
 * fully inside the surface or fully outside it, keeping `focus` fully inside. Equal shifts prefer
 * the one that shows more boxes. When no such shift exists the view stays as it is.
 */
function minimalShift(
  view: CanvasView,
  focus: GraphBounds,
  boxes: readonly BoundsRect[],
  surface: Size,
): CanvasView {
  const screen = boxes.map((box) => ({ ...box, x: box.x + view.x, y: box.y + view.y }));
  const shown = {
    x: focus.minX + view.x,
    y: focus.minY + view.y,
    width: focus.width,
    height: focus.height,
  };
  const shifts = edgeShifts(
    screen.map((box) => box.x),
    screen.map((box) => box.x + box.width),
    surface.width,
  ).flatMap((dx) =>
    edgeShifts(
      screen.map((box) => box.y),
      screen.map((box) => box.y + box.height),
      surface.height,
    ).map((dy) => ({ dx, dy, distance: Math.hypot(dx, dy) })),
  );
  shifts.sort((a, b) => a.distance - b.distance);
  let best: { dx: number; dy: number; distance: number; shown: number } | undefined;
  for (const shift of shifts) {
    if (best && shift.distance > best.distance + EPSILON) break;
    if (placement(shown, shift.dx, shift.dy, surface) !== "inside") continue;
    const placements = screen.map((box) => placement(box, shift.dx, shift.dy, surface));
    if (placements.includes("cut")) continue;
    const count = placements.filter((where) => where === "inside").length;
    if (!best || count > best.shown) best = { ...shift, shown: count };
  }
  return best ? { scale: 1, x: view.x + best.dx, y: view.y + best.dy } : view;
}

/**
 * The view a Run canvas opens at: 100 %, centred on `target` between the covered top and bottom,
 * then moved by the minimal shift that cuts no box at the surface edge.
 */
export function entryView(
  target: GraphBounds,
  boxes: readonly BoundsRect[],
  surface: Size,
  padding: { top: number; bottom: number },
): CanvasView {
  const available = surface.height - padding.top - padding.bottom;
  const centred = {
    scale: 1,
    x: (surface.width - target.width) / 2 - target.minX,
    y: padding.top + (available - target.height) / 2 - target.minY,
  };
  return minimalShift(centred, target, boxes, surface);
}

/**
 * The view a Flow editor opens at: 100 %, the Flow input at the left margin and the graph centred
 * between the covered top and bottom (its top below the covered top when it is taller), then
 * moved by the minimal shift that cuts no box at the surface edge and keeps the Flow input visible.
 */
export function authoringEntryView(
  flowInput: BoundsRect,
  graph: GraphBounds,
  boxes: readonly BoundsRect[],
  surface: Size,
  padding: { x: number; top: number; bottom: number },
): CanvasView {
  const available = surface.height - padding.top - padding.bottom;
  const left = {
    scale: 1,
    x: padding.x - flowInput.x,
    y: padding.top + Math.max(0, (available - graph.height) / 2) - graph.minY,
  };
  return minimalShift(left, mergeGraphBounds(flowInput, []), boxes, surface);
}

/**
 * The smallest pan, at the current scale, that brings `target` fully into the surface; the view
 * itself when it already is. A target wider or taller than the surface keeps its left or top edge
 * in view.
 */
export function revealView(view: CanvasView, target: GraphBounds, surface: Size): CanvasView {
  const axis = (offset: number, start: number, extent: number, size: number) => {
    const from = offset + start * view.scale;
    const to = from + extent * view.scale;
    if (from >= 0 && to <= size) return offset;
    if (to - from > size || from < 0) return offset - from;
    return offset - (to - size);
  };
  return {
    scale: view.scale,
    x: axis(view.x, target.minX, target.width, surface.width),
    y: axis(view.y, target.minY, target.height, surface.height),
  };
}
