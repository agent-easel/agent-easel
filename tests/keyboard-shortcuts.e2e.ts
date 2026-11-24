import { fillReadyComposer } from "./support/composer.ts";
import { confirmSettlement } from "./support/run-history.ts";
import type { Browser } from "@e2e-dev/web";
import { test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import { findArchivedRun, findRun, readHistoryRun } from "./support/run-history.ts";
import { matchingSidebarTitles } from "./support/sidebar.ts";
import { elapse, openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import { browserRequests, liveRun, resetBrowserRequests } from "./support/live.ts";
import {
  desktopNewRunHint,
  expectFactoryConnected,
  fillHumanReviewChanges,
  installDesktopBridge,
  openDesktopComposer,
  openKeyboardSettings,
  recordDesktopNewRunCandidate,
  shortcutMod,
} from "./support/keyboard-shortcuts.ts";

const modShiftE = `${shortcutMod}+Shift+E`;
const modSlash = `${shortcutMod}+/`;
const inspectorHint = process.platform === "darwin" ? "⌘." : "Ctrl+.";

const customDesktopNewRunHint = process.platform === "darwin" ? "⇧⌘N" : "Ctrl+Shift+N";

test("palette Enter opens the selected Flow", async ({ app, screen, browser }) => {
  // Arrange
  await app.open("/runs/new");
  await expect(screen.getByRole("heading", /What should we work on/)).toBeVisible();
  await browser.keyboard.press(`${shortcutMod}+k`);
  await screen.getByLabel("Search commands and items").fill("Launch ready Flow");
  await expect(screen.getByRole("option", /Launch ready Flow/)).toBeVisible();

  // Act
  await browser.keyboard.press("Enter");

  // Assert
  await expect(screen.getByRole("dialog", "Command palette")).toBeHidden();
  await expect(screen.getByLabel("Flow name")).toHaveValue("Launch ready Flow");
});

test("a Run created while the palette is open appears in it without a list request", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/runs/new");
  await expect(screen.getByRole("heading", /What should we work on/)).toBeVisible();
  await resetBrowserRequests(app);
  await browser.keyboard.press(`${shortcutMod}+k`);
  await screen.getByLabel("Search commands and items").fill("Live palette");
  await expect(screen.getByText(/^Loading Runs/)).toBeHidden();
  await expect(screen.getByRole("option", /Live palette/)).toHaveCount(0);

  // Act
  await liveRun(app, "palette");

  // Assert
  await expect(
    screen.getByRole("option", /Demo · Live palette · Tidy the project picker/),
  ).toBeVisible();
  const listRequests = (await browserRequests(app)).filter((request) =>
    /^GET \/api\/(run-navigation|flows|agents)$/.test(request),
  );
  expect(listRequests).toEqual([]);
});

test("explicit palette search opens archived history without listing it in suggestions", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const title = "Demo · Archived · Earlier navigation experiment";
  const run = await findArchivedRun(app.baseUrl, title);
  await app.open("/runs/new");
  await expectFactoryConnected(screen);
  await browser.keyboard.press(`${shortcutMod}+k`);
  const palette = screen.getByRole("dialog", "Command palette");
  const search = palette.getByRole("combobox");
  await expect(palette.getByRole("group", "Runs")).toBeVisible();
  await expect(palette.getByRole("option", new RegExp(title))).toHaveCount(0);

  // Act
  await search.fill(`#${run.number}`);
  const match = palette.getByRole("option", /Earlier navigation experiment/);
  await expect(match).toContainText("Archived");
  await browser.keyboard.press("Enter");

  // Assert
  await expect(screen.getByRole("heading", title, { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toContainText("Archived");
  await expect(screen.getByRole("button", "Run actions", { exact: true })).toHaveCount(0);
});

test("offline New Run stays disabled and palette navigation skips it", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");
  await expectFactoryConnected(screen);
  await fixture.remoteAccess.offline();
  await expect(screen.getByRole("status", "Offline")).toBeVisible();
  await browser.keyboard.press(`${shortcutMod}+k`);
  const palette = screen.getByRole("dialog", "Command palette");
  const newRun = palette.getByRole("option", /New Run/);
  const flows = palette.getByRole("option", /Studio · Flows/);
  await expect(newRun).toBeDisabled();
  await expect(newRun).toHaveText("New Run Offline");
  await expect(flows).toHaveAttribute("aria-selected", "true");
  await app.screenshot("R10h-palette-offline");

  // Act
  await browser.keyboard.press("ArrowUp");
  await browser.keyboard.press("ArrowDown");

  // Assert
  await expect(flows).toHaveAttribute("aria-selected", "true");
  await expect(newRun).toHaveAttribute("aria-selected", "false");
});

test("Mod+, from dirty Studio opens Settings over it and Esc returns with the draft kept", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/runs/new");
  await expectFactoryConnected(screen);
  await browser.keyboard.press(`${shortcutMod}+Shift+s`);
  await screen.getByRole("link", "Launch ready Flow", { exact: false }).tap();
  await screen.getByLabel("Flow name").fill("Launch ready Flow dirty");

  // Act
  await browser.keyboard.press(`${shortcutMod}+,`);

  // Assert
  await expect(screen.getByRole("heading", "T3 Code connection", { exact: true })).toBeVisible();
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("heading", "T3 Code connection", { exact: true })).toHaveCount(0);
  await expect(screen.getByLabel("Flow name")).toHaveValue("Launch ready Flow dirty");
});

test("Mod+, opens connection Settings without losing the composer draft", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/runs/new");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("Keyboard settings draft");
  await expect(screen.getByRole("link", "Settings, Connected", { exact: true })).toBeVisible();

  // Act
  await browser.keyboard.press(`${shortcutMod}+,`);

  // Assert
  await expect(screen.getByRole("heading", "T3 Code connection", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Initial prompt", { exact: false })).toHaveText(
    "Keyboard settings draft",
  );
});

test("Tab moves from the composer prompt through Project, Flow and image attachment to Start", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/runs/new");
  await expect(screen.getByRole("button", "New Run (+)", { exact: true })).toBeEnabled();
  await fillReadyComposer(screen, "Ship the picker");
  const start = screen.getByRole("button", "Start", { exact: true });
  await expect(start).toBeEnabled();
  await screen.getByLabel("Initial prompt", { exact: false }).tap();
  // Each control that receives focus from here on is numbered in the order it was reached.
  await browser.evaluate(`(() => {
    let reached = 0;
    document.addEventListener("focusin", (event) => {
      event.target.setAttribute("data-focus-order", String(++reached));
    });
  })()`);

  // Act
  await browser.keyboard.press("Tab");
  await browser.keyboard.press("Tab");
  await browser.keyboard.press("Tab");
  await browser.keyboard.press("Tab");

  // Assert
  await expect(start).toBeFocused();
  await expect(screen.getByRole("button", /^Select project: /)).toHaveAttribute(
    "data-focus-order",
    "1",
  );
  await expect(screen.getByRole("combobox", /^Select Flow: /)).toHaveAttribute(
    "data-focus-order",
    "2",
  );
  await expect(screen.getByRole("button", "Attach images", { exact: true })).toHaveAttribute(
    "data-focus-order",
    "3",
  );
  await expect(start).toHaveAttribute("data-focus-order", "4");
});

test("the fake desktop bridge enables Mod+N for New Run", async ({ app, screen, browser }) => {
  // Arrange
  await installDesktopBridge(browser);
  const openRun = await findRun(app.baseUrl, "Demo · Working · Improve the project picker");
  await app.open(`/runs/${openRun.id}`);
  await expectFactoryConnected(screen);

  // Act
  await browser.keyboard.press(`${shortcutMod}+n`);

  // Assert
  await expect(screen.getByRole("heading", /What should we work on/)).toBeVisible();
});

test("Settings Reset restores the desktop default for New Run", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const newRunGroup = await recordDesktopNewRunCandidate(app, screen, browser);
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expect(newRunGroup).toContainText(customDesktopNewRunHint);

  // Act
  await newRunGroup.getByRole("button", "Reset New Run").tap();

  // Assert
  await expect(newRunGroup).toContainText(desktopNewRunHint);
  await app.screenshot("keyboard-settings-desktop-defaults");
});

test("desktop Mod+1 opens the first search-filtered visible sidebar row", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await installDesktopBridge(browser);
  await browser.setViewport({ width: 1440, height: 1100 });
  const target = await findRun(app.baseUrl, "Demo · Parallel review from one prompt");
  const query = target.title;
  const matches = await matchingSidebarTitles(app.baseUrl, query);
  expect(matches[0]).toBe(target.title);
  await app.open("/runs/new");
  await expectFactoryConnected(screen);
  await screen.getByRole("textbox", "Search Runs").fill(query);

  // Act
  await browser.keyboard.press(`${shortcutMod}+1`);

  // Assert
  await expect(browser).toHaveURL(`/runs/${target.id}`);
});

test("Settle from an editable field on open Run detail while Mod+ shortcuts stay active", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  // Spec #77 names the Run composer; open Run detail has no composer, so focus stays in the Human answer field.
  await installDesktopBridge(browser);
  const found = await findRun(app.baseUrl, "Demo · Waiting for your review");
  await app.open(`/runs/${found.id}`);
  await expectFactoryConnected(screen);
  await fillHumanReviewChanges(screen, "Keyboard shortcut settle probe");

  // Act
  await browser.keyboard.press(modShiftE);

  // Assert
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).lifecycle)
    .toBe("settled");
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toContainText("Settled");
});

test("Settle is ignored while Settings is open", async ({ app, screen, browser }) => {
  // Arrange
  await installDesktopBridge(browser);
  const title = "Demo · Two reviewers working in parallel";
  const active = await findRun(app.baseUrl, title);
  await app.open(`/runs/${active.id}`);
  await expectFactoryConnected(screen);
  await openKeyboardSettings(screen, browser);

  // Act
  await browser.keyboard.press(modShiftE);

  // Assert
  await expect(screen.getByRole("heading", { name: "Keyboard shortcuts", level: 2 })).toBeVisible();
  // Observe beyond the key event so an accidental asynchronous Settle cannot pass on the initial state.
  await elapse(1_000);
  expect((await readHistoryRun(app.baseUrl, active.id)).lifecycle).toBe("active");
});

test("Mod+Backspace opens the existing Archive confirmation for the open Run", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await installDesktopBridge(browser);
  const title = "Demo · Parallel review from one prompt";
  const found = await findRun(app.baseUrl, title);
  await app.open(`/runs/${found.id}`);
  await expectFactoryConnected(screen);

  // Act
  await browser.keyboard.press(`${shortcutMod}+Backspace`);

  // Assert
  const confirmation = screen.getByRole("dialog", `Archive “${title}”?`);
  await expect(confirmation).toContainText("command palette");
  await confirmation.getByRole("button", "Cancel", { exact: true }).tap();
  await expect(confirmation).toBeHidden();
  expect((await readHistoryRun(app.baseUrl, found.id)).lifecycle).toBe("active");
});

test("Mod+Backspace in Studio over an open Run keeps the selected Flow wire", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await findRun(app.baseUrl, "Demo · Parallel review from one prompt");
  await app.open(`/runs/${found.id}`);
  await expectFactoryConnected(screen);
  await browser.keyboard.press(`${shortcutMod}+Shift+s`);
  await screen.getByRole("link", "Launch ready Flow", { exact: false }).tap();
  const wires = screen.getByRole("group", "Directed connections");
  await expect(wires).toHaveAttribute("data-flow-input-count", "1");
  await wires.getByRole("button", "Connection from Flow input to Entry worker").press("Enter");
  await expect(screen.getByRole("button", "Delete connection")).toBeVisible();

  // Act
  await browser.keyboard.press(`${shortcutMod}+Backspace`);

  // Assert
  // Observe beyond the key event so an asynchronous deletion cannot pass on the initial state.
  await elapse(500);
  await expect(wires).toHaveAttribute("data-flow-input-count", "1");
  await expect(screen.getByRole("button", "Delete connection")).toBeVisible();
});

async function openParallelReviewRun(app: App, screen: Screen, browser: Browser) {
  await browser.setViewport({ width: 1440, height: 1100 });
  const found = await findRun(app.baseUrl, "Demo · Parallel review from one prompt");
  await app.open(`/runs/${found.id}`);
  await expectFactoryConnected(screen);
}

test("Mod+. hides the docked inspector of the open Run", async ({ app, screen, browser }) => {
  // Arrange
  await openParallelReviewRun(app, screen, browser);
  const toggle = screen.getByRole("button", "Toggle inspector", { exact: true });
  await expect(screen.getByRole("complementary", "Run inspector")).toBeVisible();
  await toggle.hover();
  await expect(browser.locator('[data-slot="tooltip-content"]')).toContainText(
    `Hide inspector · ${inspectorHint}`,
  );

  // Act
  await browser.keyboard.press(`${shortcutMod}+.`);

  // Assert
  await expect(screen.getByRole("complementary", "Run inspector")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("a hidden inspector stays hidden through block selection, another Run and reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openParallelReviewRun(app, screen, browser);
  await screen.getByRole("button", "Toggle inspector", { exact: true }).tap();
  await screen.getByRole("button", "Agent ", { exact: false }).first().tap();
  await expect(screen.getByRole("complementary", "Run inspector")).toHaveCount(0);
  await screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link", /Demo · Two reviewers working in parallel/)
    .tap();
  await expect(
    screen.getByRole("heading", "Demo · Two reviewers working in parallel", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("complementary", "Run inspector")).toHaveCount(0);

  // Act
  await browser.reload();

  // Assert
  await expect(
    screen.getByRole("heading", "Demo · Two reviewers working in parallel", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Toggle inspector", { exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(screen.getByRole("complementary", "Run inspector")).toHaveCount(0);
});

test("Mod+/ opens the shortcuts cheat sheet at the wide dialog size with current hints and a Settings link", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openDesktopComposer(app, screen, browser);

  // Act
  await browser.keyboard.press(modSlash);

  // Assert
  const sheet = screen.getByRole("dialog", "Keyboard shortcuts");
  await expect(sheet).toBeVisible();
  // The shared wide size, clamp(560px, 60vw, 960px), at the 1440 px desktop viewport.
  await expect.poll(async () => (await sheet.boundingBox())?.width).toBe(864);
  await expect(sheet.getByText("New Run")).toBeVisible();
  await expect(sheet.getByText(desktopNewRunHint)).toBeVisible();
  await expect(sheet.getByText("Follow active", { exact: true })).toBeVisible();
  await expect(sheet).toContainText("Follow active .");
  await expect(sheet.getByText("Toggle inspector", { exact: true })).toBeVisible();
  await expect(sheet.getByText(inspectorHint, { exact: true })).toBeVisible();
  await expect(sheet.getByText("Open row 1–9", { exact: true })).toBeVisible();
  await expect(sheet.getByText("Open row 1", { exact: true })).toHaveCount(0);
  await expect(sheet.getByText("Unbound", { exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("link", "Edit in Settings")).toBeVisible();
  await app.screenshot("shortcuts-cheat-sheet-desktop");
});

test("the shortcuts cheat sheet does not open over the command palette", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await installDesktopBridge(browser);
  await app.open("/runs/new");
  await expectFactoryConnected(screen);
  await browser.keyboard.press(`${shortcutMod}+k`);
  await expect(screen.getByRole("dialog", "Command palette")).toBeVisible();

  // Act
  await browser.keyboard.press(modSlash);

  // Assert
  await expect(screen.getByRole("dialog", "Command palette")).toBeVisible();
  await expect(screen.getByRole("dialog", "Keyboard shortcuts")).toBeHidden();
});

test("a customized binding reaches the desktop menu", async ({ app, screen, browser }) => {
  // Arrange
  await recordDesktopNewRunCandidate(app, screen, browser);

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect
    .poll(() => browser.evaluate("window.__desktopMenu.newRun.binding"))
    .toEqual({ key: "n", mod: true, alt: false, shift: true });
});

test("the desktop menu enables Run actions once an active Run is open", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openDesktopComposer(app, screen, browser);
  const active = await findRun(app.baseUrl, "Demo · Two reviewers working in parallel");
  await expect.poll(() => browser.evaluate("window.__desktopMenu.settle.enabled")).toBe(false);

  // Act
  await app.open(`/runs/${active.id}`);

  // Assert
  await expect.poll(() => browser.evaluate("window.__desktopMenu.settle.enabled")).toBe(true);
});

test("choosing Settle in the desktop menu settles the open Run", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await installDesktopBridge(browser);
  const found = await findRun(app.baseUrl, "Demo · Corrections back in review");
  await app.open(`/runs/${found.id}`);
  await expectFactoryConnected(screen);
  await expect.poll(() => browser.evaluate("window.__desktopMenu.settle.enabled")).toBe(true);

  // Act
  await browser.evaluate(`window.__chooseMenuItem("settle")`);
  await confirmSettlement(screen);

  // Assert
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).lifecycle)
    .toBe("settled");
});

test("the canvas shortcuts popover lists a customized binding and opens the cheat sheet", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1000 });
  const openRun = await findRun(app.baseUrl, "Demo · Working · Improve the project picker");
  await app.open(`/runs/${openRun.id}`);
  await expectFactoryConnected(screen);
  await openKeyboardSettings(screen, browser);
  await screen.getByRole("group", "Zoom in").getByRole("button", "Change Zoom in").tap();
  await browser.keyboard.press("i");
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("heading", { name: "Keyboard shortcuts", level: 2 })).toBeHidden();
  await screen.getByRole("button", "Canvas shortcuts", { exact: true }).tap();
  const popover = screen.getByRole("dialog", "Canvas shortcuts");
  await expect(popover).toContainText("Zoom in I");
  await expect(popover).toContainText("Follow active .");
  await expect(popover).toContainText("Pan ← ↑ → ↓");
  await app.screenshot("canvas-shortcuts-popover-customized");

  // Act
  await popover.getByRole("button", "All keyboard shortcuts", { exact: true }).tap();

  // Assert
  const sheet = screen.getByRole("dialog", "Keyboard shortcuts");
  await expect(sheet).toBeVisible();
  await expect(popover).toBeHidden();
  await expect(sheet).toContainText("Zoom in I");
  await expect(sheet).toContainText("Pan ← ↑ → ↓");
});
