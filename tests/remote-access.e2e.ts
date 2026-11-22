import { randomUUID } from "node:crypto";
import { beforeEach, test } from "./support/test.ts";
import { expect, type Screen } from "e2e";
import { desktopBridgeOptions, desktopBridgeScript } from "./support/desktop-bridge.ts";
import {
  approvedBrowser,
  expectServerInstallRequested,
  openApproved,
  openHostDevices,
  openIncompatibleApplicationSettings,
  openRemoteBrowser,
  openUpgradeReview,
  serverUpdateActions,
} from "./support/remote-access.ts";

beforeEach(async ({ app }) => {
  await openRemoteBrowser(app);
});

const settingsSections = (screen: Screen) => screen.getByRole("navigation", "Settings sections");

test("the host approves a pending device listed first, which clears the Devices & access attention dot", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const tablet = `Review tablet ${randomUUID().slice(0, 8)}`;
  await openHostDevices(app, browser, tablet);
  await expect(
    screen.getByRole("switch", "Allow approved devices on my LAN or tailnet"),
  ).toBeChecked();
  await expect(
    settingsSections(screen).getByRole("link", "Devices & access, 1 device waiting for approval", {
      exact: true,
    }),
  ).toBeVisible();
  const devices = screen.getByRole("region", "Devices");
  await expect(devices.getByRole("group").first()).toContainText(tablet);
  await app.screenshot("host-devices-pending");

  // Act
  await devices
    .getByRole("group", `${tablet}, Waiting`, { exact: true })
    .getByRole("button", "Approve")
    .tap();

  // Assert
  await expect(devices.getByRole("group", `${tablet}, Approved`, { exact: true })).toBeVisible();
  await expect(
    settingsSections(screen).getByRole("link", "Devices & access", { exact: true }),
  ).toBeVisible();
});

test("the host denies a pending device, which clears the Devices & access attention dot", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const kiosk = `Unknown kiosk ${randomUUID().slice(0, 8)}`;
  await openHostDevices(app, browser, kiosk);
  await expect(
    settingsSections(screen).getByRole("link", "Devices & access, 1 device waiting for approval", {
      exact: true,
    }),
  ).toBeVisible();
  const devices = screen.getByRole("region", "Devices");

  // Act
  await devices
    .getByRole("group", `${kiosk}, Waiting`, { exact: true })
    .getByRole("button", "Deny")
    .tap();

  // Assert
  await expect(devices.getByRole("group", `${kiosk}, Denied`, { exact: true })).toBeVisible();
  await expect(
    settingsSections(screen).getByRole("link", "Devices & access", { exact: true }),
  ).toBeVisible();
});

test("a new browser profile waits for host approval, then operates the server's shared Flows", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await app.open("/studio/flows");
  await expect(screen.getByRole("heading", "Request access to this Factory")).toBeVisible();
  await screen.getByLabel("Device name shown to the owner").fill("Review laptop browser");
  await screen.getByRole("button", "Request access").tap();
  await expect(
    screen.getByRole("heading", "Waiting for approval on the Factory host"),
  ).toBeVisible();
  await expect(screen.getByLabel("Verification code")).toContainText(/^\d{3} \d{3}$/);
  await app.screenshot("remote-pending-approval");

  // Act: the owner approves on the host panel.
  await fixture.remoteAccess.approve();

  // Assert
  await expect(screen.getByRole("link", /Shared remote plan/)).toBeVisible();
  await app.screenshot("remote-approved-studio");
});

test("confirming revocation in Settings removes access from an approved browser profile", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  const label = "Revocation journey browser";
  await app.open("/runs/new");
  await screen.getByLabel("Device name shown to the owner").fill(label);
  await screen.getByRole("button", "Request access").tap();
  await expect(screen.getByLabel("Verification code")).toBeVisible();
  await fixture.remoteAccess.approve();
  await expect(screen.getByRole("button", "New Run (+)")).toBeVisible();
  await browser.clearCookies({ name: "fixture_remote" });
  await app.open("/settings/devices");
  await screen
    .getByRole("group", `${label}, Approved`, { exact: true })
    .getByRole("button", "Revoke…", { exact: true })
    .tap();
  const confirmation = screen.getByRole("dialog", `Revoke “${label}”?`);
  await expect(confirmation).toBeVisible();

  // Act
  await confirmation.getByRole("button", "Revoke", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("group", `${label}, Revoked`, { exact: true })).toBeVisible();
  await openRemoteBrowser(app);
  await expect(screen.getByRole("heading", "Access was revoked")).toBeVisible();
  await app.screenshot("remote-revoked");
});

test("an approved browser installs Factory MCP on the server and retains it after reload", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await fixture.reporting.removeRegistration();
  await openApproved(app, "/settings/agent-reporting");
  const codex = screen.getByRole("group", "Codex", { exact: true });
  await expect(codex.getByRole("status")).toHaveText("Not installed");
  await expect(codex.getByRole("button", "Install Codex", { exact: true })).toBeEnabled();
  await app.screenshot("remote-reporting-install-available");

  // Act
  await codex.getByRole("button", "Install Codex", { exact: true }).tap();

  // Assert
  await expect(codex.getByRole("status")).toHaveText("Installed");
  await browser.reload();
  await expect(codex.getByRole("status")).toHaveText("Installed");
  await expect(codex.getByRole("button", "Reinstall Codex", { exact: true })).toBeEnabled();
  await app.screenshot("remote-reporting-installed");
});

test("an approved browser repairs the server's Factory MCP installation", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.reporting.breakRequiredSkill();
  await openApproved(app, "/settings/agent-reporting");
  const codex = screen.getByRole("group", "Codex", { exact: true });
  await expect(codex.getByRole("status")).toHaveText("Needs attention");

  // Act
  await codex.getByRole("button", "Repair Codex", { exact: true }).tap();

  // Assert
  await expect(codex.getByRole("status")).toHaveText("Installed");
  await app.screenshot("remote-reporting-repaired");
});

test("a lost server connection marks the last observed view offline and disables actions", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await approvedBrowser(app, screen);
  await expect(screen.getByRole("button", "New Run (+)")).toBeEnabled();

  // Act
  await fixture.remoteAccess.offline();

  // Assert
  await expect(
    screen.getByRole("navigation", "Sidebar footer").getByRole("status", "Offline"),
  ).toHaveText(/^Offline · last observed \d{2}:\d{2}:\d{2}$/);
  await expect(screen.getByRole("button", "New Run (+)")).toBeDisabled();
  await expect(screen.getByRole("textbox", "Search Run titles")).toBeEnabled();
  const settings = screen.getByRole("link", "Settings, Offline", { exact: true });
  await expect(settings).toBeEnabled();
  await settings.hover();
  await expect(screen.getByRole("tooltip")).toContainText("Settings");
  await expect(screen.getByRole("tooltip")).not.toContainText("Offline");
  await screen.getByRole("textbox", "Search Run titles").hover();
  await settings.focus();
  await expect(screen.getByRole("tooltip")).toContainText("Settings");
  await expect(screen.getByRole("tooltip")).not.toContainText("Offline");
  await expect(browser.locator('[aria-label="Settings, Offline"] [title]')).toHaveCount(0);
  await expect(screen.getByRole("link", "Studio", { exact: true })).toBeEnabled();
  await app.screenshot("remote-offline");
  await fixture.remoteAccess.online();
  await expect(screen.getByRole("status", "Offline")).toHaveCount(0);
  await expect(screen.getByRole("button", "New Run (+)")).toBeEnabled();
});

test("a failed access request can be retried after automatic reconnection", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await app.open("/");
  await expect(screen.getByRole("button", "Request access")).toBeEnabled();
  await fixture.remoteAccess.dropAccessRequest();
  await screen.getByRole("button", "Request access").tap();
  await expect(screen.getByRole("alert")).toContainText("server may have accepted the request");
  await expect(screen.getByRole("button", "Request access")).toBeEnabled();

  // Act
  await screen.getByRole("button", "Request access").tap();

  // Assert
  await expect(screen.getByLabel("Verification code")).toBeVisible();
  await app.screenshot("access-request-reconnected");
});

test("an incompatible desktop client can read its installed version even without an available update", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1280, height: 800 });
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("client", "idle"));

  // Act
  await openIncompatibleApplicationSettings(app, screen);

  // Assert
  const settings = screen.getByRole("dialog", "Local application settings");
  await expect
    .poll(() =>
      browser.evaluate(`getComputedStyle(document.querySelector('[role="dialog"]')).opacity`),
    )
    .toBe("1");
  await app.screenshot("local-installed-version");
  await expect(
    settings.getByText("Version 0.1.0 for macOS (Apple Silicon).", { exact: true }),
  ).toBeVisible();
});

test("an incompatible desktop client can upgrade itself from local application settings", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("client"));
  await openIncompatibleApplicationSettings(app, screen);
  await screen.getByRole("button", "Upgrade…").tap();
  await expect(screen.getByRole("heading", "Upgrade to 0.2.0?")).toBeVisible();
  await app.screenshot("local-upgrade-review");

  // Act
  await screen.getByRole("button", "Upgrade", { exact: true }).tap();

  // Assert: the stand-in bridge records the request instead of restarting the app.
  await expect(screen.getByRole("status")).toContainText("Upgrading…");
});

test("an approved browser upgrades the server after reviewing it", async ({ app, screen }) => {
  // Arrange
  const before = (await serverUpdateActions(app)).length;
  await openUpgradeReview(app, screen, "server");

  // Act
  await screen.getByRole("button", "Upgrade", { exact: true }).tap();

  // Assert
  await expectServerInstallRequested(app, screen, before);
});

test("a desktop client upgrades its server first and waits for it before restarting", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("client"));
  const before = (await serverUpdateActions(app)).length;
  await openUpgradeReview(app, screen, "client + server");
  await expect(screen.getByRole("dialog", "Upgrade client + server?")).toContainText(
    "The server updates before the client restarts.",
  );
  await app.screenshot("upgrade-review-client-and-server");

  // Act
  await screen.getByRole("button", "Upgrade", { exact: true }).tap();

  // Assert: the fixture server never returns on its target release, so the client keeps waiting.
  await expectServerInstallRequested(app, screen, before);
});

test("an available update previews its changes as short lines in the footer tooltip", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const change = (title: string, pr: number) =>
    `<li>${title} by @ali in https://github.com/alimek/t3-factory/pull/${pr}</li>`;
  const notes = `<h2>What's Changed</h2><ul>${[
    change("feat(desktop): faster startup", 30),
    change("fix: more reliable reconnects", 31),
    change("feat: improved update diagnostics", 32),
    change("fix(ui): tidy footer spacing", 33),
    change("chore: refresh dependencies", 34),
  ].join(
    "",
  )}</ul><p><strong>Full Changelog</strong>: https://github.com/alimek/t3-factory/compare/v0.1.0...v0.2.0</p>`;
  await browser.addInitScript(
    desktopBridgeScript,
    desktopBridgeOptions("client", "available", notes),
  );
  await openApproved(app, "/runs/new");

  // Act
  await screen.getByRole("button", "0.2.0 available").hover();

  // Assert
  const tooltip = screen.getByRole("tooltip");
  await expect(tooltip).toContainText("Faster startup");
  await expect(tooltip).toContainText("+1 more");
  await expect(tooltip).not.toContainText("@ali");
  await app.screenshot("changelog-tooltip");
});

test("the current composer requires an updated server before requesting access", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.remoteAccess.olderServer();

  // Act
  await app.open("/runs/new");

  // Assert
  await expect(
    screen.getByRole("heading", "This client and server can’t work together"),
  ).toBeVisible();
  await expect(screen.getByText(/Update the Factory server/)).toBeVisible();
  await expect(screen.getByRole("button", "Request access")).toHaveCount(0);
  await app.screenshot("older-server-rejected");
});

test("an incompatible client recovers when the selected server becomes compatible", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await fixture.remoteAccess.incompatible();
  await app.open("/");
  await expect(
    screen.getByRole("heading", "This client and server can’t work together"),
  ).toBeVisible();

  await expect(screen.getByText(/Update this client/)).toBeVisible();
  await app.screenshot("remote-incompatible");

  // Act
  await fixture.remoteAccess.compatible();

  // Assert
  await expect(screen.getByRole("heading", "Request access to this Factory")).toBeVisible();
  await app.screenshot("compatible-server-recovered");
});
