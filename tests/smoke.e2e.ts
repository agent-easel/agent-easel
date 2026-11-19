import { test } from "./support/test.ts";
import { expect } from "e2e";

test("Factory serves the built UI and seeded Flows", async ({ app, screen }) => {
  // Arrange
  // Act
  await app.open("/studio/flows");

  // Assert
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "New Flow")).toBeVisible();
  await expect(screen.getByRole("link", /Launch ready Flow/)).toBeVisible();
  await app.screenshot("flows-smoke");
});
