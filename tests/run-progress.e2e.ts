import { expect } from "e2e";
import { test } from "./support/test.ts";
import { openComposerWithFlow, selectComposerProject } from "./support/composer.ts";
import { archiveJourneyRun, findRun, readHistoryRun } from "./support/run-history.ts";

test("a worker with three hours of silence shows Needs input on its Run", async ({
  app,
  screen,
}) => {
  // Arrange
  const found = await findRun(app.baseUrl, "Demo · Needs input · Search indexing has gone quiet");
  const run = await readHistoryRun(app.baseUrl, found.id);

  // Act
  await app.open(`/runs/${run.id}`);

  // Assert
  await expect(screen.getByRole("article", "Review Implement change in T3 Code")).toContainText(
    "No progress report for at least three hours.",
  );
  await app.screenshot("overdue-worker");
});

test("Start anyway accepts a Run only after the composer shows the closed issue", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  await fixture.github.issue({ number: 41, title: "Index search results", open: false });
  await openComposerWithFlow(app, screen, "Demo · Focused change");
  await selectComposerProject(screen, "Atlas demo");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("Check issue #41");

  // Act
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert
  await expect(
    screen.getByText("factory-demo/atlas#41 is already closed.", { exact: true }),
  ).toBeVisible();
  await app.screenshot("completed-issue");
  await screen.getByRole("button", "Start anyway").tap();
  await expect(screen.getByRole("heading", "Check issue #41", { exact: true })).toBeVisible();
  await archiveJourneyRun(app.baseUrl, (await findRun(app.baseUrl, "Check issue #41")).id);
});
