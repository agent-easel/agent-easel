import { test } from "./support/test.ts";
import { expect } from "e2e";
import {
  expectFollowingReview,
  manualRunView,
  openFollowedLargeRun,
  openFollowedReviewRun,
  openLargeFlow,
  openLargeFlowPannedToFillers,
  openLargeFlowWithReturnedFiller,
  PAN_INTO_FILLERS,
  panFlowCanvas,
  runCanvasCenterOffset,
  runCanvasHorizontalOffset,
  wireEnds,
} from "./support/canvas.ts";
import { liveStates, liveRun } from "./support/live.ts";
import { renameFlow, saveFlowCopy } from "./support/flows.ts";

test("resizing the Flow editor keeps a manually zoomed view", async ({ app, screen, browser }) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await app.open("/studio/flows");
  await screen.getByRole("link", "Demo · Focused change", { exact: false }).tap();
  const canvas = screen.getByRole("region", "Flow canvas");
  // The editor opens at 100% with the Flow input near the canvas's left edge.
  await expect(canvas).toHaveAttribute("data-zoom", "1.000");
  const surface = (await canvas.boundingBox())!;
  const input = (await screen.getByRole("button", "Flow input", { exact: true }).boundingBox())!;
  expect(input.x - surface.x).toBeLessThan(80);
  await screen.getByRole("button", "Zoom in", { exact: true }).tap();
  await expect(canvas).toHaveAttribute("data-zoom", "1.100");
  await app.screenshot("flow-manual-zoom");

  // Act
  await browser.setViewport({ width: 1920, height: 1080 });

  // Assert
  await expect
    .poll(() => screen.getByRole("dialog", "Studio").boundingBox())
    .toMatchObject({ x: 16, y: 16, width: 1888, height: 1048 });
  await expect(canvas).toHaveAttribute("data-zoom", "1.100");
  await expect(screen.getByRole("button", "Flow input", { exact: true })).toBeVisible();
  await app.screenshot("flow-zoom-kept-on-resize");
});

test("a fitted Run preserves manual pan and zoom through resize and live updates", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const run = await liveRun(app, "canvas");
  await app.open(`/runs/${run}`);
  await screen.getByRole("button", "Auto-arrange", { exact: true }).tap();
  await expect(screen.getByRole("button", "Auto-arrange", { exact: true })).toBeEnabled();
  const expectViewKept = await manualRunView(screen, browser);
  await app.screenshot("run-manual-view");

  // Act
  await browser.setViewport({ width: 1800, height: 1000 });
  await liveStates(app, "canvas", ["working reported"], "Still aligning the picker spacing.");

  // Assert
  await expect(
    screen.getByText("Still aligning the picker spacing.", { exact: true }).first(),
  ).toBeVisible();
  await expectViewKept();
  await app.screenshot("run-view-preserved-after-resize-and-live-update");
});

test("opening a working Run at 100% shifts just enough to show the next Block", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const run = await liveRun(app, "entry-focus", "review");

  // Act
  await app.open(`/runs/${run}`);

  // Assert
  const canvas = screen.getByRole("region", "Execution canvas");
  await expect(canvas.getByRole("status", "Zoom level", { exact: true })).toHaveText("100%");
  const surface = (await canvas.boundingBox())!;
  const next = (await canvas
    .getByRole("article", "Block Review implementation", { exact: true })
    .boundingBox())!;
  // At this width, centering Implement change would clip the reviewer on the right.
  // The smallest shift puts the reviewer's right edge flush with the canvas edge.
  expect(next.x + next.width).toBeCloseTo(surface.x + surface.width);
  const activeOffset = await runCanvasCenterOffset(screen, "Implement change");
  expect(activeOffset.x).toBeLessThan(0);
  expect(Math.abs(activeOffset.y)).toBeLessThan(2);
  await app.screenshot("working-run-entry-focus");
});

test("a followed Run moves the view to the newly active Block", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFollowedReviewRun(app, screen, browser, "follow");

  // Act
  await liveStates(
    app,
    "follow",
    ["result reported", "result released to a second worker"],
    "Ready for review.",
  );

  // Assert
  await expectFollowingReview(screen);
  await app.screenshot("followed-run-moves-to-reviewer");
});

test("after a pan, a newly active Block marks Follow active instead of moving the view", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const canvas = await openFollowedReviewRun(app, screen, browser, "follow-off");
  await canvas.press("ArrowRight");
  const layer = browser.locator('[aria-label="Execution canvas"] > div[style]');
  const panned = await layer.getAttribute("style");

  // Act
  await liveStates(
    app,
    "follow-off",
    ["result reported", "result released to a second worker"],
    "Ready for review.",
  );

  // Assert
  await expect(
    screen.getByRole("button", "Follow active, active Blocks changed", { exact: true }),
  ).toBeVisible();
  await expect(canvas).toHaveAttribute("data-following", "false");
  await expect(layer).toHaveAttribute("style", panned!);
  await app.screenshot("follow-active-marked-after-pan");
});

test("Follow active resumes following on the newly active Block", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const canvas = await openFollowedReviewRun(app, screen, browser, "follow-resume");
  await canvas.press("ArrowRight");
  await liveStates(
    app,
    "follow-resume",
    ["result reported", "result released to a second worker"],
    "Ready for review.",
  );
  const marked = screen.getByRole("button", "Follow active, active Blocks changed", {
    exact: true,
  });
  await expect(marked).toBeVisible();

  // Act
  await marked.tap();

  // Assert
  await expectFollowingReview(screen);
  await app.screenshot("follow-active-resumed");
});

test("period recenters the focused Run canvas and resumes following after a pan", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const canvas = await openFollowedReviewRun(app, screen, browser, "follow-shortcut");
  await canvas.press("ArrowRight");
  await liveStates(
    app,
    "follow-shortcut",
    ["result reported", "result released to a second worker"],
    "Ready for review.",
  );
  await expect(canvas).toHaveAttribute("data-following", "false");
  await expect(
    screen.getByRole("button", "Follow active, active Blocks changed", { exact: true }),
  ).toBeVisible();

  // Act
  await canvas.press(".");

  // Assert
  expect(await runCanvasHorizontalOffset(screen, "Review implementation")).toBeLessThan(2);
  await expect(canvas).toHaveAttribute("data-following", "true");
  await expect(screen.getByRole("button", "Follow active", { exact: true })).toBeVisible();
  await app.screenshot("follow-active-shortcut-resumed");
});

test("a healthy live Run on its current Flow revision shows icon-only canvas controls and no badges", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const run = await liveRun(app, "exceptions-only");

  // Act
  await app.open(`/runs/${run}`);

  // Assert
  const canvas = screen.getByRole("region", "Execution canvas");
  await expect(canvas.getByRole("button", "Zoom in", { exact: true })).toBeVisible();
  await expect(canvas.getByRole("button", "Fit Flow", { exact: true })).toHaveText("");
  await expect(canvas.getByRole("button", "Follow active", { exact: true })).toHaveText("");
  await expect(canvas.getByRole("button", "Auto-arrange", { exact: true })).toHaveText("");
  await expect(canvas.getByRole("button", "Canvas shortcuts", { exact: true })).toBeVisible();
  await expect(canvas.getByRole("status", "Flow revision")).toHaveCount(0);
  await expect(canvas.getByRole("status", "Run observation")).toHaveCount(0);
  await expect(canvas.getByText(/Focus the canvas/)).toHaveCount(0);
  await app.screenshot("run-canvas-exceptions-only");
});

test("saving a Run's Flow after Start shows the revision badge on the open Run", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const name = "Canvas revision · Focused change";
  const flow = await saveFlowCopy(app.baseUrl, "Demo · Focused change", name, { mode: "checkout" });
  const run = await liveRun(app, "revision-badge", { id: flow });
  await app.open(`/runs/${run}`);
  const badge = screen.getByRole("status", "Flow revision");
  await expect(screen.getByRole("button", "Canvas shortcuts", { exact: true })).toBeVisible();
  await expect(badge).toHaveCount(0);

  // Act
  await renameFlow(app.baseUrl, flow, `${name} (edited)`);

  // Assert
  await expect(badge).toContainText("Flow edited since Start");
  await expect(badge).toContainText("this Run keeps the revision captured");
  await app.screenshot("run-canvas-flow-edited-since-start");
});

const CROSSING_WIRE = "Connection exit from Filler 0 to Filler 100";

test("panning keeps focus on an unselected wire that leaves the view", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openLargeFlow({ app, screen, browser });
  const wire = screen.getByRole("button", "Connection exit from Filler 0 to Filler 1", {
    exact: true,
  });
  await wire.focus();
  await expect(wire).toBeFocused();
  await expect(wire).toHaveAttribute("aria-pressed", "false");

  // Act
  await panFlowCanvas(browser, PAN_INTO_FILLERS);

  // Assert
  await expect(screen.getByRole("article", "Block Filler 1", { exact: true })).toHaveCount(0);
  await expect(wire).toBeFocused();
});

test("panning keeps focus on a Block with a multiline ID that leaves the view", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openLargeFlow({ app, screen, browser });
  const block = screen.getByRole("button", "Wait Filler 0", { exact: true });
  await block.focus();
  await expect(block).toBeFocused();

  // Act
  await panFlowCanvas(browser, PAN_INTO_FILLERS);

  // Assert
  await expect(screen.getByRole("article", "Block Filler 1", { exact: true })).toHaveCount(0);
  await expect(block).toBeFocused();
});

test("a large Flow panned into its filler rows draws only the Blocks near the view and the wires crossing it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openLargeFlow({ app, screen, browser });

  // Act
  await panFlowCanvas(browser, PAN_INTO_FILLERS);

  // Assert
  await expect(screen.getByRole("article", "Block Filler 0", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("article", "Block Filler 100", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", CROSSING_WIRE, { exact: true })).toHaveCount(1);
  expect(
    await browser.evaluate<number>('document.querySelectorAll("[data-block-id]").length'),
  ).toBeLessThan(80);
  await app.screenshot("large-flow-culled-view");
});

test("a Block returning to view finds its wires exactly where they were drawn while it was away", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openLargeFlowPannedToFillers({ app, screen, browser });
  const away = await wireEnds(browser, CROSSING_WIRE, "Filler 0", "Filler 100");

  // Act
  await panFlowCanvas(browser, -PAN_INTO_FILLERS);

  // Assert
  await expect(screen.getByRole("article", "Block Filler 0", { exact: true })).toHaveCount(1);
  const back = await wireEnds(browser, CROSSING_WIRE, "Filler 0", "Filler 100");
  expect(away).not.toBeNull();
  expect(back?.d).toBe(away?.d);
  expect(back?.start).toBeLessThanOrEqual(0.5);
  expect(back?.end).toBeNull();
  const neighbour = await wireEnds(
    browser,
    "Connection exit from Filler 0 to Filler 1",
    "Filler 0",
    "Filler 1",
  );
  expect(neighbour?.start).toBeLessThanOrEqual(0.5);
  expect(neighbour?.end).toBeLessThanOrEqual(0.5);
  await app.screenshot("large-flow-block-back-in-view");
});

test("a Block that returned to view opens its settings when pressed", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openLargeFlowWithReturnedFiller({ app, screen, browser });

  // Act
  await screen.getByRole("button", "Wait Filler 0", { exact: true }).tap();

  // Assert
  await expect(
    screen.getByRole("complementary", "Block settings").getByLabel("Name", { exact: true }),
  ).toHaveValue("Filler 0");
});

test("dragging a Block that returned to view moves it and its wires", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openLargeFlowWithReturnedFiller({ app, screen, browser });
  const press = (await screen.getByRole("button", "Wait Filler 0", { exact: true }).boundingBox())!;
  const x = press.x + press.width / 2;
  const y = press.y + press.height / 2;

  // Act
  await browser.mouse.move(x, y);
  await browser.mouse.down();
  await browser.mouse.move(x + 40, y - 120);
  await browser.mouse.up();

  // Assert
  await expect
    .poll(
      async () =>
        (await screen.getByRole("button", "Wait Filler 0", { exact: true }).boundingBox())!.y,
    )
    .toBeLessThan(y - 100 - press.height / 2);
  const wire = await wireEnds(
    browser,
    "Connection exit from Filler 0 to Filler 1",
    "Filler 0",
    "Filler 1",
  );
  expect(wire?.start).toBeLessThanOrEqual(0.5);
  expect(wire?.end).toBeLessThanOrEqual(0.5);
});

test("a Block that returned to view can be rewired by dragging its output port", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openLargeFlowWithReturnedFiller({ app, screen, browser });
  const newWire = screen.getByRole("button", "Connection exit from Filler 0 to Filler 4", {
    exact: true,
  });
  await expect(newWire).toHaveCount(0);

  // Act
  await screen
    .getByRole("button", "Connect output of Filler 0", { exact: true })
    .dragTo(screen.getByRole("article", "Block Filler 4", { exact: true }));

  // Assert
  await expect(newWire).toHaveCount(1);
});

test("following a large Run brings its offscreen active Block into view without drawing the Blocks between", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const canvas = await openFollowedLargeRun(app, screen, browser, "large-follow");
  await expect(
    canvas.getByRole("article", "Block Review implementation", { exact: true }),
  ).toHaveCount(0);

  // Act
  await liveStates(
    app,
    "large-follow",
    ["result reported", "result released to a second worker"],
    "Ready for review.",
  );

  // Assert
  await expectFollowingReview(screen);
  await expect(canvas.getByRole("article", "Block Filler 0", { exact: true })).toHaveCount(0);
  await app.screenshot("large-run-followed-to-offscreen-reviewer");
});
