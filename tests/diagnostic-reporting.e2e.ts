import assert from "node:assert/strict";
import { beforeEach, test } from "./support/test.ts";
import { expect, type Screen } from "e2e";
import { exportedLog, openInstallViewer } from "./support/diagnostic-log.ts";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
});

const recordAndRetry = (screen: Screen) =>
  screen.getByRole("button", "Record diagnostic log and try again").first();

test("a failed Codex install in Agent reporting is recorded by one click and its attempt opens from the pane header", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.reporting.blockRequiredSkillWrite();
  await app.open("/settings/agent-reporting");
  await screen.getByRole("button", "Install all", { exact: true }).tap();
  await expect(screen.getByText("Couldn’t install for Codex", { exact: true })).toBeVisible();
  await expect(recordAndRetry(screen)).toBeVisible();
  await app.screenshot("diagnostic-reporting-problem-card");

  // Act
  await recordAndRetry(screen).tap();

  // Assert
  await expect(screen.getByRole("button", "View diagnostic log")).toBeVisible();
  await expect(recordAndRetry(screen)).toHaveCount(0);
  await app.screenshot("diagnostic-reporting-after-retry");
  const viewer = await openInstallViewer({ app, screen, browser }, "diagnostic-reporting-viewer");
  await expect(viewer.getByText("unmanageable_file").first()).toBeVisible();
  const exported = await exportedLog(app);
  assert.match(exported, /Install in Codex/);
  assert.match(exported, /<CODEX_HOME>\/skills\/factory-block\/SKILL\.md/);
  assert.doesNotMatch(exported, /factory-e2e-/);
});

test("a failed install in First-run setup is recorded by one click and its attempts open in the viewer", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.firstRunSetup.fresh();
  await fixture.firstRunSetup.codexInstallBlocked();
  await app.open("/runs/new");
  await screen.getByRole("button", "Connect").tap();
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await fixture.firstRunSetup.t3Approve();
  await expect(screen.getByRole("heading", "Install in your agents, current step")).toBeVisible({
    timeout: 8_000,
  });
  await screen.getByRole("button", /^Install in/).tap();
  await expect(screen.getByText("Couldn’t install for Codex", { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  await app.screenshot("diagnostic-reporting-first-run-failed");

  // Act
  await recordAndRetry(screen).tap();

  // Assert
  await expect(recordAndRetry(screen)).toHaveCount(0);
  await expect(screen.getByRole("button", "View diagnostic log")).toBeVisible();
  const viewer = await openInstallViewer(
    { app, screen, browser },
    "diagnostic-reporting-first-run-viewer",
  );
  await expect(viewer.getByRole("button", "Show whole log")).toBeVisible();
});
