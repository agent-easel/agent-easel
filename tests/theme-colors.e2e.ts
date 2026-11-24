import { test } from "./support/test.ts";
import { expect } from "e2e";

const canvasColor = `getComputedStyle(document.body).backgroundColor`;
const factoryDark = "rgb(9, 9, 11)";
const factoryLight = "rgb(255, 255, 255)";
const nightfallDark = "rgb(20, 18, 31)";
const duskLight = "rgb(255, 248, 235)";

const nightfallJson = JSON.stringify(
  {
    name: "Nightfall",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
  },
  null,
  2,
);

const duskJson = JSON.stringify(
  {
    name: "Dusk",
    appearance: "dark",
    canvas: "#14121f",
    accent: "#9d6cff",
    variants: {
      light: {
        canvas: "#fff8eb",
        accent: "#6d28d9",
      },
    },
  },
  null,
  2,
);

test("pasting a dark color theme JSON colors AgentEasel in Dark, persists on reload, and resets cleanly", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "dark" });
  await app.open("/settings/appearance");
  await expect(screen.getByText("AgentEasel colors", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryDark);

  // Act
  await screen.getByLabel("Theme config JSON").fill(nightfallJson);
  await screen.getByRole("button", "Apply").tap();

  // Assert
  await expect(screen.getByText("Custom colors", { exact: true }).first()).toBeVisible();
  await expect(
    screen.getByRole("region", "Color theme").getByText("Nightfall", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(nightfallDark);
  await app.screenshot("theme-colors-custom-dark");

  await app.open("/settings/appearance");
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(nightfallDark);

  await screen.getByRole("button", "Reset to AgentEasel").tap();
  await expect(screen.getByText("AgentEasel colors", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryDark);
});

test("a dark-only custom theme falls back to AgentEasel Light in Light mode while a dual-mode theme colors both", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "light" });
  await app.open("/settings/appearance");

  // Act
  await screen.getByLabel("Theme config JSON").fill(nightfallJson);
  await screen.getByRole("button", "Apply").tap();

  // Assert
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryLight);
  await expect(
    screen.getByRole("region", "Color theme").getByText("AgentEasel colors", { exact: true }),
  ).toBeVisible();

  await screen.getByLabel("Theme config JSON").fill(duskJson);
  await screen.getByRole("button", "Apply").tap();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(duskLight);
});

test("invalid JSON shows an error and keeps the current colors", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "dark" });
  await app.open("/settings/appearance");

  // Act
  await screen.getByLabel("Theme config JSON").fill("{ invalid");
  await screen.getByRole("button", "Apply").tap();

  // Assert
  await expect(screen.getByText("Theme config is not valid JSON.", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(canvasColor)).toBe(factoryDark);
});
