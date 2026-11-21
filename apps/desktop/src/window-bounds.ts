export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const isInteger = (value: unknown): value is number => Number.isInteger(value);

export function parseWindowBounds(value: unknown): WindowBounds | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

const overlaps = (a: WindowBounds, b: WindowBounds) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const titleBarHeight = 40;

export function restorableBounds(
  saved: WindowBounds | null,
  workAreas: readonly WindowBounds[],
): WindowBounds | null {
  if (!saved) return null;
  const titleBar = { ...saved, height: Math.min(titleBarHeight, saved.height) };
  return workAreas.some((area) => overlaps(titleBar, area)) ? saved : null;
}
