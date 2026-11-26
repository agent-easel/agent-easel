import assert from "node:assert/strict";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";

import type { Fixture } from "./fixture/handle.ts";

export async function openFirstRunWithFailedInstall(fixture: Fixture, app: App, screen: Screen) {
  await fixture.firstRunSetup.fresh();
  await fixture.firstRunSetup.codexInstallBlocked();
  await fixture.firstRunSetup.hostConnects();
  await app.open("/runs/new");
  await screen.getByRole("button", /^Install in/).tap();
  await expect(screen.getByText("Couldn’t install for Codex")).toBeVisible();
}

export async function openFirstRunWithoutHarnesses(fixture: Fixture, app: App, screen: Screen) {
  await fixture.firstRunSetup.fresh({ harnessesOn: false });
  await fixture.firstRunSetup.hostConnects();
  await app.open("/runs/new");
  await expect(screen.getByText("Turn on a harness in T3 Code")).toBeVisible({ timeout: 8000 });
}

export async function expectDialogSettled(browser: Browser) {
  await expect
    .poll(() =>
      browser.evaluate(
        `getComputedStyle([...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].at(-1)).opacity`,
      ),
    )
    .toBe("1");
}

export async function exportedLog(app: App) {
  const response = await fetch(new URL("/api/settings/diagnostics/export", app.baseUrl));
  assert.equal(response.status, 200);
  return await response.text();
}

export async function openInstallViewer(
  { app, screen, browser }: { app: App; screen: Screen; browser: Browser },
  screenshot: string,
) {
  await screen.getByRole("button", "View diagnostic log").tap();
  const viewer = screen.getByRole("dialog", "Diagnostic log");
  await expect(viewer.getByRole("region", /^Install in Codex at /)).toBeVisible();
  await expectDialogSettled(browser);
  await app.screenshot(screenshot);
  return viewer;
}
