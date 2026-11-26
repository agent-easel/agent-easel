import { afterEach, beforeEach, test } from "./support/test.ts";
import { describe, expect, type Screen } from "e2e";
import {
  blockOnModelLessLaterReview,
  fillReadyComposer,
  openReadyComposer,
  startLosingResponse,
} from "./support/composer.ts";
import { removeAgentElsewhere } from "./support/agents.ts";
import { removeFlowElsewhere } from "./support/flows.ts";
import { shortcutMod, startRunHint } from "./support/keyboard-shortcuts.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";

/** Launch states of the New Run composer after ticket #507. Dark, 1440×900. */

// A cancelled animation rejects `finished` with AbortError. A shot still waits for the rest.
const settled =
  "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => null))).then(() => true)";
beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 900 });
});

test("an empty prompt keeps Start disabled, and a ready prompt can start", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/runs/new");
  await expect(screen.getByText(/The first text line becomes the Run title/)).toHaveCount(0);
  await expect(screen.getByText("Enter an initial prompt to start the Run.")).toHaveCount(0);
  await expect(screen.getByRole("button", "Start", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("button", "Start", { exact: true })).not.toContainText(
    startRunHint,
  );
  await screen.getByLabel("Initial prompt", { exact: false }).tap();
  await browser.keyboard.press(`${shortcutMod}+Enter`);
  await expect(screen.getByText("Enter an initial prompt to start the Run.")).toHaveCount(0);
  await app.screenshot("after-empty");

  await fillReadyComposer(screen, "Ship the picker");
  await expect(screen.getByRole("button", "Start", { exact: true })).toBeEnabled();
  await expect(screen.getByRole("button", "Start", { exact: true })).toContainText(startRunHint);
  await app.screenshot("after-ready");
});

test("a lost T3 Code connection keeps the draft in one card and reconnects without it", async ({
  fixture,
  app,
  screen,
}) => {
  await openReadyComposer(app, screen, "Ship the picker");

  await fixture.remoteAccess.t3Unavailable();
  await expect(screen.getByText("T3 Code is disconnected", { exact: true })).toBeVisible();
  await expect(
    screen.getByText(
      "Your draft is kept and Project and Flow show their last known values. Start is available again as soon as AgentEasel reconnects to T3 Code.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Start", { exact: true })).toBeDisabled();
  await app.screenshot("after-disconnected");

  await fixture.remoteAccess.t3Available();
  await expect(screen.getByText("T3 Code is disconnected", { exact: true })).toHaveCount(0);
  await expect(
    screen.getByRole("link", /^Settings, (Connected|Agent reporting needs attention)$/),
  ).toBeVisible();
  await app.screenshot("after-reconnected");
});

// The focused element's outline, drawn from `--ring` in each appearance.
const focusOutline = `(() => { const style = getComputedStyle(document.activeElement); return [style.outlineStyle, style.outlineWidth, style.outlineColor].join(" "); })()`;
const focusRings = [
  { mode: "Dark", ring: "solid 2px rgb(129, 140, 248)" },
  { mode: "Light", ring: "solid 2px rgb(99, 102, 241)" },
] as const;

for (const { mode, ring } of focusRings)
  test(`a keyboard-focused card link shows the focus ring in ${mode}`, async ({
    fixture,
    app,
    screen,
    browser,
  }) => {
    // Arrange
    await app.open("/settings/appearance");
    await screen.getByRole("radio", mode, { exact: true }).tap();
    await app.open("/runs/new");
    await fixture.remoteAccess.t3Unavailable();
    const link = screen.getByRole("link", "Open T3 Code connection settings", { exact: true });
    await link.focus();
    await browser.keyboard.press("Shift+Tab");

    // Act
    await browser.keyboard.press("Tab");

    // Assert
    await expect(link).toBeFocused();
    expect(await browser.evaluate(focusOutline)).toBe(ring);
    await app.screenshot(`text-link-focus-${mode.toLowerCase()}`);
  });

test("an unconfirmed Start keeps an Idle row and does not call the outcome Unknown", async ({
  app,
  screen,
  browser,
}) => {
  await openReadyComposer(app, screen, "Confirm this Start later");
  await startLosingResponse(screen, browser);
  await expect(screen.getByText(/Start outcome unknown/)).toBeVisible();
  await expect(screen.getByText(/The row shows Unknown until T3 Code confirms/)).toHaveCount(0);
  await expect(screen.getByRole("link", "Confirm this Start later", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("link", "Confirm this Start later Idle", { exact: true }),
  ).toHaveCount(0);
  await expect(screen.getByRole("link", /^Confirm this Start later\s*Draft$/)).toHaveCount(0);
  await app.screenshot("after-outcome-unknown");
});

const startButton = (screen: Screen) => screen.getByRole("button", "Start", { exact: true });
const recordDiagnostics = (screen: Screen) =>
  screen.getByRole("button", "Record diagnostic log", { exact: true });

async function expectReportingRejection(screen: Screen) {
  await expect(screen.getByRole("alert")).toContainText("No Run was created.");
  await expect(
    screen.getByRole("link", "Open Settings → Agent reporting", { exact: true }).first(),
  ).toBeVisible();
}

test("a rejected Start shows one row per cause and only says that no Run was created", async ({
  fixture,
  app,
  screen,
}) => {
  await openReadyComposer(app, screen, "Reject this Start");
  await fixture.reporting.breakRequiredSkill();
  await startButton(screen).tap();
  await expectReportingRejection(screen);
  await expect(screen.getByText(/Your draft is kept. Fix every listed blocker/)).toHaveCount(0);
  await expect(screen.getByRole("list", "Start blockers")).toBeVisible();
  await app.screenshot("after-start-rejected");
});

test("recording from the rejected Start card leaves the next Start to the user", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  let starts = 0;
  await browser.route("**/api/runs", (route) => {
    starts += Number(route.request.method === "POST");
    return route.continue();
  });
  await openReadyComposer(app, screen, "Capture the reporting blocker");
  await fixture.reporting.breakRequiredSkill();
  const start = startButton(screen);
  await start.tap();
  const record = recordDiagnostics(screen);
  await expect(record).toBeVisible();

  // Act
  await record.tap();

  // Assert
  await expect(record).toHaveCount(0);
  await expect(start).toBeEnabled();
  await expectReportingRejection(screen);
  const status = await fetch(new URL("/api/settings/diagnostics", app.baseUrl));
  expect(await status.json()).toMatchObject({ ok: true, value: { enabled: true } });
  const exported = await fetch(new URL("/api/settings/diagnostics/export", app.baseUrl));
  expect(await exported.text()).not.toContain("### Start ·");
  expect(starts).toBe(1);
  await app.screenshot("start-rejected-recording-enabled");
});

test("a rejected Start while recording exports the reporting blocker and omits the recording action", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.diagnostics.hostRecords();
  await openReadyComposer(app, screen, "Capture the next Start");
  await fixture.reporting.breakRequiredSkill();

  // Act
  await startButton(screen).tap();

  // Assert
  await expectReportingRejection(screen);
  await expect(recordDiagnostics(screen)).toHaveCount(0);
  const exported = await fetch(new URL("/api/settings/diagnostics/export", app.baseUrl));
  expect(await exported.text()).toMatch(/### Start · .* UTC · failed[\s\S]*reporting_installation/);
});

test("an approved device can see a rejected Start's next step while recording is off", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");
  await fillReadyComposer(screen, "Diagnose a remote Start rejection");
  await fixture.reporting.breakRequiredSkill();

  // Act
  await startButton(screen).tap();

  // Assert
  await expectReportingRejection(screen);
  await expect(recordDiagnostics(screen)).toHaveCount(0);
});

describe("AgentEasel becomes unavailable", () => {
  afterEach(async ({ fixture, browser }) => {
    await fixture.remoteAccess.online();
    await browser.clearCookies({ name: "fixture_remote" });
  });

  test("losing AgentEasel shows AgentEasel offline and does not send the owner to T3 Code settings", async ({
    fixture,
    app,
    screen,
  }) => {
    // Arrange
    // The host browser talks to the fixture directly. Offline drops only a remote browser's sockets.
    await openRemoteBrowser(app);
    await openApproved(app, "/runs/new");
    await expect(screen.getByRole("button", "New Run (+)")).toBeEnabled();
    await screen
      .getByLabel("Initial prompt", { exact: false })
      .fill("Stay while AgentEasel is offline");

    // Act
    await fixture.remoteAccess.offline();

    // Assert
    await expect(screen.getByText("AgentEasel offline", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(screen.getByText("Your draft is kept.", { exact: true })).toBeVisible();
    await expect(
      screen.getByRole("link", "Open T3 Code connection settings", { exact: true }),
    ).toHaveCount(0);
    await app.screenshot("after-factory-offline");
  });
});

test("a chosen Flow that is not ready carries its reason on the one error card", async ({
  app,
  screen,
  browser,
}) => {
  const { agent, flow } = await blockOnModelLessLaterReview(app, screen);
  await expect(screen.getByText("Not ready", { exact: true })).toBeVisible();
  // The field's error border fades in; capture it once the transition ends.
  await browser.evaluate(settled);
  await app.screenshot("after-flow-not-ready");
  await removeFlowElsewhere(app.baseUrl, flow);
  await removeAgentElsewhere(app.baseUrl, agent.id);
});
