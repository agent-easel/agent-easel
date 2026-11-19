import { mergeGraphBounds } from "../../src/canvas-fit.ts";

/** Focus and 499 distinct Block positions just beyond both edges of the centred view. */
export function boundaryDenseEntryGraph() {
  const surface = { width: 1000, height: 600 };
  const focus = { minX: 0, minY: 0, width: 200, height: 100 };
  const boxes = [
    { x: 0, y: 0, width: focus.width, height: focus.height },
    ...Array.from({ length: 499 }, (_, index) => ({
      x: 600 + (index + 1) * 0.000001,
      y: 350 + (index + 1) * 0.000001,
      width: 200,
      height: 100,
    })),
  ];
  return { focus, boxes, surface, padding: { top: 0, bottom: 0 } };
}

/** Focus, one block cut by the centred right edge, then fully off-screen blocks with distinct edges. */
export function cutEntryGraph(count: number) {
  const boxes = [
    { x: 0, y: 0, width: 200, height: 100 },
    { x: 470, y: 0, width: 200, height: 100 },
  ];
  for (let index = 2; index < count; index += 1) {
    boxes.push({
      x: 20_000 + index * 97,
      y: 15_000 + index * 53,
      width: 180 + (index % 17),
      height: 70 + (index % 13),
    });
  }
  return {
    focus: { minX: 0, minY: 0, width: 200, height: 100 },
    boxes,
    surface: { width: 1000, height: 600 },
    padding: { top: 0, bottom: 0 },
  };
}

/** Flow input on the left and blocks far below it, each edge on its own coordinate. */
export function distantAuthoringGraph(count: number) {
  const flowInput = { x: 40, y: 50, width: 180, height: 70 };
  const blocks = Array.from({ length: count }, (_, index) => ({
    x: 280 + index * 37,
    y: 4000 + index * 41,
    width: 200 + (index % 11),
    height: 80 + (index % 7),
  }));
  return {
    flowInput,
    graph: mergeGraphBounds(flowInput, blocks),
    boxes: [flowInput, ...blocks],
    surface: { width: 1000, height: 600 },
    padding: { x: 48, top: 0, bottom: 0 },
  };
}
