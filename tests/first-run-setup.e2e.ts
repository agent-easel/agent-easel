import { test } from "./support/test.ts";
import { expect } from "e2e";
import type { Result, T3Connection } from "../packages/contracts/src/index.ts";
import { hostT3Observations } from "./support/remote-access.ts";

async function savedEndpoint(baseUrl: string | undefined) {
  const response = await fetch(new URL("/api/connection", baseUrl));
  const connection = (await response.json()) as Result<T3Connection>;
  return connection.ok ? connection.value.endpoint : null;
}

test("a fresh host connects to the detected T3 from the setup screen, then moves on to installing", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  // The accepted Figma frames are 1440 × 900 in the dark appearance.
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
  await fixture.firstRunSetup.fresh();
  await app.open("/runs/new");
  await expect(screen.getByRole("heading", "Set up Factory")).toBeVisible();
  await expect(screen.getByRole("heading", "Connect to T3, current step")).toBeVisible();
  await expect(screen.getByRole("heading", "Install in your agents, upcoming step")).toBeVisible();
  await expect(screen.getByText("T3 0.1.11 is running on this computer")).toBeVisible();
  await expect(screen.getByText("http://127.0.0.1:3773/mcp", { exact: true })).toBeVisible();
  await expect(screen.getByText(/Connect opens T3’s approval page in your browser/)).toBeVisible();
  // The disclosure stays closed while T3 is detected, and no product route mounts behind it.
  await expect(screen.getByRole("button", "Save and connect")).toHaveCount(0);
  await expect(screen.getByRole("link", /^Settings/)).toHaveCount(0);
  await expect(screen.getByRole("button", "Connect")).toBeEnabled();
  // Live delivery enables actions once current; the frame waits for the button's fade-in.
  await expect
    .poll(() =>
      browser.evaluate(
        `getComputedStyle([...document.querySelectorAll("button")].find((b) => b.textContent === "Connect")).opacity`,
      ),
    )
    .toBe("1");
  await app.screenshot("first-run-setup-t3-detected");

  // Act
  await screen.getByRole("button", "Connect").tap();

  // Assert: Connect saved the detected address and started approval in the host's browser.
  await expect(screen.getByText("Approve Factory in your browser")).toBeVisible();
  await expect(screen.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Reopen approval page")).toBeVisible();
  expect(await savedEndpoint(app.baseUrl)).toBe("http://127.0.0.1:3773/mcp");
  expect((await hostT3Observations(app)).authorizationStarts).toBe(1);
  await app.screenshot("first-run-setup-waiting");

  // The owner approves in T3; nobody touches this screen.
  await fixture.remoteAccess.t3Approve();
  await expect(screen.getByRole("heading", "Connect to T3, done")).toBeVisible({ timeout: 8_000 });
  await expect(screen.getByRole("heading", "Install in your agents, current step")).toBeVisible();
  await expect(screen.getByText("Approve Factory in your browser")).toHaveCount(0);
  await app.screenshot("first-run-setup-connected");
});
