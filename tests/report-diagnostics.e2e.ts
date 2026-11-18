import { test } from "./support/test.ts";
import { expect } from "e2e";
import { findRun, readHistoryRun } from "./support/run-history.ts";
import { prepareScenarios } from "./support/scenarios.ts";

test("a rejected report is one plain card whose reason stays in Technical details, and recovery assesses existing work", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await prepareScenarios(app);
  const run = await findRun(app.baseUrl, "UI worker · Problem · Report exit needs correction");
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open(`/runs/${run.id}`);
  const card = screen.getByRole("article", "Problem · Implement change");
  await expect(card).toContainText("Implement change reported an unknown exit");
  await expect(card.getByText("INVALID_EXIT", { exact: false })).toHaveCount(0);
  await card.getByRole("button", "Technical details").tap();
  await expect(card).toContainText("missing-report · INVALID_EXIT");
  await app.screenshot("rejected-report-explained");

  // Act
  await screen.getByRole("button", "Request report", { exact: true }).tap();

  // Assert
  await expect(card).toContainText("The Agent is checking its work.");
  await expect(card.getByRole("button", "Request report")).toHaveCount(0);
  await browser.reload();
  await expect(card).toContainText("Implement change reported an unknown exit");
  await expect(card).toContainText("Report requested at");
  const saved = await readHistoryRun(app.baseUrl, run.id);
  expect(saved.recoveries).toHaveLength(1);
  expect(saved.reports).toEqual([]);
  await app.screenshot("rejected-report-assessment-requested");
});
