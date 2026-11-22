import { test } from "./support/test.ts";
import { expect } from "e2e";
import { delayLiveSnapshots } from "./support/live.ts";
import {
  cachedSnapshot,
  canvasColor,
  clientWithCachedOcean,
  hostFollowingOcean,
  oceanDark,
  themeColors,
} from "./support/theme-colors.ts";

const oceanLight = "rgb(245, 247, 248)";
const factoryDark = "rgb(9, 9, 11)";
const factoryLight = "rgb(255, 255, 255)";
/** The canvases of the published themes: Nightfall's dark seed, and Dusk's seed and Light variant. */
const nightfallDark = "rgb(20, 18, 31)";
const duskLight = "rgb(255, 248, 235)";
const offlineStatusBehindSettingsDialog = `document.querySelector('[role="status"][aria-label="Offline"]') !== null`;
/** Longer than any journey: a reopened page gets no live theme colors while it is set. */
const noLiveDeliveryMs = 600_000;

test("the host follows the T3 environment's default theme through the T3 connection without pairing", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "dark" });
  await themeColors(app).followOcean();

  // Act
  await app.open("/settings/appearance");

  // Assert
  await expect(screen.getByText("Following T3", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("region", "T3 theme").getByText("Ocean", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanDark);
  expect(await screen.getByRole("button", "Pair theme colors").count()).toBe(0);
  await app.screenshot("theme-colors-host-following-dark");
});

test("an approved client follows its own system scheme through both T3 palettes", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: the host explicitly saves Dark, then an approved profile opens under Light.
  const colors = await hostFollowingOcean({ app, browser });
  await screen.getByRole("radio", "Dark").tap();
  await expect(screen.getByRole("radio", "Dark")).toBeChecked();
  await app.screenshot("theme-colors-client-one-dark");
  await browser.emulateMedia({ colorScheme: "light" });
  await colors.openApprovedClient(screen);
  await expect(screen.getByRole("radio", "System")).toBeChecked();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanLight);
  await app.screenshot("theme-colors-client-two-light");

  // Act
  await browser.emulateMedia({ colorScheme: "dark" });

  // Assert
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanDark);
  await expect(screen.getByRole("radio", "System")).toBeChecked();
  // Returning to the host under Light proves the two profiles kept separate preferences.
  await browser.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanLight);
  await app.open("/settings/appearance");
  await expect(screen.getByRole("radio", "Dark")).toBeChecked();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanDark);
});

test("a T3 without t3_theme_read keeps Factory's colors and asks for a T3 update", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const colors = await hostFollowingOcean({ app, browser });

  // Act
  await colors.unsupported();

  // Assert
  await expect(screen.getByText("Update T3 to follow its theme.", { exact: false })).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryDark);
  await app.screenshot("theme-colors-unsupported-baseline");
});

test("a published T3 theme generated from canvas and accent seeds colors Factory in Dark", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "dark" });
  const colors = themeColors(app);
  await colors.withPublishedThemes();
  await app.open("/settings/appearance");
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanDark);

  // Act
  await colors.setDefaultTheme("nightfall");

  // Assert
  await expect(screen.getByText("Following T3", { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("region", "T3 theme").getByText("Nightfall", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(nightfallDark);
  await app.screenshot("theme-colors-published-seed-dark");
});

test("System uses Factory's Light colors when a published T3 theme only supplies Dark", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: an approved browser profile follows a system initially set to Dark.
  await browser.emulateMedia({ colorScheme: "dark" });
  const colors = themeColors(app);
  await colors.followNightfallInApprovedBrowser();
  await expect(screen.getByRole("radio", "System")).toBeChecked();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(nightfallDark);

  // Act
  await browser.emulateMedia({ colorScheme: "light" });

  // Assert
  const theme = screen.getByRole("region", "T3 theme");
  await expect(theme.getByText("Factory colors", { exact: true })).toBeVisible();
  await expect(theme.getByText("T3 colors", { exact: true })).toBeVisible();
  await expect(screen.getByText("Following T3", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryLight);
  await app.screenshot("theme-colors-published-missing-light-variant");
});

test("a published theme's Light variant colors Factory in Light", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: the approved browser profile at the other address shows Light.
  const colors = themeColors(app);
  await colors.followNightfallInApprovedBrowser();
  await screen.getByRole("radio", "Light").tap();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryLight);

  // Act
  await colors.setDefaultTheme("dusk");

  // Assert
  await expect(
    screen.getByRole("region", "T3 theme").getByText("Dusk", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(duskLight);
  await app.screenshot("theme-colors-published-light-variant");
});

test("a default theme in a format Factory does not support returns to Factory's colors with a diagnostic", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "dark" });
  const colors = themeColors(app);
  await colors.withPublishedThemes();
  await colors.setDefaultTheme("nightfall");
  await app.open("/settings/appearance");
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(nightfallDark);

  // Act
  await colors.setDefaultTheme("future");

  // Assert
  await expect(screen.getByText("Factory colors", { exact: true })).toBeVisible();
  await expect(screen.getByText("Following T3", { exact: true })).toHaveCount(0);
  const problem = screen
    .getByRole("status")
    .filter({ hasText: "Factory can’t use the “Future” theme" });
  await problem.getByRole("button", "Technical details").tap();
  await expect(
    screen.getByText(
      "T3’s default theme “Future” uses a theme format Factory does not support, so Factory’s own colors are used.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryDark);
  await app.screenshot("theme-colors-published-unsupported-format");
});

test("an approved client reopening before live delivery answers shows its cached T3 theme", async (journey) => {
  // Arrange
  const { app, browser } = journey;
  const { appearance } = await clientWithCachedOcean(journey);
  await delayLiveSnapshots(app, noLiveDeliveryMs);

  // Act
  await app.open(appearance);

  // Assert
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanDark);
  await app.screenshot("theme-colors-cached-reopen-dark");
});

test("an offline client switches Light and Dark immediately within the T3 theme it holds", async (journey) => {
  // Arrange
  const { app, screen, browser, fixture } = journey;
  await clientWithCachedOcean(journey);
  await fixture.remoteAccess.offline();
  await expect.poll(() => browser.evaluate(offlineStatusBehindSettingsDialog)).toBe(true);

  // Act
  await screen.getByRole("radio", "Light").tap();

  // Assert
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(oceanLight);
  await app.screenshot("theme-colors-offline-light");
  await screen.getByRole("radio", "Dark").tap();
});

test("a client whose Factory access was revoked keeps no cached theme", async (journey) => {
  // Arrange
  const { app, screen, browser, fixture } = journey;
  const { appearance } = await clientWithCachedOcean(journey);
  await fixture.remoteAccess.revoke();

  // Act
  await app.open(appearance);

  // Assert
  await expect(screen.getByRole("heading", "Access was revoked")).toBeVisible();
  expect(await browser.evaluate(canvasColor)).toBe(factoryDark);
  await expect.poll(() => browser.evaluate(cachedSnapshot)).toBe(null);
  await app.screenshot("theme-colors-access-revoked-baseline");
});

test("a T3 default that no longer colors Factory leaves a reopening client nothing to restore", async (journey) => {
  // Arrange
  const { app, browser, screen } = journey;
  const { colors, appearance } = await clientWithCachedOcean(journey);
  await colors.setDefaultTheme("");
  const theme = screen.getByRole("region", "T3 theme");
  await expect(theme.getByText("None set in T3")).toBeVisible();
  await expect(theme.getByText("Dark", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("Factory colors", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryDark);
  await delayLiveSnapshots(app, noLiveDeliveryMs);

  // Act
  await app.open(appearance);

  // Assert
  expect(await browser.evaluate(cachedSnapshot)).toBe(null);
  expect(await browser.evaluate(canvasColor)).toBe(factoryDark);
});
