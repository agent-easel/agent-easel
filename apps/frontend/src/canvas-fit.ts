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

type Interval = { lo: number; hi: number };
type IndexedShift = { dy: number; index: number };
type Candidate = { dx: number; dy: number; distance: number; order: number };

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

/** Shown-box count when the shift keeps focus inside and cuts no box; otherwise `undefined`. */
function clearCount(
  screen: readonly BoundsRect[],
  shown: BoundsRect,
  dx: number,
  dy: number,
  surface: Size,
) {
  if (placement(shown, dx, dy, surface) !== "inside") return undefined;
  let shownCount = 0;
  for (const box of screen) {
    const where = placement(box, dx, dy, surface);
    if (where === "cut") return undefined;
    if (where === "inside") shownCount += 1;
  }
  return shownCount;
}

/**
 * The minimal-distance clear shift, then any shift within an epsilon of the one just chosen when
 * it shows more boxes. `order` is the Cartesian position of that pair, so equal distances keep
 * the same winner as sorting the full product.
 */
function chooseShift(
  candidates: Candidate[],
  accept: (dx: number, dy: number) => number | undefined,
) {
  candidates.sort((a, b) => a.distance - b.distance || a.order - b.order);
  let best: (Candidate & { shown: number }) | undefined;
  for (const candidate of candidates) {
    if (best && candidate.distance > best.distance + EPSILON) break;
    const shownCount = accept(candidate.dx, candidate.dy);
    if (shownCount === undefined) continue;
    if (!best || shownCount > best.shown) best = { ...candidate, shown: shownCount };
  }
  return best;
}

function axisInside(start: number, end: number, delta: number, extent: number) {
  return start + delta >= -EPSILON && end + delta <= extent + EPSILON;
}

function axisOutside(start: number, end: number, delta: number, extent: number) {
  return end + delta <= EPSILON || start + delta >= extent - EPSILON;
}

function containedSpan(start: number, end: number, extent: number) {
  const lo = -EPSILON - start;
  const hi = extent + EPSILON - end;
  return lo <= hi ? { lo, hi } : undefined;
}

function openGap(lo: number, hi: number) {
  return lo < hi ? { lo, hi } : undefined;
}

/** Vertical shifts that still cut a box already overlapping the viewport on x. */
function verticalGaps(top: number, bottom: number, extent: number, allowInside: boolean) {
  const outside = openGap(EPSILON - bottom, extent - EPSILON - top);
  if (!allowInside) return outside ? [outside] : [];
  const contained = containedSpan(top, bottom, extent);
  if (!contained) return outside ? [outside] : [];
  return [
    openGap(EPSILON - bottom, contained.lo),
    openGap(contained.hi, extent - EPSILON - top),
  ].flatMap((gap) => (gap ? [gap] : []));
}

function unionOpen(intervals: readonly Interval[]) {
  const sorted = intervals
    .filter((interval) => interval.lo < interval.hi)
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.lo < last.hi) last.hi = Math.max(last.hi, interval.hi);
    else merged.push({ lo: interval.lo, hi: interval.hi });
  }
  return merged;
}

/** `base` minus open cuts. Endpoints stay: a box edge sitting on the surface edge is not cut. */
function subtractOpen(base: Interval, cuts: readonly Interval[]) {
  const parts: Interval[] = [];
  let cursor = base.lo;
  for (const cut of cuts) {
    if (cut.hi < cursor) continue;
    if (cut.lo > base.hi) break;
    if (cut.lo > cursor) parts.push({ lo: cursor, hi: Math.min(base.hi, cut.lo) });
    else if (cut.lo === cursor && cursor <= base.hi) parts.push({ lo: cursor, hi: cursor });
    cursor = Math.max(cursor, cut.hi);
    if (cursor > base.hi) break;
  }
  if (cursor <= base.hi) parts.push({ lo: cursor, hi: base.hi });
  return parts.filter((part) => part.lo <= part.hi);
}

function bound(sorted: readonly IndexedShift[], value: number, inclusive: boolean) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const dy = sorted[mid]?.dy ?? (inclusive ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
    if (inclusive ? dy <= value : dy < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function shiftsBetween(sorted: readonly IndexedShift[], lo: number, hi: number) {
  return lo <= hi ? sorted.slice(bound(sorted, lo, false), bound(sorted, hi, true)) : [];
}

function closestDy(parts: readonly Interval[], sorted: readonly IndexedShift[]) {
  let best: IndexedShift | undefined;
  for (const part of parts) {
    const found = shiftsBetween(sorted, part.lo, part.hi);
    for (const shift of found) {
      if (!best || Math.abs(shift.dy) < Math.abs(best.dy)) best = shift;
    }
  }
  return best;
}

function withinLimit(best: IndexedShift | undefined, shift: IndexedShift, limit: number) {
  if (Math.abs(shift.dy) > limit) return false;
  return !best || Math.abs(shift.dy) < Math.abs(best.dy);
}

/** The next clear dy after the nearest candidate was rejected. */
function laterClearDy(
  parts: readonly Interval[],
  sorted: readonly IndexedShift[],
  limit: number,
  accepts: (dy: number) => boolean,
) {
  let best: IndexedShift | undefined;
  for (const part of parts) {
    for (const shift of shiftsBetween(sorted, part.lo, part.hi)) {
      if (!withinLimit(best, shift, limit) || !accepts(shift.dy)) continue;
      best = shift;
    }
  }
  return best;
}

/** Dy inside `parts` that keeps the boxes clear, preferring the one nearest zero. */
function firstClearDy(
  parts: readonly Interval[],
  sorted: readonly IndexedShift[],
  limit: number,
  accepts: (dy: number) => boolean,
) {
  const closest = closestDy(parts, sorted);
  if (!closest || Math.abs(closest.dy) > limit) return undefined;
  return accepts(closest.dy) ? closest : laterClearDy(parts, sorted, limit, accepts);
}

function allowedDy(
  dx: number,
  shown: BoundsRect,
  screen: readonly BoundsRect[],
  surface: Size,
  focusY: Interval,
) {
  if (!axisInside(shown.x, shown.x + shown.width, dx, surface.width)) return undefined;
  const forbidden: Interval[] = [];
  for (const box of screen) {
    const start = box.x;
    const end = start + box.width;
    const overlapping = axisInside(start, end, dx, surface.width);
    if (!overlapping && axisOutside(start, end, dx, surface.width)) continue;
    forbidden.push(...verticalGaps(box.y, box.y + box.height, surface.height, overlapping));
  }
  return subtractOpen(focusY, unionOpen(forbidden));
}

type AxisShift = { dx: number; index: number };

function byMagnitude(xShifts: readonly number[]) {
  return xShifts
    .map((dx, index) => ({ dx, index }))
    .sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx) || a.index - b.index);
}

function byValue(yShifts: readonly number[]) {
  return yShifts
    .map((dy, index) => ({ dy, index }))
    .sort((a, b) => a.dy - b.dy || a.index - b.index);
}

function minimumDistance(
  orderedX: readonly AxisShift[],
  sortedY: readonly IndexedShift[],
  shown: BoundsRect,
  screen: readonly BoundsRect[],
  surface: Size,
  focusY: Interval,
  accept: (dx: number, dy: number) => number | undefined,
) {
  let dFirst = Number.POSITIVE_INFINITY;
  for (const shift of orderedX) {
    if (Math.abs(shift.dx) > dFirst) break;
    const parts = allowedDy(shift.dx, shown, screen, surface, focusY);
    if (!parts) continue;
    const closest = firstClearDy(
      parts,
      sortedY,
      dFirst,
      (dy) => accept(shift.dx, dy) !== undefined,
    );
    if (!closest) continue;
    dFirst = Math.min(dFirst, Math.hypot(shift.dx, closest.dy));
  }
  return Number.isFinite(dFirst) ? dFirst : undefined;
}

function collectWithin(
  candidates: Candidate[],
  shift: AxisShift,
  parts: readonly Interval[],
  sortedY: readonly IndexedShift[],
  yCount: number,
  dLimit: number,
) {
  const yLimit = Math.sqrt(Math.max(0, dLimit * dLimit - shift.dx * shift.dx));
  for (const part of parts) {
    const shifts = shiftsBetween(sortedY, Math.max(part.lo, -yLimit), Math.min(part.hi, yLimit));
    for (const dy of shifts) {
      const distance = Math.hypot(shift.dx, dy.dy);
      if (distance > dLimit) continue;
      candidates.push({
        dx: shift.dx,
        dy: dy.dy,
        distance,
        order: shift.index * yCount + dy.index,
      });
    }
  }
}

function candidatesWithin(
  orderedX: readonly AxisShift[],
  sortedY: readonly IndexedShift[],
  shown: BoundsRect,
  screen: readonly BoundsRect[],
  surface: Size,
  focusY: Interval,
  yCount: number,
  dLimit: number,
) {
  const candidates: Candidate[] = [];
  for (const shift of orderedX) {
    if (Math.abs(shift.dx) > dLimit) break;
    const parts = allowedDy(shift.dx, shown, screen, surface, focusY);
    if (!parts) continue;
    collectWithin(candidates, shift, parts, sortedY, yCount, dLimit);
  }
  return candidates;
}

/**
 * Pairs whose distance can beat the first clear shift. The shown-count chain extends that
 * distance by at most one epsilon per box.
 */
function boundedShift(
  screen: readonly BoundsRect[],
  shown: BoundsRect,
  xShifts: readonly number[],
  yShifts: readonly number[],
  surface: Size,
) {
  const focusY = containedSpan(shown.y, shown.y + shown.height, surface.height);
  if (!focusY || !containedSpan(shown.x, shown.x + shown.width, surface.width)) return undefined;
  const sortedY = byValue(yShifts);
  const orderedX = byMagnitude(xShifts);
  const accept = (dx: number, dy: number) => clearCount(screen, shown, dx, dy, surface);
  const dFirst = minimumDistance(orderedX, sortedY, shown, screen, surface, focusY, accept);
  if (dFirst === undefined) return undefined;
  return chooseShift(
    candidatesWithin(
      orderedX,
      sortedY,
      shown,
      screen,
      surface,
      focusY,
      yShifts.length,
      dFirst + screen.length * EPSILON,
    ),
    accept,
  );
}

/** Shifts close enough to the origin to win the shown-count tie when the centred view is already clear. */
function nearOriginShift(
  screen: readonly BoundsRect[],
  shown: BoundsRect,
  xShifts: readonly number[],
  yShifts: readonly number[],
  surface: Size,
) {
  const band = screen.length * EPSILON;
  const dxs = xShifts.filter((dx) => Math.abs(dx) <= band);
  const dys = yShifts.filter((dy) => Math.abs(dy) <= band);
  const candidates = dxs.flatMap((dx, xi) =>
    dys.map((dy, yi) => ({
      dx,
      dy,
      distance: Math.hypot(dx, dy),
      order: xi * dys.length + yi,
    })),
  );
  return chooseShift(candidates, (dx, dy) => clearCount(screen, shown, dx, dy, surface));
}

/**
 * `view` (at 100 %) moved by the smallest shift after which every box (in graph coordinates) is
 * fully inside the surface or fully outside it, keeping `focus` fully inside. Equal shifts prefer
 * the one that shows more boxes. When no such shift exists the view stays as it is.
 *
 * The centred view is decided before any pair of edge alignments is built. A clear view only
 * considers the sub-pixel band that can reveal more boxes; a cut view walks alignments in
 * increasing magnitude.
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
  const xShifts = edgeShifts(
    screen.map((box) => box.x),
    screen.map((box) => box.x + box.width),
    surface.width,
  );
  const yShifts = edgeShifts(
    screen.map((box) => box.y),
    screen.map((box) => box.y + box.height),
    surface.height,
  );
  const chosen =
    clearCount(screen, shown, 0, 0, surface) === undefined
      ? boundedShift(screen, shown, xShifts, yShifts, surface)
      : nearOriginShift(screen, shown, xShifts, yShifts, surface);
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
