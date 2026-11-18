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
 * The view a Run canvas opens at: 100 %, centred on `target` between the covered top and bottom,
 * then moved by the smallest shift after which every box (in graph coordinates) is fully inside
 * the surface or fully outside it, keeping `target` fully inside. Equal shifts prefer the one that
 * shows more boxes. When no such shift exists the view stays centred.
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
  const screen = boxes.map((box) => ({ ...box, x: box.x + centred.x, y: box.y + centred.y }));
  const focus = {
    x: target.minX + centred.x,
    y: target.minY + centred.y,
    width: target.width,
    height: target.height,
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
    if (placement(focus, shift.dx, shift.dy, surface) !== "inside") continue;
    const placements = screen.map((box) => placement(box, shift.dx, shift.dy, surface));
    if (placements.includes("cut")) continue;
    const shown = placements.filter((where) => where === "inside").length;
    if (!best || shown > best.shown) best = { ...shift, shown };
  }
  return best ? { scale: 1, x: centred.x + best.dx, y: centred.y + best.dy } : centred;
}
