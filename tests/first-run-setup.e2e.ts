import { test } from "./support/test.ts";
import { expect, type App } from "e2e";
import type { Browser } from "@e2e-dev/web";
import type { FirstRunSetup, Result, T3Connection } from "../packages/contracts/src/index.ts";
import { hostT3Observations } from "./support/remote-access.ts";
import type { Fixture } from "./support/fixture/handle.ts";

/** A fresh host's setup screen, in the accepted Figma frames' 1440 × 900 dark appearance. */
async function openFreshSetup(
  { fixture, app, browser }: { fixture: Fixture; app: App; browser: Browser },
  options?: { harnessesOn?: boolean },
) {
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.emulateMedia({ colorScheme: "dark" });
  await fixture.firstRunSetup.fresh(options);
  await app.open("/runs/new");
}

async function setupCompleted(baseUrl: string | undefined) {
  const response = await fetch(new URL("/api/setup", baseUrl));
  const setup = (await response.json()) as Result<FirstRunSetup>;
  return setup.ok && setup.value.completed;
}

async function savedEndpoint(baseUrl: string | undefined) {
  const response = await fetch(new URL("/api/connection", baseUrl));
  const connection = (await response.json()) as Result<T3Connection>;
  return connection.ok ? connection.value.endpoint : null;
}

test("a fresh host connects to the detected T3, installs in its harnesses and opens Factory for good", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser });
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
  await expect(screen.getByRole("heading", "Connected to T3 0.1.11, done")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByRole("heading", "Install in your agents, current step")).toBeVisible();
  await expect(screen.getByText("Approve Factory in your browser")).toHaveCount(0);

  // Step 2 lists the installable harnesses T3 has on, and names the ones it keeps off.
  const claude = screen.getByRole("group", "Claude", { exact: true });
  const codex = screen.getByRole("group", "Codex", { exact: true });
  await expect(claude.getByRole("status")).toHaveText("Not installed");
  await expect(claude).toContainText(".claude.json · ");
  await expect(claude).toContainText("reporting-claude/skills");
  await expect(codex.getByRole("status")).toHaveText("Not installed");
  await expect(codex).toContainText("reporting-codex/config.toml · ");
  await expect(codex).toContainText("reporting-codex/skills");
  await expect(
    screen.getByText("Cursor and Grok are off in T3. Turn them on there to include them."),
  ).toBeVisible();
  await expect(screen.getByRole("group", "Cursor", { exact: true })).toHaveCount(0);
  await app.screenshot("first-run-setup-install");
  await screen.getByRole("button", "What gets installed").tap();
  await expect(screen.getByText(/Factory MCP/)).toBeVisible();
  await expect(screen.getByText(/factory-start-run/)).toBeVisible();
  await screen.getByRole("button", "What gets installed").tap();

  await screen.getByRole("button", "Install in 2 harnesses").tap();

  // Ready: both steps done, and a reminder that open sessions keep the tools they loaded.
  await expect(screen.getByRole("heading", "Factory is ready")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByRole("heading", "Installed in Claude and Codex, done")).toBeVisible();
  await expect(screen.getByText("Open a new agent session")).toBeVisible();
  expect(await setupCompleted(app.baseUrl)).toBe(false);
  await app.screenshot("first-run-setup-ready");

  await screen.getByRole("button", "Open Factory").tap();

  await expect(screen.getByRole("link", /^Settings/)).toBeVisible();
  await expect(screen.getByRole("heading", "Factory is ready")).toHaveCount(0);
  expect(await setupCompleted(app.baseUrl)).toBe(true);
  // Completion is durable: a reload, even with T3 gone, opens the application.
  await fixture.remoteAccess.t3Unavailable();
  await browser.reload();
  await expect(screen.getByRole("link", /^Settings/)).toBeVisible();
  await expect(screen.getByRole("heading", "Set up Factory")).toHaveCount(0);
});

test("with no installable harness on in T3, the install step asks to turn one on and offers no install", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openFreshSetup({ fixture, app, browser }, { harnessesOn: false });
  await screen.getByRole("button", "Connect").tap();
  await expect(screen.getByText("Approve Factory in your browser")).toBeVisible();

  // Act
  await fixture.remoteAccess.t3Approve();

  // Assert
  await expect(screen.getByRole("heading", "Install in your agents, current step")).toBeVisible({
    timeout: 8_000,
  });
  await expect(screen.getByText("Turn on a harness in T3")).toBeVisible();
  await expect(
    screen.getByText(
      "Claude, Codex, Cursor, and Grok are off in T3. Turn them on there to include them.",
    ),
  ).toBeVisible();
  await expect(screen.getByRole("button", /^Install in/)).toHaveCount(0);
  await expect(screen.getByRole("button", "Open Factory")).toHaveCount(0);
  await app.screenshot("first-run-setup-no-harness");
});
