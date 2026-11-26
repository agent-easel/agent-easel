import assert from "node:assert/strict";
import { beforeEach, test } from "./support/test.ts";
import { expect, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { exportedLog, openInstallViewer } from "./support/diagnostic-log.ts";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
});

const recordAndRetry = (screen: Screen) =>
  screen.getByRole("button", "Record diagnostic log and try again").first();

function signal() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function holdRecording(browser: Browser) {
  const started = signal();
  const release = signal();
  await browser.route("**/api/settings/diagnostics", async (route) => {
    if (route.request.method === "PUT") {
      started.resolve();
      await release.promise;
    }
    await route.continue();
  });
  return { started: started.promise, release: release.resolve };
}

async function holdSecondInstall(browser: Browser) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0;
  await browser.route("**/api/reporting/install", async (route) => {
    if (++requested === 2) await held;
    await route.continue();
  });
  return release;
}

test("a failed Codex install in Agent reporting is recorded by one click and its attempt opens from the pane header", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.reporting.blockRequiredSkillWrite();
  await app.open("/settings/agent-reporting");
  const finishInstallAll = await holdSecondInstall(browser);
  await screen.getByRole("button", "Install all", { exact: true }).tap();
  await expect(screen.getByText("Couldn’t install for Codex", { exact: true })).toBeVisible();
  await expect(recordAndRetry(screen)).toBeDisabled();
  finishInstallAll();
  await expect(recordAndRetry(screen)).toBeEnabled();
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

test("a recorded reporting retry after expiry opens only the new attempt", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.reporting.blockRequiredSkillWrite();
  await app.open("/settings/agent-reporting");
  await screen.getByRole("button", "Install all", { exact: true }).tap();
  await recordAndRetry(screen).tap();
  const view = screen.getByRole("button", "View diagnostic log");
  await expect(view).toBeVisible();
  const first = await exportedLog(app);
  const firstHeading = first.match(/^### Install in Codex · .*$/m)?.[0];
  assert(firstHeading);
  await fixture.diagnostics.expireRecording();
  await expect(recordAndRetry(screen)).toBeEnabled();

  // Act
  await recordAndRetry(screen).tap();

  // Assert
  const viewer = await openInstallViewer(
    { app, screen, browser },
    "diagnostic-reporting-after-expiry",
  );
  await expect(viewer.getByRole("region", /^Install in Codex at /)).toHaveCount(1);
  const log = await exportedLog(app);
  assert.equal(log.match(/### Install in Codex/g)?.length, 2);
  const preview = viewer.getByRole("button", "Copy", { exact: true });
  await preview.tap();
  const excerpt = screen
    .getByRole("dialog", "Copy diagnostic log")
    .getByLabel("Diagnostic log excerpt");
  await expect(excerpt).toContainText("Install in Codex");
  await expect(excerpt).not.toContainText(firstHeading);
});

test("Settings Check again records one explicit reporting check while ordinary list reads stay silent", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.diagnostics.hostRecords();
  await app.open("/settings/agent-reporting");
  const check = screen.getByRole("button", "Check again", { exact: true });
  await expect(check).toBeEnabled();
  assert.doesNotMatch(await exportedLog(app), /Check Agent reporting/);

  // Act
  await check.tap();

  // Assert
  await expect.poll(() => exportedLog(app)).toMatch(/Check Agent reporting/);
});

test("Settings can record and recover after only the reporting list read fails", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.route("**/api/reporting", (route) => route.abort());
  await app.open("/settings/agent-reporting");
  await expect(screen.getByText("Couldn’t check Agent reporting")).toBeVisible();
  await app.screenshot("settings-reporting-read-failure");

  // Act
  await recordAndRetry(screen).tap();

  // Assert
  await expect(screen.getByRole("button", "View diagnostic log")).toBeVisible();
  await expect(screen.getByRole("group", "Codex", { exact: true })).toBeVisible();
});

test("First-run can record and recover after only the reporting list read fails", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.firstRunSetup.fresh();
  await browser.route("**/api/reporting", (route) => route.abort());
  await fixture.firstRunSetup.hostConnects();
  await app.open("/runs/new");
  await expect(screen.getByText("Couldn’t check your harnesses")).toBeVisible({ timeout: 8000 });
  await app.screenshot("first-run-reporting-read-failure");

  // Act
  await recordAndRetry(screen).tap();

  // Assert
  await expect(screen.getByRole("button", "View diagnostic log")).toBeVisible();
  await expect(screen.getByRole("button", /^Install in/)).toBeEnabled();
});

test("First-run Check again records discovery when the host is already recording", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.firstRunSetup.fresh({ harnessesOn: false });
  await fixture.firstRunSetup.hostConnects();
  await app.open("/runs/new");
  await expect(screen.getByText("Turn on a harness in T3 Code")).toBeVisible({ timeout: 8000 });
  await fixture.firstRunSetup.hostRecordsDiagnostics();

  // Act
  await screen.getByRole("button", "Check again", { exact: true }).tap();

  // Assert
  await expect.poll(() => exportedLog(app)).toMatch(/Check Agent reporting/);
});

test("a delayed recorded recheck cannot replace the newly eligible First-run harness or select stale attempts", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await fixture.firstRunSetup.fresh({ harnessesOn: false });
  await fixture.firstRunSetup.hostConnects();
  await app.open("/runs/new");
  await expect(screen.getByText("Turn on a harness in T3 Code")).toBeVisible();
  const captured = signal();
  const release = signal();
  await browser.route("**/api/reporting/recheck", async (route) => {
    const reply = await route.fetch();
    const body = await reply.text();
    captured.resolve();
    await release.promise;
    await route.fulfill({ status: reply.status, contentType: "application/json", body });
  });
  await recordAndRetry(screen).tap();
  await captured.promise;
  await fixture.firstRunSetup.codexTurnedOn();
  const install = screen.getByRole("button", "Install in 1 harness");
  await expect(install).toBeVisible({ timeout: 8000 });

  // Act
  release.resolve();

  // Assert
  await expect(install).toBeEnabled();
  await expect(screen.getByRole("button", "View diagnostic log")).toHaveCount(0);
  await expect(screen.getByRole("button", "Open AgentEasel")).toHaveCount(0);
});

test("a First-run install failure followed by a conflicting entry retries discovery", async ({
  fixture,
  app,
  browser,
  screen,
}) => {
  // Arrange
  await fixture.firstRunSetup.fresh();
  await fixture.firstRunSetup.codexInstallBlocked();
  await fixture.firstRunSetup.hostConnects();
  await app.open("/runs/new");
  await screen.getByRole("button", /^Install in/).tap();
  await expect(screen.getByText("Couldn’t install for Codex")).toBeVisible();
  const recording = await holdRecording(browser);
  await recordAndRetry(screen).tap();
  await recording.started;
  await fixture.firstRunSetup.codexEntryConflicts();
  await fixture.firstRunSetup.grokTurnedOn();
  await expect(screen.getByRole("group", "Grok", { exact: true })).toBeVisible({ timeout: 8000 });

  // Act
  recording.release();

  // Assert
  await screen.getByRole("button", "View diagnostic log").tap();
  await expect(screen.getByRole("region", /^Check Agent reporting at /)).toBeVisible();
  assert.doesNotMatch(await exportedLog(app), /Install in Codex/);
});
