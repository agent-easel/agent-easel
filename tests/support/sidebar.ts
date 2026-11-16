import { expect, type TestFixtures } from "e2e";
import type { Browser } from "@e2e-dev/web";
import assert from "node:assert/strict";
import {
  mattersNeedingOwner,
  type Result,
  type RunNavigationEntry,
} from "../../packages/contracts/src/index.ts";
import type { DesktopRoute } from "../../packages/contracts/src/desktop-bridge.ts";
import { desktopBridgeOptions, desktopBridgeScript } from "./desktop-bridge.ts";

async function navigation(baseUrl: string | undefined) {
  const response = await fetch(new URL("/api/run-navigation", baseUrl));
  const result = (await response.json()) as Result<readonly RunNavigationEntry[]>;
  assert(result.ok);
  return result.value;
}

async function changePresentation(
  baseUrl: string | undefined,
  id: string,
  action: "restore" | "snooze",
) {
  const response = await fetch(new URL(`/api/runs/${id}/${action}`, baseUrl), {
    method: "POST",
    headers: { "X-Factory-Request": "1" },
  });
  const result = (await response.json()) as Result<unknown>;
  assert(result.ok);
}

/** Remove state left by earlier journeys and establish the named Run's presentation. */
async function prepareSidebarRun(
  baseUrl: string | undefined,
  title: string,
  action: "restore" | "snooze",
) {
  const runs = await navigation(baseUrl);
  for (const run of runs.filter((entry) => entry.presentation.snoozed && entry.title !== title)) {
    await changePresentation(baseUrl, run.id, "restore");
  }
  const run = runs.find((entry) => entry.title === title);
  assert(run);
  await changePresentation(baseUrl, run.id, action);
}

/** Navigation's public order is the expected Run order when search merges in a newer draft. */
export async function matchingSidebarTitles(baseUrl: string | undefined, query: string) {
  return (await navigation(baseUrl))
    .filter((run) => run.title.includes(query))
    .map((run) => run.title);
}

type SidebarFixtures = Pick<TestFixtures, "app" | "screen"> & { browser: Browser };

export async function openSidebarAction(
  { app, screen, browser }: SidebarFixtures,
  title: string,
  presentation: "snooze" | "restore",
  searching = false,
) {
  await prepareSidebarRun(app.baseUrl, title, presentation);
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open("/runs/new");
  const toggle = screen.getByRole("button", /^Snoozed 1$/);
  if (searching) await screen.getByRole("textbox", "Search Run titles").fill("Navigation research");
  else await toggle.tap();
  const actions = screen.getByRole("link").filter({ hasText: title });
  await actions.secondaryTap();
  return { toggle, actions };
}

export async function prepareSidebarPreview(
  { app, screen, browser }: SidebarFixtures,
  title: string,
  opened = false,
) {
  await browser.setViewport({ width: 1440, height: 1100 });
  await browser.emulateMedia({ reducedMotion: "reduce" });
  await app.open("/runs/new");
  const row = screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link")
    .filter({ hasText: title });
  const preview = browser.locator('[data-slot="tooltip-content"]');
  if (opened) {
    await row.hover();
    await expect(preview).toBeVisible();
  }
  return { row, preview };
}

export async function expectFlatSearch(screen: TestFixtures["screen"]) {
  await expect(screen.getByRole("button", /^Snoozed \d+$/)).toBeHidden();
  await expect(screen.getByRole("button", /^Settled \d+$/)).toBeHidden();
}

/** The Runs every desktop installation's Dock badge counts, in the Run list's creation order. */
export async function badgeRunTitles(baseUrl: string | undefined) {
  return (await navigation(baseUrl))
    .filter((run) => mattersNeedingOwner(run).length > 0)
    .map((run) => run.title);
}

/** Opens the New Run view in the desktop UI through the stand-in bridge, which can route the window. */
export async function openDesktopWindow({ app, screen, browser }: SidebarFixtures) {
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("server"));
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open("/runs/new");
  await expect(screen.getByRole("navigation", "Open Runs")).toBeVisible();
}

/** Stands in for the main process routing the window after a notification or Dock click. */
export async function routeWindow(browser: Browser, route: DesktopRoute) {
  await browser.evaluate(`window.__route(${JSON.stringify(route)})`);
}
