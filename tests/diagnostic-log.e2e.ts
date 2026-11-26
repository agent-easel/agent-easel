import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import type { Fixture } from "./support/fixture/handle.ts";
import { exportedLog, expectDialogSettled } from "./support/diagnostic-log.ts";
import type { Browser } from "@e2e-dev/web";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
});

async function openDiagnosticLog(app: App, screen: Screen) {
  await app.open("/settings/diagnostics");
  await expect(screen.getByRole("heading", "Diagnostic log", { exact: true })).toBeVisible();
}

const detection = (screen: Screen) => screen.getByRole("region", /^Detect T3 Code at /);

function downloadDiagnosticLog(browser: Browser, screen: Screen) {
  return browser.waitForDownload(() => screen.getByRole("link", "Export", { exact: true }).tap(), {
    timeout: 3_000,
  });
}

async function expectDiagnosticDownload(
  download: Awaited<ReturnType<typeof downloadDiagnosticLog>>,
  app: App,
) {
  assert.equal(download.suggestedFilename, "agenteasel-diagnostic-log.txt");
  const text = await readFile(download.absolutePath, "utf8");
  assert.match(text, /runtime_file_found/);
  assert.equal(text, await exportedLog(app));
}

async function openRecordedDetection(fixture: Fixture, app: App, screen: Screen) {
  await fixture.diagnostics.hostRecords();
  await fixture.diagnostics.t3Running();
  await openDiagnosticLog(app, screen);
  await expect(detection(screen)).toBeVisible();
}

async function recordDetections(app: App, count: number) {
  for (let index = 0; index < count; index++) {
    const setup = await fetch(new URL("/api/setup", app.baseUrl));
    assert.equal(setup.status, 200);
  }
}

async function stopRecording(app: App) {
  const stopped = await fetch(new URL("/api/settings/diagnostics", app.baseUrl), {
    method: "PUT",
    headers: { "content-type": "application/json", "X-Factory-Request": "1" },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(stopped.status, 200);
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
  await stopRecording(app);
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

test("an attempt's Copy writes only its reviewed text after confirmation", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openRecordedDetection(fixture, app, screen);
  await browser.evaluate('navigator.clipboard.writeText("keep until confirmation")');
  await app.screenshot("diagnostic-log-attempt-copy-source");
  await detection(screen).getByRole("button", "Copy Detect T3 Code attempt").tap();
  const preview = screen.getByRole("dialog", "Copy diagnostic log");
  await expect(preview.getByText(/Review it before posting publicly/)).toBeVisible();
  await expect(preview.getByText(/^1 attempt on screen/)).toBeVisible();
  await expect(preview.getByLabel("Diagnostic log excerpt")).toContainText("runtime_file_found");
  assert.equal(await browser.evaluate("navigator.clipboard.readText()"), "keep until confirmation");
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-attempt-copy-preview");
  const text = await browser.evaluate(
    `document.querySelector('[aria-label="Diagnostic log excerpt"]').textContent`,
  );

  // Act
  await preview.getByRole("button", "Copy to clipboard", { exact: true }).tap();

  // Assert
  await expect(preview).toHaveCount(0);
  assert.equal(await browser.evaluate("navigator.clipboard.readText()"), text);
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
  browser,
}) => {
  // Arrange
  await fixture.diagnostics.hostRecords();
  await fixture.diagnostics.t3Running();
  await recordDetections(app, 1);
  await stopRecording(app);
  await openRemoteBrowser(app);
  await openApproved(app, "/settings/diagnostics");
  await expect(detection(screen).first()).toBeVisible();

  // Act
  const download = await downloadDiagnosticLog(browser, screen);

  // Assert
  await expectDiagnosticDownload(download, app);
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
  await recordDetections(app, 1);
  await stopRecording(app);
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");
  await expect(screen.getByRole("heading", "Finish setup on the AgentEasel host")).toBeVisible();
  await app.screenshot("diagnostic-log-first-run-waiting");
  await screen.getByRole("button", "View diagnostic log").tap();
  const viewer = screen.getByRole("dialog", "Diagnostic log");
  await expect(viewer.getByText("runtime_file_found").first()).toBeVisible();

  // Act
  const download = await downloadDiagnosticLog(browser, screen);

  // Assert
  await expectDiagnosticDownload(download, app);
  await expect(viewer.getByRole("button", "Copy", { exact: true })).toBeVisible();
  await expect(viewer.getByRole("button", /^Delete/)).toHaveCount(0);
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-first-run-viewer");
});

test("Diagnostic log Settings can browse to attempts past the server page limit", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.diagnostics.t3Running();
  await fixture.diagnostics.hostRecords();
  await recordDetections(app, 101);
  await stopRecording(app);
  await openDiagnosticLog(app, screen);
  const older = screen.getByRole("button", "Show older attempts");
  await showAttemptsThrough(screen, 100);

  // Act
  await older.tap();

  // Assert
  await expect(detection(screen)).toHaveCount(101);
  await expect(older).toHaveCount(0);
});

test("the approved First-run viewer can read beyond the first page", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.firstRunSetup.fresh();
  await fixture.firstRunSetup.hostRecordsDiagnostics();
  await recordDetections(app, 25);
  await stopRecording(app);
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");
  await screen.getByRole("button", "View diagnostic log").tap();
  const viewer = screen.getByRole("dialog", "Diagnostic log");
  await expect(viewer.getByRole("region", /^Detect T3 Code at /)).toHaveCount(20);
  await expectDialogSettled(browser);
  await app.screenshot("diagnostic-log-viewer-first-page");

  // Act
  await viewer.getByRole("button", "Show older attempts").tap();

  // Assert
  await expect(viewer.getByRole("region", /^Detect T3 Code at /)).toHaveCount(25);
});

test("a poll that started before Delete cannot restore older attempts", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.diagnostics.t3Running();
  await fixture.diagnostics.hostRecords();
  await recordDetections(app, 25);
  await openDiagnosticLog(app, screen);
  const older = screen.getByRole("button", "Show older attempts");
  await older.tap();
  await expect(older).toHaveCount(0);
  const held = await holdOlderPoll(browser);
  await held.read;
  await screen.getByRole("button", "Delete", { exact: true }).tap();

  // Act
  await screen.getByRole("button", "Delete log").tap();

  // Assert
  await expect(detection(screen)).toHaveCount(0);
  await held.release();
  await browser.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  await expect(detection(screen)).toHaveCount(0);
  await expect(older).toHaveCount(0);
});

async function holdOlderPoll(browser: Browser) {
  const read = signal();
  const resume = signal();
  const sent = signal();
  let captured = false;
  await browser.route("**/api/settings/diagnostics/attempts?**", async (route) => {
    const cursor = new URL(route.request.url).searchParams.get("cursor");
    if (!cursor || captured) return route.continue();
    captured = true;
    const response = await route.fetch();
    const body = await response.text();
    read.resolve();
    await resume.promise;
    await route.fulfill({ status: response.status, contentType: "application/json", body });
    sent.resolve();
  });
  return {
    read: read.promise,
    async release() {
      resume.resolve();
      await sent.promise;
    },
  };
}

function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function showAttemptsThrough(screen: Screen, count: number) {
  const older = screen.getByRole("button", "Show older attempts");
  const attempts = screen.getByRole("region", /^(Detect T3 Code|Check T3 Code connection) at /);
  for (let visible = 20; visible < count; visible += 20) {
    await expect(attempts).toHaveCount(visible);
    await older.tap();
  }
  await expect(attempts).toHaveCount(count);
}
