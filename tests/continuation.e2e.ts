import { test } from "./support/test.ts";
import { expect } from "e2e";
import { createStudioFlow } from "./support/flows.ts";
import { findRun } from "./support/run-history.ts";

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
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 2");
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
