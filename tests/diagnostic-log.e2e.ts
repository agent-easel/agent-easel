import assert from "node:assert/strict";
import { beforeEach, test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import type { Fixture } from "./support/fixture/handle.ts";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
});

async function openDiagnosticLog(app: App, screen: Screen) {
  await app.open("/settings/diagnostics");
  await expect(screen.getByRole("heading", "Diagnostic log", { exact: true })).toBeVisible();
}

const detection = (screen: Screen) => screen.getByRole("region", /^Detect T3 Code at /);

async function openRecordedDetection(fixture: Fixture, app: App, screen: Screen) {
  await fixture.diagnostics.hostRecords();
  await fixture.diagnostics.t3Running();
  await openDiagnosticLog(app, screen);
  await expect(detection(screen)).toBeVisible();
}

async function expectDialogSettled(browser: Browser) {
  await expect
    .poll(() =>
      browser.evaluate(
        `getComputedStyle([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].at(-1)).opacity`,
      ),
    )
    .toBe("1");
}

async function exportedLog(app: App) {
  const response = await fetch(new URL("/api/settings/diagnostics/export", app.baseUrl));
  assert.equal(response.status, 200);
  return await response.text();
}

test("after turning on Record diagnostic log, the next T3 Code detection is recorded", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.diagnostics.t3Running();
  await openDiagnosticLog(app, screen);
  await expect(screen.getByText("Nothing recorded", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Copy", { exact: true })).toHaveCount(0);
  await app.screenshot("diagnostic-log-empty");

  // Act
  await screen.getByRole("switch", "Record diagnostic log").tap();
  await expect(screen.getByText(/^Recording until /)).toBeVisible();
  await openDiagnosticLog(app, screen);

  // Assert
  await expect(detection(screen)).toBeVisible({ timeout: 8_000 });
  await expect(detection(screen).getByText("Found", { exact: true })).toBeVisible();
  await expect(detection(screen).getByText("Read T3 Code runtime file")).toBeVisible();
  await expect(detection(screen).getByText("runtime_file_found")).toBeVisible();
  await expect(screen.getByText(/^Recording until /)).toBeVisible();
  await expect(screen.getByRole("button", "Delete", { exact: true })).toBeVisible();
  await app.screenshot("diagnostic-log-recording");
});

test("Copy previews exactly the redacted log it copies, the same text Export downloads", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openRecordedDetection(fixture, app, screen);

  // Act
  await screen.getByRole("button", "Copy", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("dialog", "Copy diagnostic log")).toBeVisible();
  await expect(screen.getByText(/Review it before posting publicly/)).toBeVisible();
  await expect(
    screen.getByText("1 attempt on screen · paths and identities already redacted"),
  ).toBeVisible();
  const preview = await browser.evaluate(
    `document.querySelector('[aria-label="Diagnostic log excerpt"]').textContent`,
  );
  const exported = await exportedLog(app);
  assert.equal(preview, exported);
  assert.match(exported, /<T3_STATE>\/server-runtime\.json/);
  assert.match(exported, /runtime_file_found/);
  assert.doesNotMatch(exported, /factory-e2e-/);
  assert.equal(
    await browser.evaluate(
      `[...document.querySelectorAll("a")].find((a) => a.textContent === "Export").getAttribute("download")`,
    ),
    "agenteasel-diagnostic-log.txt",
  );
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-copy-preview");
});

test("Delete clears the log at once while recording stays on", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openRecordedDetection(fixture, app, screen);
  await screen.getByRole("button", "Delete", { exact: true }).tap();
  await expect(
    screen.getByText(/^The recorded attempt is removed now\. Recording stays on until /),
  ).toBeVisible();
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-delete");

  // Act
  await screen.getByRole("button", "Delete log").tap();

  // Assert
  await expect(screen.getByText("Nothing recorded", { exact: true })).toBeVisible();
  await expect(screen.getByRole("switch", "Record diagnostic log")).toBeChecked();
  assert.match(await exportedLog(app), /Nothing recorded\./);
});

test("an approved device reads the host's Diagnostic log but cannot change it", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.diagnostics.hostRecords();
  await fixture.diagnostics.t3Running();
  await openRemoteBrowser(app);

  // Act
  await openApproved(app, "/settings/diagnostics");

  // Assert
  await expect(detection(screen)).toBeVisible({ timeout: 8_000 });
  await expect(screen.getByRole("button", "Copy", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Export")).toBeVisible();
  await expect(screen.getByRole("button", "Delete", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("switch", "Record diagnostic log")).toHaveCount(0);
  await expect(screen.getByRole("button", "Turn off now")).toHaveCount(0);
  await expect(screen.getByText("Managed on the AgentEasel host", { exact: true })).toBeVisible();
  await app.screenshot("diagnostic-log-remote");
});

test("an approved device waiting for the host's setup opens its Diagnostic log read-only", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.firstRunSetup.fresh();
  await fixture.firstRunSetup.hostRecordsDiagnostics();
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");
  await expect(screen.getByRole("heading", "Finish setup on the AgentEasel host")).toBeVisible();
  await app.screenshot("diagnostic-log-first-run-waiting");

  // Act
  await screen.getByRole("button", "View diagnostic log").tap();

  // Assert
  const viewer = screen.getByRole("dialog", "Diagnostic log");
  await expect(viewer.getByRole("region", /^Detect T3 Code at /).first()).toBeVisible();
  await expect(viewer.getByRole("button", "Copy", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("button", /^Delete/)).toHaveCount(0);
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-first-run-viewer");
});
