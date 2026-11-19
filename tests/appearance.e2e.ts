import { test } from "./support/test.ts";
import { expect } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { desktopBridgeOptions, desktopBridgeScript } from "./support/desktop-bridge.ts";
import {
  openApproved,
  openIncompatibleApplicationSettings,
  openRemoteBrowser,
} from "./support/remote-access.ts";

const settingsPath = "/settings/appearance";

const modes = {
  light: { label: "Light", theme: "#ffffff", canvas: "rgb(255, 255, 255)" },
  dark: { label: "Dark", theme: "#09090b", canvas: "rgb(9, 9, 11)" },
} as const;

const renderedColors = () => [
  getComputedStyle(document.body).backgroundColor,
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.content.replace(/^#fff$/, "#ffffff") ?? null,
];

async function expectColors(browser: Browser, mode: keyof typeof modes) {
  const { theme, canvas } = modes[mode];
  await expect.poll(() => browser.evaluate(renderedColors)).toEqual([canvas, theme]);
}

async function recordFirstRender(browser: Browser) {
  // Capture the document when parsing reaches <body>, before any module script runs.
  await browser.addInitScript(() => {
    const record = new MutationObserver(() => {
      if (!document.body) return;
      sessionStorage.setItem("appearanceAtBody", document.documentElement.dataset.appearance!);
      sessionStorage.setItem(
        "themeColorAtBody",
        document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content,
      );
      record.disconnect();
    });
    record.observe(document, { childList: true, subtree: true });
  });
}

async function expectFirstRender(browser: Browser, mode: keyof typeof modes) {
  expect(await browser.evaluate(() => sessionStorage.getItem("appearanceAtBody"))).toBe(mode);
  expect(await browser.evaluate(() => sessionStorage.getItem("themeColorAtBody"))).toBe(
    modes[mode].theme,
  );
}

async function waitForSettingsDialog(browser: Browser) {
  await expect
    .poll(() =>
      browser.evaluate(`getComputedStyle(document.querySelector('[role="dialog"]')).opacity`),
    )
    .toBe("1");
}

for (const mode of ["light", "dark"] as const) {
  test(`a fresh profile first renders in System ${mode}`, async ({ app, screen, browser }) => {
    // Arrange
    await browser.emulateMedia({ colorScheme: mode });
    await recordFirstRender(browser);

    // Act
    await app.open(settingsPath);

    // Assert
    await expectFirstRender(browser, mode);
    await expect(screen.getByRole("radio", "System")).toBeChecked();
    await expectColors(browser, mode);
    await waitForSettingsDialog(browser);
    await app.screenshot(`appearance-system-${mode}`);
  });
}

for (const { mode, opposite } of [
  { mode: "light", opposite: "dark" },
  { mode: "dark", opposite: "light" },
] as const) {
  const { label } = modes[mode];

  test(`a browser profile's ${label} choice survives reload and is applied before the app renders`, async ({
    app,
    screen,
    browser,
  }) => {
    // Arrange
    await browser.emulateMedia({ colorScheme: opposite });
    await recordFirstRender(browser);
    await app.open(settingsPath);
    await expectColors(browser, opposite);
    await screen.getByRole("radio", label).tap();

    // Act
    await browser.reload();

    // Assert
    await expect(screen.getByRole("radio", label)).toBeChecked();
    await expectFirstRender(browser, mode);
    await expectColors(browser, mode);
    await waitForSettingsDialog(browser);
    await app.screenshot(`appearance-${mode}-after-reload`);
  });

  test(`a profile already storing ${label} keeps its override when the system changes`, async ({
    app,
    screen,
    browser,
  }) => {
    // Arrange
    await browser.emulateMedia({ colorScheme: mode });
    await browser.addInitScript((saved) => localStorage.setItem("factory.appearance", saved), mode);
    await app.open(settingsPath);
    await expect(screen.getByRole("radio", label)).toBeChecked();

    // Act
    await browser.emulateMedia({ colorScheme: opposite });

    // Assert: media changes are delivered before the frame callback.
    await browser.evaluate(
      () =>
        new Promise<null>((resolve) => {
          requestAnimationFrame(() => resolve(null));
        }),
    );
    await expectColors(browser, mode);
    await expect(screen.getByRole("radio", label)).toBeChecked();
  });
}

test("System applies the current scheme, follows both live changes, and survives reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "light" });
  await app.open(settingsPath);
  await screen.getByRole("radio", "Dark").tap();
  await expectColors(browser, "dark");

  // Act
  await screen.getByRole("radio", "System").tap();

  // Assert
  await expectColors(browser, "light");
  await browser.emulateMedia({ colorScheme: "dark" });
  await expectColors(browser, "dark");
  await browser.emulateMedia({ colorScheme: "light" });
  await expectColors(browser, "light");
  await browser.reload();
  await expect(screen.getByRole("radio", "System")).toBeChecked();
  await expectColors(browser, "light");
});

test("an unrecognized saved appearance follows the system scheme", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "light" });
  await browser.addInitScript(() => localStorage.setItem("factory.appearance", "unknown"));

  // Act
  await app.open(settingsPath);

  // Assert
  await expect(screen.getByRole("radio", "System")).toBeChecked();
  await expectColors(browser, "light");
});

test("another tab of the same profile follows changes to Light, Dark, and System", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "light" });
  await app.open(settingsPath);
  expect(
    await browser.evaluate((path) => {
      const tab = window.open(path, "appearance-mirror");
      Object.defineProperty(window, "__appearanceMirror", { value: tab });
      return tab !== null;
    }, settingsPath),
  ).toBe(true);
  const mirroredChoice = () =>
    browser.evaluate(() => {
      const tab = (window as Window & { __appearanceMirror?: Window }).__appearanceMirror;
      return [
        tab?.document.querySelector('[role="radio"][aria-checked="true"]')?.textContent ?? null,
        tab?.document.documentElement?.dataset.appearance ?? null,
      ];
    });
  await expect.poll(mirroredChoice).toEqual(["System", "light"]);

  // Act and assert each preference change reaches the existing tab.
  await screen.getByRole("radio", "Light").tap();
  await expect.poll(mirroredChoice).toEqual(["Light", "light"]);
  await screen.getByRole("radio", "Dark").tap();
  await expect.poll(mirroredChoice).toEqual(["Dark", "dark"]);
  await screen.getByRole("radio", "System").tap();
  await expect.poll(mirroredChoice).toEqual(["System", "light"]);
});

test("an offline client switches to System and follows the device without its server", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "light" });
  await openRemoteBrowser(app);
  await openApproved(app, "/runs/new");
  const settings = screen.getByRole("link", /^Settings,/);
  await expect(settings).toBeVisible();
  // Offline retains a view only after the client has completed its first handshake.
  await expect(screen.getByRole("button", "New Run (+)")).toBeEnabled();
  await settings.tap();
  await screen.getByRole("link", "Appearance", { exact: true }).tap();
  await screen.getByRole("radio", "Dark").tap();
  await fixture.remoteAccess.offline();
  // The Settings dialog hides the banner from the accessibility tree.
  await expect
    .poll(() => browser.evaluate(() => !!document.querySelector('[aria-label="Offline"]')))
    .toBe(true);

  // Act
  await screen.getByRole("radio", "System").tap();

  // Assert
  await expectColors(browser, "light");
  await waitForSettingsDialog(browser);
  await app.screenshot("appearance-offline-light");
  await browser.emulateMedia({ colorScheme: "dark" });
  await expectColors(browser, "dark");
  await expect(screen.getByRole("radio", "System")).toBeChecked();
});

test("an incompatible server's gate offers System in local application settings", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "light" });
  await openRemoteBrowser(app);
  await openIncompatibleApplicationSettings(app, screen);
  await screen.getByRole("radio", "Dark").tap();

  // Act
  await screen.getByRole("radio", "System").tap();

  // Assert
  await expectColors(browser, "light");
  await expect(screen.getByRole("radio", "System")).toBeChecked();
  await expect(screen.getByRole("dialog", "Local application settings")).toBeVisible();
  await waitForSettingsDialog(browser);
  await app.screenshot("appearance-gate-light");
  await browser.emulateMedia({ colorScheme: "dark" });
  await expectColors(browser, "dark");
});

test("a browser that blocks saving names System and keeps the tab following its device", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.emulateMedia({ colorScheme: "light" });
  await browser.addInitScript(() => {
    localStorage.setItem("factory.appearance", "dark");
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage is unavailable", "QuotaExceededError");
    };
  });
  await app.open(settingsPath);

  // Act
  await screen.getByRole("radio", "System").tap();

  // Assert
  await expect(screen.getByRole("alert").getByText("Couldn’t save System")).toBeVisible();
  await expect(screen.getByRole("radio", "System")).toBeChecked();
  await expectColors(browser, "light");
  await browser.emulateMedia({ colorScheme: "dark" });
  await expectColors(browser, "dark");
});

test("the desktop renderer restores the document's preference when saving System fails", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange: serve an installation preference distinct from the system and browser storage.
  await browser.emulateMedia({ colorScheme: "dark" });
  await browser.addInitScript(desktopBridgeScript, {
    ...desktopBridgeOptions("server"),
    rejectAppearanceSave: true,
  });
  await browser.addInitScript(() => localStorage.setItem("factory.appearance", "dark"));
  await recordFirstRender(browser);
  await browser.route("**/settings/appearance", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      status: response.status,
      contentType: "text/html",
      body: html.replace(
        'data-appearance-preference="system"',
        'data-appearance-preference="light"',
      ),
    });
  });
  await app.open(settingsPath);
  await expectFirstRender(browser, "light");
  await expect(screen.getByRole("radio", "Light")).toBeChecked();

  // Act
  await screen.getByRole("radio", "System").tap();

  // Assert
  const failure = screen.getByRole("alert");
  await expect(failure.getByText("Couldn’t switch to System")).toBeVisible();
  await failure.getByRole("button", "Technical details").tap();
  await expect(failure.getByText("The desktop fixture refused to save system.")).toBeVisible();
  await expect(screen.getByRole("radio", "Light")).toBeChecked();
  await expectColors(browser, "light");
});
