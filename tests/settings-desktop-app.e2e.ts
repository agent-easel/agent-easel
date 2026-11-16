import { beforeEach, test } from "./support/test.ts";
import { expect } from "e2e";
import { desktopBridgeOptions, desktopBridgeScript } from "./support/desktop-bridge.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";

// Every journey opens Settings → Desktop app through the stand-in desktop bridge.
beforeEach(async ({ app, browser, screen }) => {
  await openRemoteBrowser(app);
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("client"));
  await openApproved(app, "/settings/desktop");
  await expect(screen.getByRole("heading", "Desktop app")).toBeVisible();
});

test("a desktop user turns on the menu bar icon, which is off by default, in Desktop app settings", async ({
  app,
  screen,
}) => {
  // Arrange
  await expect(screen.getByRole("switch", "Show Factory in the menu bar")).not.toBeChecked();
  await app.screenshot("settings-desktop-app-menu-bar-off");

  // Act
  await screen.getByRole("switch", "Show Factory in the menu bar").tap();

  // Assert: the stand-in bridge publishes the stored choice like the desktop shell.
  await expect(screen.getByRole("switch", "Show Factory in the menu bar")).toBeChecked();
  await app.screenshot("settings-desktop-app-menu-bar-on");
});

test("a desktop user turns off Notifications and the Dock badge and shows Run details, which start on, on and off", async ({
  app,
  screen,
}) => {
  // Arrange
  await expect(screen.getByRole("switch", "Notifications")).toBeChecked();
  await expect(screen.getByRole("switch", "Dock badge")).toBeChecked();
  await expect(screen.getByRole("switch", "Show Run details in notifications")).not.toBeChecked();
  const undetermined = screen.getByText(
    "macOS asks the first time Factory would show a notification.",
  );
  await expect(undetermined).toBeVisible();
  await undetermined.scrollIntoView();
  await app.screenshot("settings-desktop-app-notifications-default");

  // Act
  await screen.getByRole("switch", "Notifications").tap();
  await screen.getByRole("switch", "Dock badge").tap();
  await screen.getByRole("switch", "Show Run details in notifications").tap();

  // Assert: the stand-in bridge publishes the stored choices like the desktop shell.
  await expect(screen.getByRole("switch", "Notifications")).not.toBeChecked();
  await expect(screen.getByRole("switch", "Dock badge")).not.toBeChecked();
  await expect(screen.getByRole("switch", "Show Run details in notifications")).toBeChecked();
  await app.screenshot("settings-desktop-app-notifications-changed");
});

test("after macOS notification permission is denied, Desktop app settings say so and open System Settings", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.evaluate(`window.__observePermission("denied")`);
  await expect(
    screen.getByText("Not allowed. Factory won't ask again; the Dock badge still works."),
  ).toBeVisible();
  await expect
    .poll(() =>
      browser.evaluate(`getComputedStyle(document.querySelector('[role="dialog"]')).opacity`),
    )
    .toBe("1");
  await screen.getByRole("button", "Open System Settings").scrollIntoView();
  await app.screenshot("settings-desktop-app-permission-denied");

  // Act
  await screen.getByRole("button", "Open System Settings").tap();

  // Assert
  await expect
    .poll(() => browser.evaluate(`window.__notificationSettingsOpened === true`))
    .toBe(true);
});
