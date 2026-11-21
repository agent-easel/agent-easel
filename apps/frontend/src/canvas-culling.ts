import type { CanvasView } from "./canvas-viewport.ts";

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type Size = { readonly width: number; readonly height: number };

const STROKE_ROOM = 16;
const WINDOW_MARGIN_IN_VIEWS = 0.5;
const WINDOW_MAX_VIEWS = 4;

export function shownRect(view: CanvasView, size: Size): Rect {
  return {
    x: -view.x / view.scale,
    y: -view.y / view.scale,
    width: size.width / view.scale,
    height: size.height / view.scale,
  };
}

export function drawWindow(shown: Rect): Rect {
  const marginX = shown.width * WINDOW_MARGIN_IN_VIEWS;
  const marginY = shown.height * WINDOW_MARGIN_IN_VIEWS;
  return {
    x: shown.x - marginX,
    y: shown.y - marginY,
    width: shown.width + marginX * 2,
    height: shown.height + marginY * 2,
  };
}

export function windowFits(window: Rect, shown: Rect) {
  return (
    window.x <= shown.x &&
    window.y <= shown.y &&
    window.x + window.width >= shown.x + shown.width &&
    window.y + window.height >= shown.y + shown.height &&
    window.width <= shown.width * WINDOW_MAX_VIEWS &&
    window.height <= shown.height * WINDOW_MAX_VIEWS
  );
}

export function reaches(window: Rect, item: Rect, room = 0) {
  return (
    item.x - room <= window.x + window.width &&
    item.x + item.width + room >= window.x &&
    item.y - room <= window.y + window.height &&
    item.y + item.height + room >= window.y
  );
}

export const wireReaches = (window: Rect, bounds: Rect) => reaches(window, bounds, STROKE_ROOM);
