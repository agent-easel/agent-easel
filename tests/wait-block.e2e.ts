import assert from "node:assert/strict";
import type { FlowDraft, Result } from "../packages/contracts/src/index.ts";
import { test } from "./support/test.ts";
import { expect } from "e2e";
import { saveSingleAgentFlow } from "./support/flows.ts";
import { readinessSummary, saveFlowWithReadiness } from "./support/studio.ts";
import type { StudioFixtures } from "./support/studio.ts";
import { findRun, readHistoryRun } from "./support/run-history.ts";
import { applyRunState, prepareScenarios } from "./support/scenarios.ts";

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
  await saveFlowWithReadiness(fixtures.screen, "Ready", 3);
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
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 2");
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
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 3");
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

test("a saved Wait shows its duration on the canvas after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await savedWaitFor90Hours({ app, screen, browser });

  // Act
  await browser.reload();

  // Assert
  await expect(screen.getByRole("article", "Block Cool down")).toContainText("90 hours");
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

test("a waiting arrival is held with its message and forwarded by the backend once its minute elapses", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await prepareScenarios(app);
  const { id: runId } = await fixture.scenarios.ensure({
    key: "wait",
    flow: "pause",
  });
  await applyRunState(app, runId, "result reported", "Ready after a short pause.");
  await applyRunState(app, runId, "result released to a Wait");
  await app.open(`/runs/${runId}`);
  await screen.getByRole("button", /^Wait Pause a minute, Waiting/).tap();
  await expect(screen.getByRole("listitem", "Arrival 1, waiting")).toContainText(
    "Ready after a short pause.",
  );
  await app.screenshot("wait-one-arrival-pending");

  // Act
  const forwarded = screen.getByRole("button", /^Wait Pause a minute, Finished/);
  await expect(forwarded).toBeVisible({ timeout: 90_000 });

  // Assert
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

test("Continue now forwards the selected one of two waiting arrivals early; the block then offers it for the last one", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await prepareScenarios(app);
  const held = await findRun(
    app.baseUrl,
    "UI worker · Waiting · Two reviews held for the morning sync",
  );
  await app.open(`/runs/${held.id}`);
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
