import { test } from "./support/test.ts";
import { expect } from "e2e";
import { desktopBridgeOptions, desktopBridgeScript } from "./support/desktop-bridge.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";

const migrated = {
  migratedAt: "2026-11-24T10:00:00.000Z",
  home: "copied" as const,
  profile: "copied" as const,
  launchAtLogin: true,
  remoteServer: true,
  summaryPending: true,
  oldDataPresent: true,
};

test("after moving from T3 Factory a desktop user reads the one-time steps once and continues into AgentEasel", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await openRemoteBrowser(app);
  await browser.addInitScript(
    desktopBridgeScript,
    desktopBridgeOptions("client", "idle", null, migrated),
  );
  await openApproved(app, "/settings/desktop");
  const summary = screen.getByRole("main", "Migration from T3 Factory");
  await expect(summary.getByRole("heading", "Welcome to AgentEasel")).toBeVisible();
  await expect(summary.getByText("Approve this computer again", { exact: true })).toBeVisible();
  await expect(
    summary.getByText("Remove T3 Factory from Login Items", { exact: true }),
  ).toBeVisible();
  await app.screenshot("desktop-migration-summary");

  // Act
  await summary.getByRole("button", "Continue").tap();

  // Assert
  await expect(screen.getByRole("heading", "Desktop app")).toBeVisible();
  const backup = screen.getByText("Backup from T3 Factory", { exact: true });
  await expect(backup).toBeVisible();
  await backup.scrollIntoView();
  await app.screenshot("desktop-migration-settings-backup");
});

test("a desktop user moves the previous T3 Factory data to the Trash from Desktop app settings", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await openRemoteBrowser(app);
  await browser.addInitScript(
    desktopBridgeScript,
    desktopBridgeOptions("client", "idle", null, { ...migrated, summaryPending: false }),
  );
  await openApproved(app, "/settings/desktop");
  const backup = screen.getByText("Backup from T3 Factory", { exact: true });
  await expect(backup).toBeVisible();

  // Act
  await screen.getByRole("button", "Move to Trash…").tap();

  // Assert
  await expect(backup).not.toBeVisible();
  await expect
    .poll(() => browser.evaluate("window.__previousInstallationRemoved === true"))
    .toBe(true);
});
