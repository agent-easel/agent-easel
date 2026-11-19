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

type IndexRange = { start: number; end: number };
type Candidate = { dx: number; dy: number; distance: number; order: number };
type AxisShift = { delta: number; index: number };

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
  ].map((delta, index) => ({ delta, index }));
}

function canEnterAxis(start: number, size: number, extent: number) {
  return start + EPSILON >= -EPSILON && start - EPSILON + size <= extent + EPSILON;
}

/** A clear view only has a competitor if a tolerance-sized shift can bring a box inside. */
function canKeepView(screen: readonly BoundsRect[], focus: BoundsRect, surface: Size) {
  if (placement(focus, 0, 0, surface) !== "inside") return false;
  return screen.every((box) => {
    const where = placement(box, 0, 0, surface);
    if (where === "cut") return false;
    return (
      where === "inside" ||
      !canEnterAxis(box.x, box.width, surface.width) ||
      !canEnterAxis(box.y, box.height, surface.height)
    );
  });
}

/** The first shift satisfying a monotone edge test, or the end of the list. */
function firstShift(sorted: readonly AxisShift[], predicate: (delta: number) => boolean) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (predicate(sorted[mid]!.delta)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function verticalInside(
  box: BoundsRect,
  sortedY: readonly AxisShift[],
  height: number,
): IndexRange {
  return {
    start: firstShift(sortedY, (dy) => box.y + dy >= -EPSILON),
    end: firstShift(sortedY, (dy) => box.y + dy + box.height > height + EPSILON),
  };
}

function verticalOverlap(
  box: BoundsRect,
  sortedY: readonly AxisShift[],
  height: number,
): IndexRange {
  return {
    start: firstShift(sortedY, (dy) => box.y + dy + box.height > EPSILON),
    end: firstShift(sortedY, (dy) => box.y + dy >= height - EPSILON),
  };
}

type IndexedBox = {
  box: BoundsRect;
  inside: IndexRange;
  overlap: IndexRange;
};

function addRange(counts: Int32Array, { start, end }: IndexRange, change: number) {
  if (start >= end) return;
  counts[start]! += change;
  counts[end]! -= change;
}

/** Mark where this box is shown or cut for one horizontal shift. */
function countBox(
  { box, inside, overlap }: IndexedBox,
  dx: number,
  width: number,
  visible: Int32Array,
  cuts: Int32Array,
) {
  const left = box.x + dx;
  const right = left + box.width;
  const fits = left >= -EPSILON && right <= width + EPSILON;
  if (fits) addRange(visible, inside, 1);
  if (right <= EPSILON || left >= width - EPSILON) return;

  addRange(cuts, overlap, 1);
  if (fits) {
    addRange(
      cuts,
      { start: Math.max(overlap.start, inside.start), end: Math.min(overlap.end, inside.end) },
      -1,
    );
  }
}

function compareCandidates(a: Candidate, b: Candidate) {
  return a.distance - b.distance || a.order - b.order;
}

/** Only the first candidate at each visible count can win the distance tie. */
function chooseShift(nearest: ReadonlyMap<number, Candidate>) {
  const candidates = [...nearest].sort(([, a], [, b]) => compareCandidates(a, b));
  let best: Candidate | undefined;
  let shown = -1;
  for (const [count, candidate] of candidates) {
    if (best && candidate.distance > best.distance + EPSILON) break;
    if (count <= shown) continue;
    best = candidate;
    shown = count;
  }
  return best;
}

/** Scan one row of edge alignments with constant-time placement counts per vertical shift. */
function scanVerticalShifts(
  x: AxisShift,
  sortedY: readonly AxisShift[],
  focusY: IndexRange,
  counts: { visible: Int32Array; cuts: Int32Array },
  nearest: Map<number, Candidate>,
  limit: number,
) {
  let visible = 0;
  let cuts = 0;
  let first = Number.POSITIVE_INFINITY;
  for (let i = 0; i < focusY.end; i += 1) {
    visible += counts.visible[i]!;
    cuts += counts.cuts[i]!;
    if (i < focusY.start || cuts !== 0) continue;
    const y = sortedY[i]!;
    if (Math.abs(y.delta) > limit) continue;
    const distance = Math.hypot(x.delta, y.delta);
    if (distance > limit) continue;
    first = Math.min(first, distance);
    const order = x.index * sortedY.length + y.index;
    const previous = nearest.get(visible);
    if (
      !previous ||
      distance < previous.distance ||
      (distance === previous.distance && order < previous.order)
    )
      nearest.set(visible, { dx: x.delta, dy: y.delta, distance, order });
  }
  return first;
}

/**
 * Index each box's vertical spans once. Each horizontal shift then needs a single pass over
 * the boxes and the vertical shifts, with no materialized product of candidate pairs.
 */
function boundedShift(screen: readonly BoundsRect[], focus: BoundsRect, surface: Size) {
  const sortedY = edgeShifts(
    screen.map((box) => box.y),
    screen.map((box) => box.y + box.height),
    surface.height,
  ).sort((a, b) => a.delta - b.delta);
  const focusY = verticalInside(focus, sortedY, surface.height);
  if (focusY.start >= focusY.end) return undefined;

  const orderedX = edgeShifts(
    screen.map((box) => box.x),
    screen.map((box) => box.x + box.width),
    surface.width,
  ).sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  const indexed = screen.map((box) => ({
    box,
    inside: verticalInside(box, sortedY, surface.height),
    overlap: verticalOverlap(box, sortedY, surface.height),
  }));
  const nearest = new Map<number, Candidate>();
  const visible = new Int32Array(sortedY.length + 1);
  const cuts = new Int32Array(sortedY.length + 1);
  // Each tie can extend the distance by at most one epsilon while adding at least one box.
  const band = screen.length * EPSILON;
  let first = Number.POSITIVE_INFINITY;
  for (const x of orderedX) {
    if (Math.abs(x.delta) > first + band) break;
    const left = focus.x + x.delta;
    if (left < -EPSILON || left + focus.width > surface.width + EPSILON) continue;
    visible.fill(0);
    cuts.fill(0);
    for (const box of indexed) countBox(box, x.delta, surface.width, visible, cuts);
    const rowFirst = scanVerticalShifts(
      x,
      sortedY,
      focusY,
      { visible, cuts },
      nearest,
      first + band,
    );
    first = Math.min(first, rowFirst);
  }
  return chooseShift(nearest);
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
  if (canKeepView(screen, shown, surface)) return view;
  const chosen = boundedShift(screen, shown, surface);
  return chosen ? { scale: 1, x: view.x + chosen.dx, y: view.y + chosen.dy } : view;
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
