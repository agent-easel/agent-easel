import { test } from "./support/test.ts";
import type { Fixture } from "./support/fixture/handle.ts";
import { expect, type Screen } from "e2e";
import { desktopBridgeOptions, desktopBridgeScript } from "./support/desktop-bridge.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";

const sections = (screen: Screen) => screen.getByRole("navigation", "Settings sections");

test("the desktop host lists every Settings section under Factory, Chat control, Runs and This device", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("server"));

  // Act
  await app.open("/settings/connection");

  // Assert
  const factory = sections(screen).getByRole("group", "Factory");
  await expect(factory.getByRole("link", /^T3 connection, /)).toBeVisible();
  await expect(factory.getByRole("link", /^Agent reporting/)).toBeVisible();
  await expect(factory.getByRole("link", /^Devices & access/)).toBeVisible();
  const chat = sections(screen).getByRole("group", "Chat control");
  await expect(chat.getByRole("link", /^Language model/)).toBeVisible();
  await expect(chat.getByRole("link", /^Discord/)).toBeVisible();
  const runs = sections(screen).getByRole("group", "Runs");
  await expect(runs.getByRole("link", "Run titles", { exact: true })).toBeVisible();
  await expect(runs.getByRole("link", "Run images", { exact: true })).toBeVisible();
  const device = sections(screen).getByRole("group", "This device");
  await expect(device.getByRole("link", "Appearance", { exact: true })).toBeVisible();
  await expect(device.getByRole("link", "Keyboard shortcuts", { exact: true })).toBeVisible();
  await expect(device.getByRole("link", "Desktop app", { exact: true })).toBeVisible();
  await app.screenshot("settings-navigation-desktop-host");
});

test("a browser on the Factory host lists no Desktop app section", async ({ app, screen }) => {
  // Act
  await app.open("/settings/connection");

  // Assert
  await expect(sections(screen).getByRole("link", /^Devices & access/)).toBeVisible();
  await expect(sections(screen).getByRole("link", "Appearance")).toBeVisible();
  await expect(sections(screen).getByRole("link", "Desktop app")).toHaveCount(0);
});

test("a remote client lists neither Devices & access nor Desktop app and locks Run titles", async ({
  app,
  screen,
}) => {
  // Arrange
  await openRemoteBrowser(app);

  // Act
  await openApproved(app, "/settings/connection");

  // Assert
  await expect(
    sections(screen).getByRole("link", "Run titles, Managed on the Factory host", { exact: true }),
  ).toBeVisible();
  await expect(sections(screen).getByRole("link", "Appearance")).toBeVisible();
  await expect(sections(screen).getByRole("link", /^Devices & access/)).toHaveCount(0);
  await expect(sections(screen).getByRole("link", "Desktop app")).toHaveCount(0);
  await app.screenshot("settings-navigation-remote-client");
});

test("a removed Settings path opens the default T3 connection section", async ({ app, screen }) => {
  // Act
  await app.open("/settings/application");

  // Assert
  await expect(sections(screen).getByRole("link", /^T3 connection, /)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(screen.getByRole("heading", "Application")).toHaveCount(0);
});

test("Esc with a filled Settings search clears it and keeps Settings open", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/settings/connection");
  await screen.getByLabel("Search settings").fill("RUN");
  await expect(sections(screen).getByRole("link", "Run titles")).toBeVisible();
  await expect(sections(screen).getByRole("link", "Appearance")).toHaveCount(0);
  // Focus leaves the field; the filled search still takes the first Esc.
  await sections(screen).getByRole("link", "Run titles").focus();

  // Act
  await browser.keyboard.press("Escape");

  // Assert
  await expect(screen.getByLabel("Search settings")).toHaveValue("");
  await expect(sections(screen).getByRole("link", "Appearance")).toBeVisible();
  await expect(screen.getByRole("dialog", "Settings", { exact: true })).toBeVisible();
});

test("searching for notifications finds Desktop app and keeps the open page", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("server"));
  await app.open("/settings/connection");

  // Act
  await screen.getByLabel("Search settings").fill("notifications");

  // Assert
  await expect(sections(screen).getByRole("link", "Desktop app", { exact: true })).toBeVisible();
  await expect(sections(screen).getByRole("group", "Factory", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("heading", "T3 connection", { exact: true })).toBeVisible();
  await app.screenshot("settings-search-notifications");
});

// The shared focus ring is 3 px of `--ring` at half opacity.
const focusShadow = `getComputedStyle(document.activeElement).boxShadow`;
const noShadow = "rgba(0, 0, 0, 0) 0px 0px 0px 0px";
const focusRings = [
  { mode: "Dark", ring: "oklab(0.680099 0.0191423 -0.157128 / 0.5) 0px 0px 0px 3px" },
  { mode: "Light", ring: "oklab(0.585387 0.0253055 -0.202469 / 0.5) 0px 0px 0px 3px" },
] as const;

for (const { mode, ring } of focusRings)
  test(`a keyboard-focused button and navigation row show the same focus ring in ${mode}`, async ({
    app,
    screen,
    browser,
  }) => {
    // Arrange
    await app.open("/settings/appearance");
    await screen.getByRole("radio", mode, { exact: true }).tap();
    await app.open("/settings/connection");
    const shadow = [noShadow, noShadow, noShadow, ring, noShadow].join(", ");
    const connection = sections(screen).getByRole("link", /^T3 connection, /);
    await screen.getByLabel("Search settings", { exact: true }).focus();

    // Act
    await browser.keyboard.press("Tab");

    // Assert
    await expect(connection).toBeFocused();
    await expect.poll(() => browser.evaluate(focusShadow)).toBe(shadow);
    await app.screenshot(`navrow-focus-${mode.toLowerCase()}`);

    // Arrange
    const edit = screen.getByRole("button", "Edit address", { exact: true });
    await expect(edit).toBeEnabled();
    await edit.focus();
    await browser.keyboard.press("Shift+Tab");

    // Act
    await browser.keyboard.press("Tab");

    // Assert
    await expect(edit).toBeFocused();
    await expect.poll(() => browser.evaluate(focusShadow)).toBe(shadow);
    await app.screenshot(`button-focus-${mode.toLowerCase()}`);
  });

test("a not-allowed T3 address names the card that explains it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/settings/connection");
  await screen.getByRole("button", "Edit address", { exact: true }).tap();

  // Act
  await screen.getByLabel("Address", { exact: true }).fill("ftp://t3.example/mcp");

  // Assert
  const address = screen.getByLabel("Address", { exact: true });
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(address).toHaveAttribute("aria-describedby", "connection-address-problem");
  await expect
    .poll(() =>
      browser.evaluate(
        `(() => { const card = document.getElementById("connection-address-problem"); return card ? card.getAttribute("role") + " " + card.textContent : null; })()`,
      ),
    )
    .toContain("alert Use HTTPS, or HTTP on this computer");
});

test("searching for a visible row label such as Mode finds Appearance", async ({ app, screen }) => {
  // Arrange
  await app.open("/settings/connection");

  // Act
  await screen.getByLabel("Search settings").fill("mode");

  // Assert
  await expect(sections(screen).getByRole("link", "Appearance", { exact: true })).toBeVisible();
  await expect(sections(screen).getByRole("link", "T3 connection", { exact: true })).toHaveCount(0);
});

test("searching for a Worker option or a fixed shortcut finds its section", async ({
  app,
  screen,
}) => {
  // Arrange
  await app.open("/settings/connection");
  const search = screen.getByLabel("Search settings");

  // Act: a Run titles Worker option from T3's capabilities
  await search.fill("fast mode");

  // Assert
  await expect(sections(screen).getByRole("link", "Run titles", { exact: true })).toBeVisible();

  // Act: a fixed Keyboard shortcuts row
  await search.fill("undo flow edit");

  // Assert
  await expect(
    sections(screen).getByRole("link", "Keyboard shortcuts", { exact: true }),
  ).toBeVisible();
  await expect(sections(screen).getByRole("link", "Run titles", { exact: true })).toHaveCount(0);
});

/**
 * Opens T3 connection Settings with T3 away and searches `query`, so the search has no Worker
 * options from T3 to match yet. Returns the search field.
 */
async function searchWhileT3Away(
  fixture: Fixture,
  app: { open(path: string): Promise<unknown> },
  screen: Screen,
  query: string,
) {
  await app.open("/settings/connection");
  await fixture.remoteAccess.t3Unavailable();
  const search = screen.getByLabel("Search settings");
  await search.fill(query);
  return search;
}

/** The Run titles row of the Settings navigation. */
const runTitlesRow = (screen: Screen) =>
  sections(screen).getByRole("link", "Run titles", { exact: true });

/** T3 returns; the open T3 connection page shows it even when the search hides that nav row. */
async function reconnectT3(fixture: Fixture, screen: Screen) {
  await fixture.remoteAccess.t3Available();
  await expect(screen.getByText("Connected", { exact: true })).toBeVisible();
}

test("a Worker option search started after T3 reconnects finds Run titles", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange: a search while T3 is away, cleared before T3 returns.
  const search = await searchWhileT3Away(fixture, app, screen, "fast mode");
  await search.fill("");
  await reconnectT3(fixture, screen);

  // Act
  await search.fill("fast mode");

  // Assert
  await expect(runTitlesRow(screen)).toBeVisible();
});

test("a search kept open while T3 reconnects finds a Worker option after the query is replaced", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange: "run" stays filled through the reconnect.
  const search = await searchWhileT3Away(fixture, app, screen, "run");
  await reconnectT3(fixture, screen);

  // Act: replace the filled query directly, without clearing it first.
  await search.fill("fast mode");

  // Assert
  await expect(runTitlesRow(screen)).toBeVisible();
});
