import assert from "node:assert/strict";
import type { FlowDraft, Result } from "../packages/contracts/src/index.ts";
import { test } from "./support/test.ts";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import { saveSingleAgentFlow } from "./support/flows.ts";
import { expectFlowSaved, readinessSummary, saveFlowWithReadiness } from "./support/studio.ts";
import type { StudioFixtures } from "./support/studio.ts";
import { readHistoryRun } from "./support/run-history.ts";
import { applyRunState, prepareScenario } from "./support/scenarios.ts";
import { liveRun } from "./support/live.ts";
import {
  approveFirstReviewAtLength,
  expectWrittenByFirstReview,
  finalSignoff,
  readerScreenshot,
} from "./support/human-answers.ts";

/** A saved Flow whose Coder hands over to a Wait named Cool down added from the library, unsaved. */
async function unsavedWait({ app, screen, browser }: StudioFixtures) {
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(app.baseUrl, "Wait before review", "Sample worker", {
    id: "coder",
    name: "Coder",
    x: 320,
    y: 60,
  });
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Add Wait").tap();
  await screen.getByLabel("Name", { exact: true }).fill("Cool down");
  const wait = screen.getByRole("article", "Block Cool down");
  await screen.getByRole("button", "Close block settings").tap();
  await screen.getByRole("button", "Fit Flow").tap();
  await screen.getByRole("button", "Connect exit finish of Coder").dragTo(wait);
  return { flowId, wait };
}

/** The Cool down Wait saved without a duration, its settings open. */
async function waitSettingsWithoutDuration(fixtures: StudioFixtures) {
  const saved = await unsavedWait(fixtures);
  await saveFlowWithReadiness(fixtures.screen, /^Not ready\s*1 issue$/);
  await fixtures.screen.getByRole("button", "Wait Cool down").tap();
  return saved;
}

/** Cool down set to wait 90 hours in its settings, unsaved; hours chosen by pointer. */
async function waitFor90Hours(fixtures: StudioFixtures) {
  const { screen } = fixtures;
  const saved = await waitSettingsWithoutDuration(fixtures);
  await screen.getByLabel("Wait for").fill("90");
  await screen.getByRole("combobox", "Unit: minutes", { exact: true }).tap();
  await screen.getByRole("option", "hours", { exact: true }).tap();
  await expect(screen.getByRole("combobox", "Unit: hours", { exact: true })).toBeVisible();
  return saved;
}

/** That 90-hour Wait saved. */
async function savedWaitFor90Hours(fixtures: StudioFixtures) {
  await waitFor90Hours(fixtures);
  await saveFlowWithReadiness(fixtures.screen, "Ready");
}

/** That saved Wait after a reload. */
async function reloadedWait(fixtures: StudioFixtures) {
  await savedWaitFor90Hours(fixtures);
  await fixtures.browser.reload();
  await expect(fixtures.screen.getByRole("article", "Block Cool down")).toContainText("90 hours");
}

test("a Wait added from the library and saved without a duration is a readiness gap", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { wait } = await unsavedWait({ app, screen, browser });

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectFlowSaved(screen);
  await expect(readinessSummary(screen, /^Not ready\s*1 issue$/)).toBeVisible();
  await expect(wait).toContainText("No duration");
});

test("the readiness issues name a Wait's missing duration", async ({ app, screen, browser }) => {
  // Arrange
  await unsavedWait({ app, screen, browser });
  await saveFlowWithReadiness(screen, /^Not ready\s*1 issue$/);

  // Act
  await screen.getByRole("button", /^Not ready/).tap();

  // Assert
  await expect(screen.getByRole("list", "Readiness issues")).toContainText(
    "Enter how long Cool down waits.",
  );
  await app.screenshot("wait-readiness-missing-duration");
});

test("a Wait's unit is chosen from the keyboard", async ({ app, screen, browser }) => {
  // Arrange
  await waitSettingsWithoutDuration({ app, screen, browser });
  await screen.getByLabel("Wait for").fill("90");
  await screen.getByRole("combobox", "Unit: minutes", { exact: true }).press("Enter");
  const units = screen.getByRole("listbox", "Unit", { exact: true });
  const minutes = units.getByRole("option", "minutes", { exact: true });
  await expect(minutes).toBeFocused();
  await minutes.press("ArrowDown");
  const hours = units.getByRole("option", "hours", { exact: true });
  await expect(hours).toBeFocused();

  // Act
  await hours.press("Enter");

  // Assert
  await expect(screen.getByRole("combobox", "Unit: hours", { exact: true })).toBeFocused();
});

test("a Wait given a duration saves ready with it", async ({ app, screen, browser }) => {
  // Arrange
  const { flowId } = await waitFor90Hours({ app, screen, browser });

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectFlowSaved(screen);
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  const saved = (await (
    await fetch(new URL(`/api/flows/${flowId}`, app.baseUrl))
  ).json()) as Result<FlowDraft>;
  assert(saved.ok);
  expect(saved.value.graph.blocks[1]).toMatchObject({
    kind: "wait",
    name: "Cool down",
    duration: { amount: 90, unit: "hours" },
  });
});

test("a reloaded Wait's settings show its duration, unit and output", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await reloadedWait({ app, screen, browser });

  // Act
  await screen.getByRole("button", "Wait Cool down").tap();

  // Assert
  await expect(screen.getByLabel("Wait for")).toHaveValue("90");
  await expect(screen.getByRole("combobox", "Unit: hours", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("region", "Output").getByRole("button", "Targets of output: none"),
  ).toBeVisible();
  await app.screenshot("wait-configured-after-reload");
});

/** The one-minute Wait's journey Run `key` holding `message` as its first arrival, Wait selected. */
async function openHeldPause(
  { app, screen, browser }: { app: App; screen: Screen; browser: Browser },
  key: string,
  message: string,
) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const runId = await liveRun(app, key, "pause");
  await applyRunState(app, runId, "result reported", message);
  await applyRunState(app, runId, "result released to a Wait");
  await app.open(`/runs/${runId}`);
  await screen.getByRole("button", /^Wait Pause a minute, Waiting/).tap();
  return runId;
}

test("a waiting arrival is held with its message and forwarded by the backend once its minute elapses", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  const runId = await openHeldPause(
    { app, screen, browser },
    "wait",
    "## Ready after a short pause\n\n- Release notes checked",
  );
  const held = screen.getByRole("listitem", "Arrival 1, waiting");
  await expect(held.getByRole("heading", "Ready after a short pause")).toBeVisible();
  await app.screenshot("wait-one-arrival-pending");

  // Act
  await fixture.scenarios.elapseWait({ id: runId });

  // Assert
  await expect(screen.getByRole("button", /^Wait Pause a minute, Finished/)).toBeVisible();
  await expect(screen.getByRole("listitem", "Arrival 1, forwarded")).toContainText(
    "elapsed, forwarded",
  );
  await browser.reload();
  await expect(screen.getByRole("button", /^Wait Pause a minute, Finished/)).toBeVisible();
  const run = await readHistoryRun(app.baseUrl, runId);
  expect(run.waitArrivals.map((arrival) => [arrival.state, arrival.forwardedBy])).toEqual([
    ["forwarded", "timer"],
  ]);
  expect(run.events.filter((event) => event.kind.startsWith("wait-")).map((e) => e.kind)).toEqual([
    "wait-started",
    "wait-forwarded",
  ]);
  await app.screenshot("wait-one-arrival-forwarded");
});

test("a held message's task-list link with a long unbroken label wraps inside the narrowest inspector", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openHeldPause(
    { app, screen, browser },
    "wait-long-link",
    `- [x] [${"ReleaseNotesChecklist".repeat(10)}](https://example.com/atlas/release-notes)`,
  );
  const resize = screen.getByRole("separator", "Resize Run inspector");
  await expect(
    screen.getByRole("listitem", "Arrival 1, waiting").getByRole("checkbox", "Done"),
  ).toBeVisible();

  // Act
  await resize.press("Home");

  // Assert
  await expect(resize).toHaveAttribute("aria-valuenow", "280");
  expect(
    await browser.evaluate(
      `(() => { const arrival = document.querySelector('[aria-label="Arrival 1, waiting"]'); return arrival.scrollWidth <= arrival.clientWidth; })()`,
    ),
  ).toBe(true);
  await app.screenshot("wait-long-task-link-narrow");
});

/** The seeded Run whose Wait holds two reviews for the morning sync, open on its Run page. */
async function openMorningSyncRun(app: App, browser: Browser) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const held = await prepareScenario(app, "wait-arrivals");
  await app.open(`/runs/${held.id}`);
  return held;
}

test("Continue now forwards the selected one of two waiting arrivals early; the block then offers it for the last one", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const held = await openMorningSyncRun(app, browser);
  const block = screen.getByRole("article", "Block Hold for the morning sync");
  await expect(block).toContainText("2 held · next until");
  await expect(screen.getByRole("button", "Continue Hold for the morning sync now")).toHaveCount(0);
  await screen.getByRole("button", /^Wait Hold for the morning sync, Waiting/).tap();
  await expect(screen.getByRole("button", "Continue arrival 1 now")).toBeVisible();
  await expect(screen.getByRole("button", "Continue arrival 2 now")).toBeVisible();
  await app.screenshot("wait-two-arrivals");

  // Act
  await screen.getByRole("button", "Continue arrival 1 now").tap();

  // Assert
  await expect(screen.getByRole("listitem", "Arrival 1, forwarded")).toContainText(
    "forwarded early by you",
  );
  await expect(screen.getByRole("button", "Continue arrival 1 now")).toHaveCount(0);
  await expect(screen.getByRole("button", "Continue arrival 2 now")).toBeVisible();
  await expect(block).not.toContainText("2 waiting");
  await expect(block).toContainText("until");
  await expect(screen.getByRole("button", "Continue Hold for the morning sync now")).toBeVisible();
  await screen.getByRole("button", "Show timeline").tap();
  await expect(screen.getByRole("region", "Timeline")).toContainText("forwarded early by you");
  await app.screenshot("wait-continued-early");
  const run = await readHistoryRun(app.baseUrl, held.id);
  expect(run.waitArrivals.map((arrival) => [arrival.state, arrival.forwardedBy])).toEqual([
    ["forwarded", "user"],
    ["pending", null],
  ]);
});

/** Continue now forwards the first waiting arrival of the Run's Wait `name`. */
async function continueFirstArrival(screen: Screen, name: string) {
  await screen.getByRole("button", new RegExp(`^Wait ${name}, Waiting`)).tap();
  await screen.getByRole("button", "Continue arrival 1 now").tap();
  await expect(screen.getByRole("listitem", "Arrival 1, forwarded")).toBeVisible();
}

test("Human occurrences a Wait forwarded name the reviewer and visit that wrote each message", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const held = await openMorningSyncRun(app, browser);
  await continueFirstArrival(screen, "Hold for the morning sync");
  await screen.getByRole("button", "Continue arrival 2 now").tap();
  await expect(screen.getByRole("listitem", "Arrival 2, forwarded")).toBeVisible();

  // Act
  await app.open(`/runs/${held.id}`);

  // Assert
  const inspector = screen.getByRole("complementary", "Run inspector");
  await expect(
    inspector.getByRole("article", "Needs input · Your decision · From Code review · Visit 1", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    inspector.getByRole(
      "article",
      "Needs input · Your decision · From Accessibility review · Visit 1",
      { exact: true },
    ),
  ).toBeVisible();
  await app.screenshot("wait-forwarded-human-provenance");
});

test("a person's answer a Wait passes on to the next Human step names the step that answered, not the Agent before it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const runId = await approveFirstReviewAtLength(
    { app, screen, browser },
    "answer-relay",
    "answerRelay",
    "Approve → Hold for sign-off",
  );
  await continueFirstArrival(screen, "Hold for sign-off");
  await app.open(`/runs/${runId}`);

  // Act
  await finalSignoff(screen).getByRole("button", "Read full context", { exact: true }).tap();

  // Assert
  await expectWrittenByFirstReview(screen);
  await readerScreenshot(app, browser, "wait-relayed-answer-provenance");
});
