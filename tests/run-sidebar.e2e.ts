import { confirmSettlement } from "./support/run-history.ts";
import { test } from "./support/test.ts";
import assert from "node:assert/strict";
import { expect, type App, type Screen } from "e2e";
import { findArchivedRun, findRun, readHistoryRun } from "./support/run-history.ts";
import { liveRun } from "./support/live.ts";
import { shortcutMod } from "./support/keyboard-shortcuts.ts";
import { prepareScenario } from "./support/scenarios.ts";
import {
  openSidebarAction,
  expectFlatSearch,
  matchingSidebarTitles,
  prepareSidebarPreview,
  badgeRunTitles,
  openDesktopWindow,
  routeWindow,
} from "./support/sidebar.ts";

const snoozedTitle = "Demo · Snoozed · Navigation research";
const workingTitle = "Demo · Working · Improve the project picker";
// Earlier journeys replace the T3 authorization the Demo Runs started under, and Settle refuses
// such a Run, so Settle journeys use the scenario copy started under the current authorization.
const settleTitle = "UI worker · Snoozed · Navigation research";

test("a Waiting Run's sidebar row uses the Waiting activity", async ({ app, screen, browser }) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open("/runs/new");
  const open = screen.getByRole("navigation", "Open Runs");

  // Assert
  await expect(open.getByRole("link", /Demo · Waiting for your review.*Waiting$/)).toBeVisible();
  await app.screenshot("sidebar-activity-glyphs");
});

test("wheeling over the sidebar footer keeps the Run page pinned to the viewport", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 600 });
  const title = "Demo · Parallel review from one prompt";
  const run = await findRun(app.baseUrl, title);
  await app.open(`/runs/${run.id}`);
  await expect(screen.getByRole("heading", title, { exact: true })).toBeVisible();
  const footer = screen.getByRole("navigation", "Sidebar footer");
  await footer.hover();

  // Act
  await browser.mouse.wheel(0, 220);

  // Assert
  expect(
    await browser.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
      return { scrollTop, overflow: scrollHeight - clientHeight };
    }),
  ).toEqual({ scrollTop: 0, overflow: 0 });
  const bounds = await footer.boundingBox();
  expect(bounds!.y + bounds!.height).toBe(600);
});

test("the Run preview opens to the right of its row", async ({ app, screen, browser }) => {
  // Arrange
  const { row, preview } = await prepareSidebarPreview({ app, screen, browser }, workingTitle);

  // Act
  await row.hover();

  // Assert
  await expect(preview).toBeVisible();
  await app.screenshot("sidebar-row-preview");
  await expect(preview).toHaveAttribute("data-side", "right");
  const rowBox = await row.boundingBox();
  const previewBox = await preview.boundingBox();
  expect(previewBox!.x).toBeGreaterThanOrEqual(rowBox!.x + rowBox!.width);
  const viewportHeight = await browser.evaluate("window.innerHeight");
  assert(typeof viewportHeight === "number");
  const expectedTop = Math.max(8, Math.min(rowBox!.y, viewportHeight - previewBox!.height - 8));
  expect(Math.abs(previewBox!.y - expectedTop)).toBeLessThan(10);
  await expect(row).toContainText("feature/project-picker-empty-state-and-keyboard-navigation");
  await expect(row.getByLabel(/pull requests/)).toHaveCount(0);
  await expect(preview).toContainText("Demo · Focused change");
});

test("opening Run actions dismisses the preview and menu hover keeps it closed", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { row, preview } = await prepareSidebarPreview(
    { app, screen, browser },
    workingTitle,
    true,
  );

  // Act
  await row.secondaryTap();
  await screen.getByRole("menuitem", "Rename", { exact: false }).hover();

  // Assert
  await expect(screen.getByRole("menu")).toBeVisible();
  await app.screenshot("sidebar-row-context-menu");
  await expect(preview).toBeHidden();
});

test("Copy in a Run row menu puts the Run ID on the clipboard", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const run = await findRun(app.baseUrl, workingTitle);
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open("/runs/new");
  await screen.getByRole("link").filter({ hasText: workingTitle }).secondaryTap();
  await screen.getByRole("menuitem", "Copy", { exact: true }).hover();

  // Act
  await screen.getByRole("menuitem", "Run ID", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("menu")).toHaveCount(0);
  expect(await browser.evaluate("navigator.clipboard.readText()")).toBe(run.id);
});

test("restoring the last snoozed Run hides its group and focuses the restored row", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { toggle, actions } = await openSidebarAction(
    { app, screen, browser },
    snoozedTitle,
    "snooze",
  );
  await app.screenshot("snoozed-before-restore");

  // Act
  await screen.getByRole("menuitem", "Restore", { exact: true }).tap();

  // Assert
  await expect(toggle).toBeHidden();
  await expect(actions).toBeFocused();
  await expect(
    screen.getByRole("navigation", "Open Runs").getByRole("link", /Demo · Snoozed/),
  ).toBeVisible();
  await app.screenshot("snoozed-empty-hidden");
  expect((await findRun(app.baseUrl, snoozedTitle)).presentation.snoozed).toBe(false);
});

test("snoozing a restored Run restores its group expansion and focuses the toggle", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { toggle, actions } = await openSidebarAction(
    { app, screen, browser },
    snoozedTitle,
    "snooze",
  );
  await screen.getByRole("menuitem", "Restore", { exact: true }).tap();
  await expect(toggle).toBeHidden();
  // The open menu hides background roles before Restore finishes moving and focusing the row.
  await expect(
    screen.getByRole("navigation", "Open Runs").getByRole("link").filter({ hasText: snoozedTitle }),
  ).toBeFocused();
  await actions.secondaryTap();

  // Act
  await screen.getByRole("menuitem", "Snooze", { exact: true }).tap();

  // Assert
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    screen.getByRole("navigation", "Snoozed Runs").getByRole("link", /Demo · Snoozed/),
  ).toBeVisible();
  await app.screenshot("snoozed-returned-expanded");
  expect((await findRun(app.baseUrl, snoozedTitle)).presentation.snoozed).toBe(true);
});

test("title search combines drafts and all Run states in creation order", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open("/runs/new");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("Demo · Sidebar search draft");
  const snoozed = await findRun(app.baseUrl, snoozedTitle);
  await app.open(`/runs/${snoozed.id}`);
  await expect(screen.getByRole("link", /^Demo · Sidebar search draft\s*Draft$/)).toBeVisible();
  await app.open("/runs/new");
  const titles = await matchingSidebarTitles(app.baseUrl, "Demo ·");

  // Act
  await screen.getByRole("textbox", "Search Run titles").fill("Demo ·");

  // Assert
  const open = screen.getByRole("navigation", "Open Runs");
  await expectFlatSearch(screen);
  await expect(open.getByRole("link")).toHaveCount(titles.length + 1);
  await expect(open.getByRole("link")).toContainText(["Demo · Sidebar search draft", ...titles]);
  await expect(open.getByText(`Runs · ${titles.length + 1}`)).toBeVisible();
  await expect(open.getByRole("link", /Demo · Snoozed/)).toBeVisible();
  await expect(open.getByRole("link", /Demo · Settled/)).toBeVisible();
  await app.screenshot("flat-search-muted-states");
});

test("a title search with no match explains that search looks at titles only", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open("/runs/new");
  const query = "No Run is titled this";

  // Act
  await screen.getByRole("textbox", "Search Run titles").fill(query);

  // Assert
  const empty = screen.getByRole("navigation", "Open Runs").getByRole("status");
  await expect(empty).toContainText(`No Run titles match “${query}”`);
  await expect(empty).toContainText(
    "Search looks at titles only. Clear search (Esc) to see all Runs.",
  );
  await app.screenshot("sidebar-search-no-match");
});

test("restore during search keeps focus on the matching row", async ({ app, screen, browser }) => {
  // Arrange
  const { actions } = await openSidebarAction(
    { app, screen, browser },
    snoozedTitle,
    "snooze",
    true,
  );

  // Act
  await screen.getByRole("menuitem", "Restore", { exact: true }).tap();

  // Assert
  await expect(actions).toBeFocused();
  await expectFlatSearch(screen);
  await app.screenshot("search-restore-row-focused");
});

test("snooze during search keeps focus on the matching row", async ({ app, screen, browser }) => {
  // Arrange
  const { actions } = await openSidebarAction(
    { app, screen, browser },
    snoozedTitle,
    "restore",
    true,
  );

  // Act
  await screen.getByRole("menuitem", "Snooze", { exact: true }).tap();

  // Assert
  await expect(actions).toBeFocused();
  await expectFlatSearch(screen);
  await app.screenshot("search-snooze-row-focused");
});

test("settle during search keeps focus on the matching row", async ({ app, screen, browser }) => {
  // Arrange
  await prepareScenario(app, "snoozed");
  const { actions } = await openSidebarAction(
    { app, screen, browser },
    settleTitle,
    "snooze",
    true,
  );

  // Act
  await screen.getByRole("menuitem", "Settle", { exact: true }).tap();
  await expect(
    screen.getByRole("alertdialog").getByRole("button", "Cancel", { exact: true }),
  ).toBeFocused();
  // The modal hides the underlying controls from the accessibility tree.
  await expect(browser.locator(`button[aria-label="Actions for ${settleTitle}"]`)).toBeEnabled();
  await app.screenshot("settle-confirmation-row-actions-released");
  await confirmSettlement(screen);

  // Assert
  await expect(actions).toBeFocused();
  await expectFlatSearch(screen);
  await app.screenshot("search-settle-row-focused");
});

test("Run rows summarize independent branches and count shared PRs once", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1100 });
  const title = "Demo · Parallel review from one prompt";
  const row = screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link")
    .filter({ hasText: title });

  // Act
  await app.open("/runs/new");

  // Assert
  await expect(row).toContainText("2 branches");
  await expect(row.getByLabel("2 pull requests", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", `Actions for ${title}`)).toBeHidden();
});

test("Run repository details retain branch ownership and PR links after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const title = "Demo · Parallel review from one prompt";
  const { row } = await prepareSidebarPreview({ app, screen, browser }, title);
  await row.tap();
  await expect(screen.getByRole("region", "Run repositories")).toBeVisible();

  // Act
  await browser.reload();

  // Assert
  const repositories = screen.getByRole("region", "Run repositories");
  await expect(repositories).toContainText("review/project-picker");
  await expect(repositories).toContainText("Code review");
  await expect(repositories).toContainText("review/keyboard-accessibility");
  await expect(repositories).toContainText("Accessibility review");
  const first = repositories.getByRole("link", "example/atlas #42", { exact: true });
  await expect(first).toHaveAttribute("href", "https://github.com/example/atlas/pull/42");
  await expect(first).toHaveAttribute("target", "_blank");
  const second = repositories.getByRole("link", "example/atlas #43", { exact: true });
  await expect(second).toHaveAttribute("href", "https://github.com/example/atlas/pull/43");
  await expect(second).toHaveAttribute("target", "_blank");
  await expect(repositories.getByRole("link")).toHaveCount(2);
  await app.screenshot("run-branches-and-pull-requests");
});

test("expanding Settled shows muted rows with the Run meta line", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open("/runs/new");
  const row = screen
    .getByRole("navigation", "Settled Runs")
    .getByRole("link", /Demo · Settled · Clearer onboarding copy/);

  // Act
  await screen.getByRole("button", /^Settled \d+$/).tap();

  // Assert
  await expect(row).toBeVisible();
  await expect(row).toContainText("copy/welcome");
  await app.screenshot("sidebar-settled-rows");
});

test("expanded Settled stays pinned below the open Runs instead of scrolling them away", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: a viewport shorter than the seeded open Runs.
  await browser.setViewport({ width: 1440, height: 700 });
  await app.open("/runs/new");
  const firstOpen = screen.getByRole("navigation", "Open Runs").getByRole("link").first();
  const settledRow = screen.getByRole("navigation", "Settled Runs").getByRole("link").first();

  // Act
  await screen.getByRole("button", /^Settled \d+$/).tap();

  // Assert: the open list and the Settled rows are both on screen at once.
  await expect(settledRow).toBeVisible();
  const open = await firstOpen.boundingBox();
  const settled = await settledRow.boundingBox();
  expect(open!.y).toBeGreaterThanOrEqual(0);
  expect(settled!.y + settled!.height).toBeLessThanOrEqual(700);
  await app.screenshot("sidebar-settled-pinned");
});

test("on a short sidebar the pinned groups yield so an open Run stays fully visible", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open("/runs/new");
  await screen.getByRole("button", /^Settled \d+$/).tap();
  const firstOpen = screen.getByRole("navigation", "Open Runs").getByRole("link").first();
  const firstGroup = screen.getByRole("button", /^(Snoozed|Settled) \d+$/).first();

  // Act: shrink the window below the open list plus the expanded groups.
  await browser.setViewport({ width: 1440, height: 220 });

  // Assert: the first open row is whole and above the pinned groups.
  const open = await firstOpen.boundingBox();
  const groups = await firstGroup.boundingBox();
  expect(open!.y).toBeGreaterThanOrEqual(0);
  expect(open!.y + open!.height).toBeLessThanOrEqual(groups!.y);
  await app.screenshot("sidebar-short-pinned-groups");
});

test("the Settled preview exposes the pull request details its row omits", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open("/runs/new");
  await screen.getByRole("button", /^Settled \d+$/).tap();
  const row = screen
    .getByRole("navigation", "Settled Runs")
    .getByRole("link", /Demo · Settled · Clearer onboarding copy/);

  // Act
  await row.hover();

  // Assert
  const preview = browser.locator('[data-slot="tooltip-content"]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("copy/welcome");
  await expect(preview).toContainText("example/atlas #41");
  await app.screenshot("sidebar-settled-preview");
});

test("cancelling Rename returns focus with Run state and attention available without a preview", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { row, preview } = await prepareSidebarPreview(
    { app, screen, browser },
    "Demo · Problem · Search checks failed",
  );
  await row.press("Shift+F10");
  await expect(screen.getByRole("menu")).toBeVisible();
  await screen.getByRole("menuitem", "Rename", { exact: false }).tap();
  await expect(screen.getByRole("dialog", "Rename Run")).toBeVisible();
  await expect(screen.getByRole("textbox", "Run title", { exact: true })).toBeFocused();

  // Act
  await screen.getByRole("button", "Cancel", { exact: true }).tap();

  // Assert
  await expect(row).toBeFocused();
  await expect(row).toHaveAccessibleName(
    /Demo · Problem · Search checks failed.*Problem.*,\s*(Idle|Observation unknown or stale)$/,
  );
  await expect(preview).toBeHidden();
});

/** Opens Run history by link and returns the lifecycle in its meta line. */
async function openRunLifecycle(app: App, screen: Screen, id: string) {
  await app.open(`/runs/${id}`);
  const status = screen.getByLabel("Run lifecycle", { exact: true });
  await expect(status).toHaveCount(1);
  return status;
}

test("an active Run's header states no work state while its row and Blocks show Needs input", async ({
  app,
  screen,
}) => {
  // Arrange
  // Other journeys answer or settle the Human review Run; this native question stays pending.
  const title = "Demo · Woke · A question about keyboard shortcuts";
  const row = screen.getByRole("navigation", "Open Runs").getByRole("link", new RegExp(title));

  // Act
  await app.open(`/runs/${(await findRun(app.baseUrl, title)).id}`);

  // Assert
  await expect(screen.getByRole("heading", title, { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toHaveText(/^Started /);
  await expect(row).toContainText("Needs input");
  await expect(
    screen.getByRole("region", "Execution canvas").getByText("Needs input", { exact: true }),
  ).toBeVisible();
  await app.screenshot("run-header-needs-input");
});

test("a working Run's header shows no Not live while its worker is freshly observed", async ({
  app,
  screen,
}) => {
  // Arrange
  // A restart or T3 outage earlier in the suite correctly leaves seeded Runs stale; this
  // journey's own worker was just observed.
  const id = await liveRun(app, "run-header-working");
  const run = await readHistoryRun(app.baseUrl, id);
  expect(run.blocks.find((block) => block.blockId === "worker")?.freshness).toBe("fresh");

  // Act
  await app.open(`/runs/${id}`);

  // Assert
  await expect(screen.getByRole("region", "Execution canvas")).toBeVisible();
  await expect(screen.getByRole("status", "Observation freshness")).toHaveCount(0);
  await app.screenshot("run-header-working");
});

test("a Settled Run shows its lifecycle time and selects its grouped sidebar row", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  const title = "Demo · Settled · Clearer onboarding copy";
  const canvas = screen.getByRole("region", "Execution canvas");

  // Act
  const status = await openRunLifecycle(app, screen, (await findRun(app.baseUrl, title)).id);

  // Assert
  await expect(status).toHaveText(/^Settled .+\d{2}:\d{2}/);
  await expect(
    screen.getByRole("navigation", "Settled Runs").getByRole("link", new RegExp(title)),
  ).toHaveAttribute("aria-current", "page");
  await expect(canvas.getByText("Finished", { exact: true })).toBeVisible();
  await app.screenshot("run-header-settled");
});

test("an Archived Run opened by link shows its lifecycle time and has no actions", async ({
  app,
  screen,
}) => {
  // Arrange
  const title = "Demo · Archived · Earlier navigation experiment";
  const found = await findArchivedRun(app.baseUrl, title);

  // Act
  const status = await openRunLifecycle(app, screen, found.id);

  // Assert
  await expect(status).toHaveText(/^Archived .+\d{2}:\d{2}/);
  await expect(screen.getByRole("button", "Run actions", { exact: true })).toHaveCount(0);
  await app.screenshot("run-header-archived");
});

// The native question stays pending through the suite (see the Needs input header journey).
const nativeQuestionTitle = "Demo · Woke · A question about keyboard shortcuts";

test("a notification route opens its Run with the Block of its one pending matter selected", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openDesktopWindow({ app, screen, browser });
  const run = await findRun(app.baseUrl, nativeQuestionTitle);
  const [matter] = run.attention.matters;
  assert(matter?.kind === "native-request" && matter.blockName);

  // Act
  await routeWindow(browser, { kind: "run", runId: run.id, blockId: matter.blockId });

  // Assert
  await expect(browser).toHaveURL(`/runs/${run.id}`);
  await expect(
    browser.locator('[aria-label="Execution canvas"] button[aria-pressed="true"]'),
  ).toContainText(matter.blockName);
  await expect(screen.getByRole("link", "Open in T3").nth(0)).toBeVisible();
  await app.screenshot("desktop-route-run-block");
});

test("a notification route to a Run that no longer exists shows it is unavailable", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openDesktopWindow({ app, screen, browser });

  // Act
  await routeWindow(browser, { kind: "run", runId: "run-removed-since", blockId: null });

  // Assert
  await expect(screen.getByText("This Run does not exist.")).toBeVisible();
  await app.screenshot("desktop-route-run-missing");
});

test("Needs you lists exactly the Runs the Dock badge counts and clears a conflicting search", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openDesktopWindow({ app, screen, browser });
  await screen.getByRole("textbox", "Search Run titles").fill("Demo · Settled");
  const titles = await badgeRunTitles(app.baseUrl);
  expect(titles).toContain("Demo · Problem · Search checks failed");
  expect(titles).not.toContain(snoozedTitle);

  // Act
  await routeWindow(browser, { kind: "needs-you" });

  // Assert
  await expect(screen.getByRole("textbox", "Search Run titles")).toHaveValue("");
  await expect(screen.getByRole("button", `Needs you (${titles.length})`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const rows = screen.getByRole("navigation", "Open Runs").getByRole("link");
  await expect(rows).toHaveCount(titles.length);
  await expect(rows).toContainText(titles);
  await expectFlatSearch(screen);
  await app.screenshot("desktop-route-needs-you");
});

test("a route away from the New Run view keeps the draft in the Run list", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openDesktopWindow({ app, screen, browser });
  await screen.getByLabel("Initial prompt", { exact: false }).fill("Demo · Draft kept by a route");
  const run = await findRun(app.baseUrl, nativeQuestionTitle);

  // Act
  await routeWindow(browser, { kind: "run", runId: run.id, blockId: null });

  // Assert
  await expect(browser).toHaveURL(`/runs/${run.id}`);
  await expect(screen.getByRole("link", /^Demo · Draft kept by a route\s*Draft$/)).toBeVisible();
});

test("a route while Studio has unsaved edits asks first, and Keep editing keeps them", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openDesktopWindow({ app, screen, browser });
  await browser.keyboard.press(`${shortcutMod}+Shift+s`);
  await screen.getByRole("link", "Launch ready Flow", { exact: false }).tap();
  await screen.getByLabel("Flow name").fill("Launch ready Flow routed");
  const run = await findRun(app.baseUrl, nativeQuestionTitle);
  await routeWindow(browser, { kind: "run", runId: run.id, blockId: null });
  await expect(screen.getByRole("dialog", "Discard unsaved changes?")).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(
        `getComputedStyle([...document.querySelectorAll('[role="dialog"]')].at(-1)).opacity`,
      ),
    )
    .toBe("1");
  await app.screenshot("desktop-route-studio-guard");

  // Act
  await screen.getByRole("button", "Keep editing", { exact: true }).tap();

  // Assert
  await expect(screen.getByLabel("Flow name")).toHaveValue("Launch ready Flow routed");
});
