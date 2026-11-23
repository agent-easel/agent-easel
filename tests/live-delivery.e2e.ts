import type { Browser } from "@e2e-dev/web";
import { test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import type { Fixture } from "./support/fixture/handle.ts";
import {
  browserRequests,
  delayLiveSnapshots,
  liveStates,
  liveRun,
  openLiveSockets,
  resetBrowserRequests,
} from "./support/live.ts";
import { manualRunView } from "./support/canvas.ts";
import { findRun } from "./support/run-history.ts";
import { applyRunState, prepareScenario } from "./support/scenarios.ts";
import { elapse, openApproved, openRemoteBrowser } from "./support/remote-access.ts";

const writes = expect.arrayContaining([expect.stringMatching(/^(POST|PUT|PATCH|DELETE) /)]);

/** What a browser reports when the user switches tabs or hides the window. */
const setVisibility = (state: "hidden" | "visible") => `(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "${state}" });
  document.dispatchEvent(new Event("visibilitychange"));
})()`;

/** Opens the Run actions menu and returns its Archive item; a read-only Run offers it disabled. */
async function runActionsArchive(screen: Screen) {
  await screen.getByRole("button", "Run actions", { exact: true }).tap();
  return screen.getByRole("menuitem", "Archive…", { exact: true });
}

/** A live Run shows neither Not live marker and offers Archive. */
async function expectLiveAndWritable(screen: Screen, browser: Browser) {
  await expect(screen.getByRole("status", "Observation freshness")).toHaveCount(0);
  await expect(screen.getByRole("status", "Run observation")).toHaveCount(0);
  await expect(await runActionsArchive(screen)).toBeEnabled();
  await browser.keyboard.press("Escape");
}

test("an Agent's MCP report updates the open Run and the sidebar without polling", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1000 });
  const run = await liveRun(app, "report");
  await app.open(`/runs/${run}`);
  const row = screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link", /Demo · Live report · Tidy the project picker/);
  await expect(row).toContainText("Working");
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toHaveText(/^Started /);
  await app.screenshot("live-run-before-report");
  // The trace sees this browser's reads, so an empty trace later means no requests.
  expect(await browserRequests(app)).toEqual(expect.arrayContaining(["GET /api/projects"]));
  await resetBrowserRequests(app);

  // Act
  await liveStates(app, "report", ["result reported", "settled"], "Picker spacing tidied.");

  // Assert
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toHaveText(/^Settled /);
  await expect(row).toHaveCount(0);
  await app.screenshot("live-run-after-report");
  // Longer than several former polling periods of Run, navigation and connection reads.
  await elapse(8_000);
  expect(await browserRequests(app)).toEqual([]);
});

test("an ending reached while the sidebar is open shows in the preview while stopping, as a badge once Settled, and with Output missing after a reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1000 });
  const { id: run } = await prepareScenario(app, "ending-approval-open");
  await app.open(`/runs/${run}`);
  const open = screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link", /Ending waits for your approval/);
  const preview = browser.locator('[data-slot="tooltip-content"]');
  await open.hover();
  await expect(preview).toBeVisible();
  await expect(preview).not.toContainText("Approved");
  await browser.keyboard.press("Escape");
  await screen.getByRole("navigation", "Sidebar footer").hover();

  // Act
  await applyRunState(app, run, "Stop taken while the turn continues");
  await applyRunState(app, run, "approved without a message");

  // Assert
  await screen.getByRole("navigation", "Sidebar footer").hover();
  await open.hover();
  await expect(preview).toContainText("Approved");
  await expect(preview).toContainText("Stopping");
  await expect(preview).toContainText("Output missing");
  await expect(open).not.toContainText("Approved");
  await expect(browser.locator(`#run-row-${run}-description`)).toHaveText("Output missing");
  await app.screenshot("ending-preview-while-stopping");
  await browser.keyboard.press("Escape");
  await screen.getByRole("navigation", "Sidebar footer").hover();
  await applyRunState(app, run, "stopped turns ended");
  const settled = screen
    .getByRole("navigation", "Settled Runs")
    .getByRole("link", /Ending waits for your approval/);
  const badge = browser.locator(`#run-row-${run} [data-slot="status-badge"]`);
  await expect(settled).toBeVisible();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Approved");
  await expect(settled).not.toContainText("Output missing");
  await app.screenshot("ending-badge-settled");
  await app.open(`/runs/${run}`);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Approved");
  await settled.hover();
  await expect(preview).toContainText("Approved");
  await expect(preview).toContainText("Output missing");
  await app.screenshot("ending-output-missing-after-reload");
});

const outputMissingTitle = "Demo · Ended · Approved without the required release notes link";

async function withdrawnSettledRow(app: App, screen: Screen, browser: Browser, fixture: Fixture) {
  await browser.setViewport({ width: 1440, height: 1000 });
  const { id, project } = await findRun(app.baseUrl, outputMissingTitle);
  await fixture.projects.withdraw({ id: project.id });
  await app.open("/runs/new");
  await screen.getByRole("button", /^Settled \d+$/).tap();
  await expect(browser.locator(`#run-row-${id}`)).toContainText("not in T3");
  const badges = browser.locator(`#run-row-${id} [data-slot="status-badge"]`);
  await expect(badges).toHaveCount(2);
  return { id, ending: badges.nth(0), notInT3: badges.nth(1) };
}

function notInT3Overflow(browser: Browser, id: string) {
  return browser.evaluate<{ line: number; label: number }>(
    `(() => {
      const meta = document.getElementById(${JSON.stringify(`run-row-${id}`)}).firstElementChild;
      const label = meta.querySelectorAll('[data-slot="status-badge"]')[1].lastElementChild;
      return { line: meta.scrollWidth - meta.clientWidth, label: label.scrollWidth - label.clientWidth };
    })()`,
  );
}

test("a Settled Run that recorded Output missing shows its ending on the row, and Output missing only in the preview, after a reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1000 });
  const { id } = await findRun(app.baseUrl, outputMissingTitle);
  await app.open("/runs/new");
  await screen.getByRole("button", /^Settled \d+$/).tap();
  const row = browser.locator(`#run-row-${id}`);
  const badge = browser.locator(`#run-row-${id} [data-slot="status-badge"]`);
  const preview = browser.locator('[data-slot="tooltip-content"]');

  // Act
  await app.open("/runs/new");
  await screen.getByRole("button", /^Settled \d+$/).tap();
  await row.hover();

  // Assert
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Approved");
  await expect(row).not.toContainText("Output missing");
  await expect(preview).toContainText("Output missing");
  await app.screenshot("ending-output-missing-preview");
  await browser.evaluate(
    "document.documentElement.style.setProperty('--factory-sidebar-width', '224px')",
  );
  expect((await badge.boundingBox())!.width).toBeLessThanOrEqual(64);
  await app.screenshot("ending-badge-narrow-sidebar");
});

test("at the 224 px sidebar a Settled Run not in T3 keeps its meta line on one line, with the ending as its flag and Not in T3 in full", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const { id, ending, notInT3 } = await withdrawnSettledRow(app, screen, browser, fixture);

  // Act
  await browser.evaluate(
    "document.documentElement.style.setProperty('--factory-sidebar-width', '224px')",
  );

  // Assert
  await expect(notInT3).toHaveText("Not in T3");
  await expect(ending).toBeVisible();
  await expect(ending.getByText("Approved")).toBeHidden();
  expect(await notInT3Overflow(browser, id)).toEqual({ line: 0, label: 0 });
  await app.screenshot("ending-not-in-t3-narrow-sidebar");
});

test("at the default 300 px sidebar a Settled Run not in T3 shortens its ending so Not in T3 shows in full", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const { id, ending, notInT3 } = await withdrawnSettledRow(app, screen, browser, fixture);

  // Act
  await browser.evaluate(
    "document.documentElement.style.setProperty('--factory-sidebar-width', '300px')",
  );

  // Assert
  await expect(notInT3).toHaveText("Not in T3");
  await expect(ending.getByText("Approved")).toBeVisible();
  await expect(browser.locator(`#run-row-${id} time`)).toBeVisible();
  expect(await notInT3Overflow(browser, id)).toEqual({ line: 0, label: 0 });
  await app.screenshot("ending-not-in-t3-default-sidebar");
});

test("a lost live connection keeps the last Run read-only, then resynchronizes without replaying commands", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1000 });
  await openRemoteBrowser(app);
  const run = await liveRun(app, "recovery");
  await openApproved(app, `/runs/${run}`);
  await expectLiveAndWritable(screen, browser);
  await fixture.remoteAccess.offline();
  await expect(screen.getByRole("status", "Offline")).toBeVisible({ timeout: 10_000 });
  const notLive = screen.getByRole("status", "Observation freshness");
  await expect(notLive).toContainText("Not live · last observed");
  await expect(screen.getByRole("status", "Run observation")).toContainText("Not live");
  await expect(await runActionsArchive(screen)).toBeDisabled();
  await browser.keyboard.press("Escape");
  await liveStates(app, "recovery", ["working reported"], "Checked the picker on narrow screens.");
  await expect(screen.getByText("Checked the picker on narrow screens.")).toHaveCount(0);
  await expect(
    screen.getByRole("heading", /Live recovery · Tidy the project picker/),
  ).toBeVisible();
  await app.screenshot("live-offline-cached-run");
  await delayLiveSnapshots(app, 3_000);
  await resetBrowserRequests(app);

  // Act
  await fixture.remoteAccess.online();

  // Assert
  await expect(
    screen.getByRole("navigation", "Sidebar footer").getByRole("status", "Synchronizing"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(notLive).toContainText("Not live");
  await expect(
    screen.getByRole("heading", /Live recovery · Tidy the project picker/),
  ).toBeVisible();
  await app.screenshot("live-synchronizing");
  await expect(
    screen.getByText("Checked the picker on narrow screens.", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("status", "Synchronizing")).toHaveCount(0);
  await expectLiveAndWritable(screen, browser);
  await app.screenshot("live-resynchronized");
  expect(await browserRequests(app)).not.toEqual(writes);
});

test("a hidden window detaches live delivery and catches up when shown, keeping the canvas view", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const run = await liveRun(app, "visibility");
  await app.open(`/runs/${run}`);
  await screen.getByRole("button", "Agent Implement change", { exact: false }).tap();
  const details = screen.getByRole("complementary", "Run inspector");
  await expect(details).toBeVisible();
  const expectViewKept = await manualRunView(screen, browser);
  await expect.poll(async () => (await openLiveSockets(app)).host).toBe(1);
  await browser.evaluate(setVisibility("hidden"));
  await expect.poll(async () => (await openLiveSockets(app)).host).toBe(0);
  await liveStates(app, "visibility", ["working reported"], "Reviewed the picker in dark mode.");
  await expect(screen.getByText("Reviewed the picker in dark mode.")).toHaveCount(0);

  // Act
  await browser.evaluate(setVisibility("visible"));

  // Assert
  await expect(
    details.getByText("Reviewed the picker in dark mode.", { exact: true }).first(),
  ).toBeVisible();
  await expect(details).toBeVisible();
  await expect.poll(async () => (await openLiveSockets(app)).host).toBe(1);
  await expectViewKept();
  await app.screenshot("live-visible-again");
});

test("opening a Woke Run marks it seen once its live view is current", async ({ app, screen }) => {
  // Arrange
  const title = "Demo · Woke · A question about keyboard shortcuts";
  const woke = await findRun(app.baseUrl, title);
  expect(woke.presentation.woke).toBe(true);

  // Act
  await app.open(`/runs/${woke.id}`);

  // Assert
  await expect(screen.getByRole("heading", title)).toBeVisible();
  await expect.poll(async () => (await findRun(app.baseUrl, title)).presentation.woke).toBe(false);
  await expect(screen.getByText("Could not mark Woke as seen", { exact: false })).toHaveCount(0);
});
