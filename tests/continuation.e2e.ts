import { test } from "./support/test.ts";
import { expect } from "e2e";
import { createStudioFlow } from "./support/flows.ts";
import { findRun } from "./support/run-history.ts";
import { prepareScenarios } from "./support/scenarios.ts";
import { readerScreenshot } from "./support/human-answers.ts";

test("a Continuation added after an Agent names the thread it continues and keeps its prompt after Save and reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await createStudioFlow(app, screen, browser, "Grill then spec");
  await screen.getByRole("button", "Add Sample worker").tap();
  await screen.getByLabel("Name", { exact: true }).fill("Grill");
  await screen.getByRole("button", "Add Continuation").tap();
  await screen.getByLabel("Name", { exact: true }).fill("Spec");
  await screen.getByLabel("Prompt", { exact: true }).fill("Write the spec from what we agreed.");
  await screen.getByRole("button", "Close block settings").tap();
  await screen.getByRole("button", "Fit Flow").tap();
  await screen
    .getByRole("button", "Connect exit finish of Grill")
    .dragTo(screen.getByRole("article", "Block Spec"));

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  // Reloading a Flow with unsaved changes opens the browser's leave prompt, so wait for the save.
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved");
  await expect(screen.getByRole("article", "Block Spec")).toContainText("Grill's thread");
  await screen.getByRole("button", "Continuation Spec", { exact: false }).tap();
  await expect(screen.getByRole("region", "Continues")).toContainText("Grill's thread");
  await app.screenshot("continuation-authoring");
  await browser.reload();
  await screen.getByRole("button", "Continuation Spec", { exact: false }).tap();
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Write the spec from what we agreed.",
  );
});

test("a Continuation whose response went on passes through while the next Continuation's prompt is sent to the same thread", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 1100 });
  // The development seed's Run; the scenario copy belongs to the worker journeys.
  const run = await findRun(app.baseUrl, "Demo · Continuation · Spec passed on to Tickets");

  // Act
  await app.open(`/runs/${run.id}`);

  // Assert
  const spec = screen.getByRole("article", "Block Spec");
  const tickets = screen.getByRole("article", "Block Tickets");
  await expect(spec).toContainText("Finished");
  await expect(spec).toContainText("Grill the change's thread");
  await expect(tickets).toContainText("Working");
  await expect(tickets).toContainText("Grill the change's thread");
  await screen.getByRole("button", "Fit Flow").tap();
  await spec.getByRole("button", "Continuation Spec", { exact: false }).tap();
  await app.screenshot("continuation-run");
});

test("a later review a Continuation passes through to a Human step names the reviewer and visit, not the Continuation", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await prepareScenarios(app);
  const run = await findRun(app.baseUrl, "UI worker · Code review passed through the spec");
  await app.open(`/runs/${run.id}`);
  const inspector = screen.getByRole("complementary", "Run inspector");
  await expect(
    inspector.getByRole("article", "Needs input · Final sign-off · From Write the spec · Visit 1", {
      exact: true,
    }),
  ).toBeVisible();

  // Act
  await inspector
    .getByRole("article", "Needs input · Final sign-off · From Code review · Visit 1", {
      exact: true,
    })
    .getByRole("button", "Read full context", { exact: true })
    .tap();

  // Assert
  const reader = screen.getByRole("dialog", "Final sign-off · context", { exact: true });
  await expect(reader).toContainText(/From Code review · Visit 1 · \d\d:\d\d/);
  await expect(reader.getByRole("heading", "Code review", { exact: true })).toBeVisible();
  await expect(reader).not.toContainText("Write the spec");
  await readerScreenshot(app, browser, "continuation-passed-review-provenance");
});
