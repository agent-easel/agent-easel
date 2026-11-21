export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function isWindowBounds(value: unknown): value is WindowBounds {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  return (
    Number.isInteger(bounds.x) &&
    Number.isInteger(bounds.y) &&
    Number.isInteger(bounds.width) &&
    Number.isInteger(bounds.height) &&
    (bounds.width as number) > 0 &&
    (bounds.height as number) > 0
  );
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
