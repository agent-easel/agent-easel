import { beforeEach, test } from "./support/test.ts";
import { expect } from "e2e";
import {
  blockOnModelLessLaterReview,
  fillReadyComposer,
  openReadyComposer,
  startLosingResponse,
} from "./support/composer.ts";
import { removeAgentElsewhere } from "./support/agents.ts";
import { removeFlowElsewhere } from "./support/flows.ts";
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
  await expect(screen.getByRole("button", "Start", { exact: true })).not.toContainText("⌘↵");
  await screen.getByLabel("Initial prompt", { exact: false }).tap();
  await browser.keyboard.press("Meta+Enter");
  await expect(screen.getByText("Enter an initial prompt to start the Run.")).toHaveCount(0);
  await app.screenshot("after-empty");

  await fillReadyComposer(screen, "Ship the picker");
  await expect(screen.getByRole("button", "Start", { exact: true })).toBeEnabled();
  await expect(screen.getByRole("button", "Start", { exact: true })).toContainText("⌘↵");
  await app.screenshot("after-ready");
});

test("a lost T3 connection keeps the draft in one card and reconnects without it", async ({
  fixture,
  app,
  screen,
}) => {
  await openReadyComposer(app, screen, "Ship the picker");

  await fixture.remoteAccess.t3Unavailable();
  await expect(screen.getByText("T3 is disconnected", { exact: true })).toBeVisible();
  await expect(
    screen.getByText(
      "Your draft is kept and Project and Flow show their last known values. Start is available again as soon as Factory reconnects to T3.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Start", { exact: true })).toBeDisabled();
  await app.screenshot("after-disconnected");

  await fixture.remoteAccess.t3Available();
  await expect(screen.getByText("T3 is disconnected", { exact: true })).toHaveCount(0);
  await expect(
    screen.getByRole("link", /^Settings, (Connected|Agent reporting needs attention)$/),
  ).toBeVisible();
  await app.screenshot("after-reconnected");
});

test("an unconfirmed Start keeps an Idle row and does not call the outcome Unknown", async ({
  app,
  screen,
  browser,
}) => {
  await openReadyComposer(app, screen, "Confirm this Start later");
  await startLosingResponse(screen, browser);
  await expect(screen.getByText(/Start outcome unknown/)).toBeVisible();
  await expect(screen.getByText(/The row shows Unknown until T3 confirms/)).toHaveCount(0);
  await expect(
    screen.getByRole("link", "Confirm this Start later Idle", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("link", /^Confirm this Start later\s*Draft$/)).toHaveCount(0);
  await app.screenshot("after-outcome-unknown");
});

test("a rejected Start shows one row per cause and only says that no Run was created", async ({
  fixture,
  app,
  screen,
}) => {
  await openReadyComposer(app, screen, "Reject this Start");
  await fixture.reporting.breakRequiredSkill();
  await screen.getByRole("button", "Start", { exact: true }).tap();
  await expect(screen.getByRole("alert")).toContainText("No Run was created.");
  await expect(screen.getByText(/Your draft is kept. Fix every listed blocker/)).toHaveCount(0);
  await expect(screen.getByRole("list", "Start blockers")).toBeVisible();
  await expect(
    screen.getByRole("link", "Open Settings → Agent reporting", { exact: true }).first(),
  ).toBeVisible();
  await app.screenshot("after-start-rejected");
});

test("losing Factory shows Factory offline and does not send the owner to T3 settings", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // The host browser talks to the fixture directly. Offline drops only a remote browser's sockets.
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");
  await expect(screen.getByRole("button", "New Run (+)")).toBeEnabled();
  await screen.getByLabel("Initial prompt", { exact: false }).fill("Stay while Factory is offline");
  await fixture.remoteAccess.offline();
  try {
    await expect(screen.getByText("Factory offline", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(screen.getByText("Your draft is kept.", { exact: true })).toBeVisible();
    await expect(
      screen.getByRole("link", "Open T3 connection settings", { exact: true }),
    ).toHaveCount(0);
    await app.screenshot("after-factory-offline");
  } finally {
    await fixture.remoteAccess.online();
    await browser.clearCookies({ name: "fixture_remote" });
  }
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
