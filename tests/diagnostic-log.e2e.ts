import assert from "node:assert/strict";
import { beforeEach, test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import type { Fixture } from "./support/fixture/handle.ts";
import { exportedLog, expectDialogSettled } from "./support/diagnostic-log.ts";

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

test("Copy writes the reviewed redacted excerpt and Export includes it", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.diagnostics.t3Running();
  await fixture.diagnostics.hostRecords();
  const setup = await fetch(new URL("/api/setup", app.baseUrl));
  assert.equal(setup.status, 200);
  const stopped = await fetch(new URL("/api/settings/diagnostics", app.baseUrl), {
    method: "PUT",
    headers: { "content-type": "application/json", "X-Factory-Request": "1" },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(stopped.status, 200);
  await openDiagnosticLog(app, screen);
  await screen.getByRole("button", "Copy", { exact: true }).tap();
  await expect(screen.getByRole("dialog", "Copy diagnostic log")).toBeVisible();
  await expect(screen.getByText(/Review it before posting publicly/)).toBeVisible();
  await expect(
    screen.getByText(/^\d+ attempts? on screen · paths and identities already redacted$/),
  ).toBeVisible();
  const preview = await browser.evaluate(
    `document.querySelector('[aria-label="Diagnostic log excerpt"]').textContent`,
  );
  assert(typeof preview === "string");
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-copy-preview");

  // Act
  await screen.getByRole("button", "Copy to clipboard", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("dialog", "Copy diagnostic log")).toHaveCount(0);
  assert.equal(await browser.evaluate("navigator.clipboard.readText()"), preview);
  const exported = await exportedLog(app);
  assert.ok(exported.startsWith(preview));
  assert.match(preview, /<T3_STATE>\/server-runtime\.json/);
  assert.match(preview, /runtime_file_found/);
  assert.doesNotMatch(preview, /factory-e2e-/);
  assert.equal(
    await browser.evaluate(
      `[...document.querySelectorAll("a")].find((a) => a.textContent === "Export").getAttribute("download")`,
    ),
    "agenteasel-diagnostic-log.txt",
  );
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
  await expect(screen.getByText(/removed now\. Recording stays on until /)).toBeVisible();
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-delete");

  // Act
  await screen.getByRole("button", "Delete log").tap();

  // Assert
  await expect(detection(screen)).toHaveCount(0);
  await expect(screen.getByRole("switch", "Record diagnostic log")).toBeChecked();
  assert.doesNotMatch(await exportedLog(app), /runtime_file_found/);
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
