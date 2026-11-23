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
  await expect(screen.getByRole("switch", "Show in the menu bar")).not.toBeChecked();
  await app.screenshot("settings-desktop-app-menu-bar-off");

  // Act
  await screen.getByRole("switch", "Show in the menu bar").tap();

  // Assert: the stand-in bridge publishes the stored choice like the desktop shell.
  await expect(screen.getByRole("switch", "Show in the menu bar")).toBeChecked();
  await app.screenshot("settings-desktop-app-menu-bar-on");
});

test("a desktop user turns off Notifications and the Dock badge and shows Run details, which start on, on and off", async ({
  app,
  screen,
}) => {
  // Arrange
  await expect(screen.getByRole("switch", "Notifications")).toBeChecked();
  const notifyFinished = screen.getByRole("switch", "Notify when a Run finishes");
  await expect(notifyFinished).not.toBeChecked();
  await expect(screen.getByRole("switch", "Dock badge")).toBeChecked();
  await expect(screen.getByRole("switch", "Run details in notifications")).not.toBeChecked();
  const undetermined = screen.getByText("macOS permission", { exact: true });
  await expect(undetermined).toBeVisible();
  await undetermined.scrollIntoView();
  await app.screenshot("settings-desktop-app-notifications-default");

  // Act
  await notifyFinished.tap();
  await screen.getByRole("switch", "Notifications").tap();
  await screen.getByRole("switch", "Dock badge").tap();
  await screen.getByRole("switch", "Run details in notifications").tap();

  // Assert: the stand-in bridge publishes the stored choices like the desktop shell.
  await expect(notifyFinished).toBeChecked();
  await expect(notifyFinished).toBeDisabled();
  await expect(screen.getByRole("switch", "Notifications")).not.toBeChecked();
  await expect(screen.getByRole("switch", "Dock badge")).not.toBeChecked();
  await expect(screen.getByRole("switch", "Run details in notifications")).toBeChecked();
  await app.screenshot("settings-desktop-app-notifications-changed");
});

const effectiveOpacity = `(() => {
  const opacity = (element) => {
    let product = 1;
    for (let node = element; node; node = node.parentElement)
      product *= Number(getComputedStyle(node).opacity);
    return product;
  };
  const label = [...document.querySelectorAll("[id]")].find(
    (element) => element.textContent === "Notify when a Run finishes",
  );
  const control = document.querySelector('[aria-labelledby="' + label.id + '"]');
  return "label " + opacity(label) + ", switch " + opacity(control);
})()`;

test("with Notifications off, Notify when a Run finishes and its switch are dimmed to half opacity", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const notifyFinished = screen.getByRole("switch", "Notify when a Run finishes");
  await expect(notifyFinished).not.toBeDisabled();

  // Act
  await screen.getByRole("switch", "Notifications").tap();

  // Assert
  await expect(notifyFinished).toBeDisabled();
  await expect.poll(() => browser.evaluate(effectiveOpacity)).toBe("label 0.5, switch 0.5");
  await app.screenshot("settings-desktop-app-notify-finished-disabled");
});

test("turning Notifications back on enables Notify when a Run finishes with its choice kept", async ({
  screen,
}) => {
  // Arrange
  const notifyFinished = screen.getByRole("switch", "Notify when a Run finishes");
  await notifyFinished.tap();
  await screen.getByRole("switch", "Notifications").tap();
  await expect(notifyFinished).toBeDisabled();

  // Act
  await screen.getByRole("switch", "Notifications").tap();

  // Assert
  await expect(notifyFinished).toBeChecked();
  await expect(notifyFinished).not.toBeDisabled();
});

test("after macOS notification permission is denied, Desktop app settings say so and open System Settings", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.evaluate(`window.__observePermission("denied")`);
  await expect(screen.getByText("Not allowed", { exact: true })).toBeVisible();
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
