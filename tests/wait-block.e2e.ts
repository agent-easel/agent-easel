import assert from "node:assert/strict";
import type { FlowDraft, Result } from "../packages/contracts/src/index.ts";
import { test } from "./support/test.ts";
import { expect } from "e2e";
import { saveSingleAgentFlow } from "./support/flows.ts";
import { readinessSummary, saveFlowWithReadiness } from "./support/studio.ts";
import { findRun, readHistoryRun } from "./support/run-history.ts";
import { applyRunState, prepareScenarios } from "./support/scenarios.ts";

test("a Wait added from the library saves with a missing duration as a readiness gap, then reloads ready with its duration and output", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
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
  await saveFlowWithReadiness(screen, /^Not ready\s*1 issue$/);
  await expect(wait).toContainText("No duration");
  await screen.getByRole("button", /^Not ready/).tap();
  await expect(screen.getByRole("list", "Readiness issues")).toContainText(
    "Enter how long Cool down waits.",
  );
  await app.screenshot("wait-readiness-missing-duration");

  // Act
  await screen.getByRole("button", "Wait Cool down").tap();
  await screen.getByLabel("Wait for").fill("90");
  await screen.getByLabel("Unit").selectOption("minutes");
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 3");
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("article", "Block Cool down")).toContainText("90 minutes");
  await screen.getByRole("button", "Wait Cool down").tap();
  await expect(screen.getByLabel("Wait for")).toHaveValue("90");
  await expect(
    screen.getByRole("region", "Output").getByRole("button", "Targets of output: none"),
  ).toBeVisible();
  await app.screenshot("wait-configured-after-reload");
  const saved = (await (
    await fetch(new URL(`/api/flows/${flowId}`, app.baseUrl))
  ).json()) as Result<FlowDraft>;
  assert(saved.ok);
  expect(saved.value.graph.blocks[1]).toMatchObject({
    kind: "wait",
    name: "Cool down",
    duration: { amount: 90, unit: "minutes" },
  });
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
  await applyRunState(
    app,
    runId,
    "result reported",
    "## Ready after a short pause\n\n- Release notes checked",
  );
  await applyRunState(app, runId, "result released to a Wait");
  await app.open(`/runs/${runId}`);
  await screen.getByRole("button", /^Wait Pause a minute, Waiting/).tap();
  const held = screen.getByRole("listitem", "Arrival 1, waiting");
  await expect(held.getByRole("heading", "Ready after a short pause")).toBeVisible();
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
