import assert from "node:assert/strict";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";

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
