import assert from "node:assert/strict";
import { expect, type App } from "e2e";
import type { Result, TelemetrySetting } from "../packages/contracts/src/index.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import { test } from "./support/test.ts";

async function telemetrySetting(app: App, telemetryEnabled?: boolean) {
  const response = await fetch(new URL("/api/settings/telemetry", app.baseUrl), {
    method: telemetryEnabled === undefined ? "GET" : "PUT",
    headers: { "X-Factory-Request": "1", "Content-Type": "application/json" },
    ...(telemetryEnabled === undefined ? {} : { body: JSON.stringify({ telemetryEnabled }) }),
  });
  const result = (await response.json()) as Result<TelemetrySetting>;
  assert(result.ok, JSON.stringify(result));
  return result.value;
}

test("the host can opt out of analytics and the switch stays off after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open("/settings/connection");
  await screen.getByRole("link", "Privacy", { exact: true }).tap();
  const toggle = screen.getByRole("switch", "Share anonymous usage data");
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  await app.screenshot("privacy-on");

  // Act
  await toggle.tap();

  // Assert
  await expect(toggle).not.toBeChecked();
  expect(await telemetrySetting(app)).toMatchObject({
    telemetryEnabled: false,
    effectiveEnabled: false,
  });
  await app.open("/settings/privacy");
  await expect(toggle).not.toBeChecked();
  await expect(screen.getByRole("region", "What’s sent")).toContainText(
    "Prompts, code, file paths",
  );
  await app.screenshot("privacy-off");
});

test("the host can resume analytics and the switch stays on in a small window after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await telemetrySetting(app, false);
  await browser.setViewport({ width: 1024, height: 700 });
  await app.open("/settings/privacy");
  const toggle = screen.getByRole("switch", "Share anonymous usage data");
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();

  // Act
  await toggle.tap();

  // Assert
  await expect(toggle).toBeChecked();
  expect(await telemetrySetting(app)).toMatchObject({
    telemetryEnabled: true,
    effectiveEnabled: true,
  });
  await app.open("/settings/privacy");
  await expect(toggle).toBeChecked();
  await expect(screen.getByRole("region", "What’s sent")).toBeVisible();
  await app.screenshot("privacy-small-window");
});

test("an approved remote client sees effective analytics status and disclosure without a switch", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await telemetrySetting(app, true);
  await browser.setViewport({ width: 1440, height: 900 });
  await openRemoteBrowser(app);

  // Act
  await openApproved(app, "/settings/privacy");

  // Assert
  await expect(screen.getByText("Managed on the Factory host", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("region", "Product analytics").getByText("On", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("switch", "Share anonymous usage data")).toHaveCount(0);
  await expect(screen.getByRole("region", "What’s sent")).toBeVisible();
  await app.screenshot("privacy-remote");
});
