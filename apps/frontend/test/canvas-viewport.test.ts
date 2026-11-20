import { block, event, runDetail } from "./support/run.ts";
import {
  decideAutoFollow,
  selectEntryTargets,
  selectExecutionTargets,
} from "../src/execution-focus.ts";
import { authoringEntryView, entryView, fitGraphView } from "../src/canvas-fit.ts";
import {
  boundaryDenseEntryGraph,
  cutEntryGraph,
  distantAuthoringGraph,
} from "./support/entry-graphs.ts";
import { expect, it } from "vite-plus/test";
import {
  canvasWheelZoomFactor,
  canvasGestureZoomScale,
  canvasWheelZoomScale,
  normalizeWheelDelta,
  zoomCanvasAtLocalPoint,
  type CanvasView,
} from "../src/canvas-viewport.ts";

it("wheel zoom factor grows when the user scrolls up", () => {
  // Arrange
  const deltaY = -10;

  // Act
  const factor = canvasWheelZoomFactor(normalizeWheelDelta(deltaY, 0, 800));

  // Assert
  expect(factor).toBeCloseTo(1.0512710964, 10);
});

it("wheel zoom factor caps one large scroll step at exp(0.2)", () => {
  // Arrange
  const deltaY = -10_000;

  // Act
  const factor = canvasWheelZoomFactor(normalizeWheelDelta(deltaY, 0, 800));

  // Assert
  expect(factor).toBeCloseTo(1.2214027582, 10);
});

it("wheel zoom scale clamps at the minimum canvas scale", () => {
  // Arrange
  const currentScale = 0.21;

  // Act
  const next = canvasWheelZoomScale(currentScale, normalizeWheelDelta(500, 0, 800));

  // Assert
  expect(next).toBe(0.2);
});

it("wheel zoom scale clamps at the maximum canvas scale", () => {
  // Arrange
  const currentScale = 1.95;

  // Act
  const next = canvasWheelZoomScale(currentScale, normalizeWheelDelta(-500, 0, 800));

  // Assert
  expect(next).toBe(2);
});

it("zoom at a local point keeps that graph point under the cursor", () => {
  // Arrange
  const view: CanvasView = { x: 40, y: 60, scale: 1 };
  const localX = 200;
  const localY = 150;
  const worldX = (localX - view.x) / view.scale;
  const worldY = (localY - view.y) / view.scale;

  // Act
  const next = zoomCanvasAtLocalPoint(view, localX, localY, 1.5);

  // Assert
  expect((localX - next.x) / next.scale).toBeCloseTo(worldX, 10);
  expect((localY - next.y) / next.scale).toBeCloseTo(worldY, 10);
  expect(next.scale).toBe(1.5);
});

it("a large Safari pinch step is capped", () => {
  // Arrange
  const scale = 1;

  // Act
  const next = canvasGestureZoomScale(scale, 3);

  // Assert
  expect(next).toBeCloseTo(1.2214027582, 10);
});

it("an invalid Safari ratio preserves the viewport scale", () => {
  // Arrange
  const scale = 0.8;

  // Act
  const next = canvasGestureZoomScale(scale, NaN);

  // Assert
  expect(next).toBe(scale);
});

it("a working Block takes precedence over an error Block", () => {
  // Arrange
  const blocks = [
    { blockId: "active", state: "working" as const },
    { blockId: "failed", state: "error" as const },
  ];

  // Act
  const targets = selectExecutionTargets(withoutContinuations(blocks));

  // Assert
  expect(targets).toStrictEqual(["active"]);
});

it("entry framing never enlarges a small target above 100 percent", () => {
  // Arrange
  const target = { minX: 0, minY: 0, width: 200, height: 100 };

  // Act
  const view = fitGraphView(target, 1200, 800, { x: 0, top: 0, bottom: 0 });

  // Assert
  expect(view).toStrictEqual({ x: 500, y: 350, scale: 1 });
});

it("an off-origin target is centered at full scale", () => {
  // Arrange
  const target = { minX: 500, minY: 100, width: 200, height: 100 };

  // Act
  const view = fitGraphView(target, 1200, 800, { x: 0, top: 0, bottom: 0 });

  // Assert
  expect(view).toStrictEqual({ x: 0, y: 250, scale: 1 });
  expect(view.x + (target.minX + target.width / 2) * view.scale).toBe(600);
  expect(view.y + (target.minY + target.height / 2) * view.scale).toBe(400);
});

it("a target at the graph edge stays centered", () => {
  // Arrange
  const target = { minX: -1000, minY: 0, width: 200, height: 100 };

  // Act
  const view = fitGraphView(target, 1000, 600, { x: 0, top: 0, bottom: 0 });

  // Assert
  expect(view).toStrictEqual({ x: 1400, y: 250, scale: 1 });
});

it("parallel target bounds fit together inside the padded viewport", () => {
  // Arrange
  const targets = { minX: 200, minY: 100, width: 200, height: 1000 };

  // Act
  const view = fitGraphView(targets, 1200, 800, { x: 48, top: 64, bottom: 80 });

  // Assert
  expect(view.scale).toBeCloseTo(0.656);
  expect(view.x + 300 * view.scale).toBeCloseTo(600);
  expect(view.y + 600 * view.scale).toBeCloseTo(392);
});

const withoutContinuations = <Blocks>(blocks: Blocks) => ({
  blocks,
  continuationVisits: [],
  threadBindings: [],
});

it("a sent Continuation is the target instead of the Agent whose thread works on its prompt", () => {
  // Arrange
  const run = {
    blocks: [
      { blockId: "grill", state: "working" as const },
      { blockId: "tickets", state: "sent" as const },
    ],
    continuationVisits: [
      { blockId: "tickets", kind: "prompt" as const, bindingId: "grill-thread" },
    ],
    threadBindings: [{ id: "grill-thread", blockId: "grill" }],
  };

  // Act
  const targets = selectExecutionTargets(run);

  // Assert
  expect(targets).toStrictEqual(["tickets"]);
});

const surface = { width: 1000, height: 600 };
const noCover = { top: 0, bottom: 0 };
const targetBox = { x: 0, y: 0, width: 200, height: 100 };
const targetBounds = { minX: 0, minY: 0, width: 200, height: 100 };

it("the entry view centres the active Blocks at 100 percent when no Block is cut", () => {
  // Arrange
  const boxes = [targetBox, { x: 300, y: 0, width: 200, height: 100 }];

  // Act
  const view = entryView(targetBounds, boxes, surface, noCover);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 400, y: 250 });
});

it("a Block cut at the canvas edge moves the entry view by the smallest shift that clears it", () => {
  // Arrange
  const cut = { x: -450, y: 0, width: 200, height: 100 };

  // Act
  const view = entryView(targetBounds, [targetBox, cut], surface, noCover);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 450, y: 250 });
});

it("of two equally small entry shifts the one showing more Blocks wins", () => {
  // Arrange
  const cut = { x: -500, y: 0, width: 200, height: 100 };

  // Act
  const view = entryView(targetBounds, [targetBox, cut], surface, noCover);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 500, y: 250 });
});

it("waiting and parallel working Blocks are all targets", () => {
  // Arrange
  const blocks = [
    { blockId: "human", state: "waiting" as const },
    { blockId: "worker", state: "working" as const },
  ];

  // Act
  const targets = selectExecutionTargets(withoutContinuations(blocks));

  // Assert
  expect(targets).toStrictEqual(["human", "worker"]);
});

it("no active Block selects no target", () => {
  // Arrange
  const blocks = [{ blockId: "done", state: "finished" as const }];

  // Act
  const targets = selectExecutionTargets(withoutContinuations(blocks));

  // Assert
  expect(targets).toStrictEqual([]);
});

it("a failed Run targets its error-state Blocks", () => {
  // Arrange
  const blocks = [
    { blockId: "done", state: "finished" as const },
    { blockId: "failed", state: "error" as const },
  ];

  // Act
  const targets = selectExecutionTargets(withoutContinuations(blocks));

  // Assert
  expect(targets).toStrictEqual(["failed"]);
});

it("auto-follow animates to a newly active Block while following", () => {
  // Arrange
  const change = { seen: ["worker"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: true,
    visibility: "visible",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("animate");
});

it("auto-follow jumps instead of animating under reduced motion", () => {
  // Arrange
  const change = { seen: ["worker"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: true,
    visibility: "visible",
    reducedMotion: true,
  });

  // Assert
  expect(action).toBe("jump");
});

it("auto-follow only indicates a changed active Block when following is off", () => {
  // Arrange
  const change = { seen: ["worker"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: false,
    visibility: "visible",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("indicate");
});

it("auto-follow does not move a hidden canvas", () => {
  // Arrange
  const change = { seen: ["worker"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: true,
    visibility: "hidden",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("nothing");
});

it("returning to the canvas jumps once to Blocks that became active while hidden", () => {
  // Arrange
  const change = { seen: ["worker"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: true,
    visibility: "returned",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("jump");
});

it("returning after an interrupted animation jumps to its already seen destination", () => {
  // Arrange
  const change = { seen: ["reviewer"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: true,
    visibility: "returned",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("jump");
});

it("returning with following off preserves the manually chosen view for an already seen target", () => {
  // Arrange
  const change = { seen: ["reviewer"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: false,
    visibility: "returned",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("nothing");
});

it("a visible canvas does not repeat the jump after returning to its seen target", () => {
  // Arrange
  const change = { seen: ["reviewer"], targets: ["reviewer"] };

  // Act
  const action = decideAutoFollow({
    ...change,
    following: true,
    visibility: "visible",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("nothing");
});

it("a Run that fails while following animates to its error Block", () => {
  // Arrange
  const blocks = [
    { blockId: "worker", state: "finished" as const },
    { blockId: "reviewer", state: "error" as const },
  ];

  // Act
  const action = decideAutoFollow({
    seen: ["worker"],
    targets: selectExecutionTargets(withoutContinuations(blocks)),
    following: true,
    visibility: "visible",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("animate");
});

it("a Run that succeeds while following keeps the view on its last Block", () => {
  // Arrange
  const blocks = [{ blockId: "worker", state: "finished" as const }];

  // Act
  const action = decideAutoFollow({
    seen: ["worker"],
    targets: selectExecutionTargets(withoutContinuations(blocks)),
    following: true,
    visibility: "visible",
    reducedMotion: false,
  });

  // Assert
  expect(action).toBe("nothing");
});

it("a Run without active work opens on the most recently changed finished Block", () => {
  // Arrange
  const run = {
    ...runDetail(),
    blocks: [
      { ...block("review"), state: "finished" as const },
      { ...block("implement"), state: "finished" as const },
    ],
    events: [
      { ...event(1), blockId: "implement", kind: "report-accepted" as const },
      { ...event(2), blockId: "review", kind: "human-answered" as const },
    ],
  };

  // Act
  const targets = selectEntryTargets(run, []);

  // Assert
  expect(targets).toStrictEqual(["review"]);
});

it("a later attention resolution on an earlier finished Block does not displace the last visit", () => {
  // Arrange
  const run = {
    ...runDetail(),
    blocks: [
      { ...block("review"), state: "finished" as const },
      { ...block("implement"), state: "finished" as const },
    ],
    events: [
      { ...event(1), blockId: "implement", kind: "report-accepted" as const },
      { ...event(2), blockId: "review", kind: "report-accepted" as const },
      { ...event(3), blockId: "implement", kind: "attention-settled" as const },
      { ...event(4), blockId: "implement", kind: "execution-observed" as const },
    ],
  };

  // Act
  const targets = selectEntryTargets(run, []);

  // Assert
  expect(targets).toStrictEqual(["review"]);
});

it("entry focus uses the latest stopped visit when it is newer than an earlier finish", () => {
  // Arrange
  const run = {
    ...runDetail(),
    blocks: [
      { ...block("review"), state: "stopped" as const },
      { ...block("implement"), state: "finished" as const },
    ],
    events: [
      { ...event(1), blockId: "implement", kind: "report-accepted" as const },
      { ...event(2), blockId: "review", kind: "worker-stopped" as const },
    ],
  };

  // Act
  const targets = selectEntryTargets(run, []);

  // Assert
  expect(targets).toStrictEqual(["review"]);
});

it("the Flow editor opens at 100 percent with the Flow input at the left margin and no Block cut", () => {
  // Arrange
  const flowInput = { x: 40, y: 50, width: 180, height: 70 };
  const blocks = [
    { x: 300, y: 40, width: 224, height: 100 },
    { x: 600, y: 40, width: 224, height: 100 },
    { x: 900, y: 40, width: 224, height: 100 },
  ];
  const graph = { minX: 40, minY: 40, width: 1084, height: 100 };
  const padding = { x: 48, top: 0, bottom: 0 };

  // Act
  const view = authoringEntryView(flowInput, graph, [flowInput, ...blocks], surface, padding);

  // Assert
  const shown = (box: { x: number; width: number }): [number, number] => [
    box.x + view.x,
    box.x + box.width + view.x,
  ];
  expect(view.scale).toBe(1);
  expect(shown(flowInput)[0]).toBeGreaterThanOrEqual(0);
  expect(shown(flowInput)[1]).toBeLessThanOrEqual(surface.width);
  expect(
    blocks.map(shown).filter(([left, right]) => left < surface.width && right > surface.width),
  ).toStrictEqual([]);
});

it("a diagonal clearance keeps the minimal shift with every Block wholly in or out", () => {
  // Arrange
  const focus = { minX: 0, minY: 0, width: 200, height: 100 };
  const boxes = [
    { x: 0, y: 0, width: 200, height: 100 },
    { x: 390, y: 20, width: 220, height: 80 },
    { x: 40, y: 210, width: 180, height: 120 },
  ];

  // Act
  const view = entryView(focus, boxes, surface, noCover);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 390, y: 250 });
});

it("a subpixel shift reveals a Block that was just outside the centred view", () => {
  // Arrange
  const focus = { minX: 0, minY: 0, width: 200, height: 100 };
  const boxes = [
    { x: 0, y: 0, width: 200, height: 100 },
    { x: -400.0012, y: -240, width: 0.001, height: 20 },
  ];

  // Act
  const view = entryView(focus, boxes, surface, noCover);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 400.0002, y: 250 });
});

it("an oversized target keeps the centred view when no shift can contain it", () => {
  // Arrange
  const focus = { minX: 0, minY: 0, width: 2000, height: 100 };
  const boxes = [{ x: 0, y: 0, width: 2000, height: 100 }];

  // Act
  const view = entryView(focus, boxes, surface, noCover);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: -500, y: 250 });
});

it("the Flow editor shifts on both axes to clear a cut Block and keep the input visible", () => {
  // Arrange
  const flowInput = { x: 16, y: 0, width: 180, height: 100 };
  const cut = { x: 200, y: 180, width: 240, height: 140 };
  const boxes = [flowInput, cut];
  const graph = { minX: 16, minY: 0, width: 424, height: 320 };
  const padding = { x: 16, top: 24, bottom: 16 };

  // Act
  const view = authoringEntryView(flowInput, graph, boxes, { width: 800, height: 600 }, padding);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 0, y: 144 });
});

it("a 500-block entry view keeps the minimal shift and resolves quickly", () => {
  // Arrange
  const graph = cutEntryGraph(500);
  const started = performance.now();

  // Act
  const view = entryView(graph.focus, graph.boxes, graph.surface, graph.padding);

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 330, y: 250 });
  expect(performance.now() - started).toBeLessThan(100);
});

it("a 500-block Flow editor keeps the open placement and resolves quickly", () => {
  // Arrange
  const graph = distantAuthoringGraph(500);
  const started = performance.now();

  // Act
  const view = authoringEntryView(
    graph.flowInput,
    graph.graph,
    graph.boxes,
    graph.surface,
    graph.padding,
  );

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 8, y: -50 });
  expect(performance.now() - started).toBeLessThan(100);
});

it("a clear 500-block view opens promptly with fractional positions at the canvas corner", () => {
  // Arrange
  const graph = boundaryDenseEntryGraph();
  const started = performance.now();

  // Act
  const view = entryView(graph.focus, graph.boxes, graph.surface, graph.padding);
  const elapsed = performance.now() - started;

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 400, y: 250 });
  expect(elapsed).toBeLessThan(100);
});

it("the Flow editor can shift farther than a quarter width to clear a cut Block while keeping the input visible", () => {
  // Arrange
  const flowInput = { x: 16, y: 0, width: 180, height: 100 };
  const cut = { x: 585, y: 0, width: 240, height: 100 };
  const graph = { minX: 16, minY: 0, width: 809, height: 100 };
  const padding = { x: 16, top: 0, bottom: 0 };

  // Act
  const view = authoringEntryView(
    flowInput,
    graph,
    [flowInput, cut],
    { width: 800, height: 600 },
    padding,
  );

  // Assert
  expect(view).toStrictEqual({ scale: 1, x: 215, y: 250 });
});
