export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly maximized?: true;
  readonly fullScreen?: true;
}

export interface WindowBoundsSnapshot {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isFullScreen(): boolean;
  isMaximized(): boolean;
  getNormalBounds(): WindowBounds;
}

export interface RevealableWindow extends WindowBoundsSnapshot {
  maximize(): void;
  restore(): void;
  show(): void;
}

const isInteger = (value: unknown): value is number => Number.isInteger(value);

export function parseWindowBounds(value: unknown): WindowBounds | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height, maximized, fullScreen } = value as Record<string, unknown>;
  if (!isInteger(x) || !isInteger(y) || !isInteger(width) || !isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (fullScreen === true) return { x, y, width, height, fullScreen: true };
  if (maximized === true) return { x, y, width, height, maximized: true };
  return { x, y, width, height };
}

export function captureWindowBounds(
  target: WindowBoundsSnapshot,
  previous: WindowBounds | null,
): WindowBounds | null {
  if (target.isDestroyed() || target.isMinimized()) return previous;
  const { x, y, width, height } = target.getNormalBounds();
  if (target.isFullScreen()) return { x, y, width, height, fullScreen: true };
  if (target.isMaximized()) return { x, y, width, height, maximized: true };
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

export class WindowBoundsTracker {
  private saved: WindowBounds | null;
  private ready = false;
  private pendingMaximize = false;

  constructor(saved: WindowBounds | null) {
    this.saved = saved;
  }

  prepareOpen(workAreas: readonly WindowBounds[]): WindowBounds | null {
    const restorable = restorableBounds(this.saved, workAreas);
    if (!restorable) this.saved = null;
    this.ready = false;
    this.pendingMaximize = restorable?.maximized === true && !restorable.fullScreen;
    return restorable;
  }

  reveal(target: RevealableWindow): boolean {
    if (this.ready) {
      if (target.isMinimized()) target.restore();
      target.show();
      return false;
    }
    if (this.pendingMaximize) {
      this.pendingMaximize = false;
      if (!target.isMaximized() && !target.isFullScreen()) target.maximize();
    }
    if (target.isMinimized()) target.restore();
    target.show();
    this.ready = true;
    if (this.saved === null) {
      this.saved = captureWindowBounds(target, null);
      return true;
    }
    return false;
  }

  revealInitial(target: RevealableWindow): boolean {
    if (this.ready) return false;
    return this.reveal(target);
  }

  capture(target: WindowBoundsSnapshot | null): WindowBounds | null {
    if (target && this.ready) this.saved = captureWindowBounds(target, this.saved);
    return this.saved;
  }

  closed(): void {
    this.ready = false;
    this.pendingMaximize = false;
  }
}
