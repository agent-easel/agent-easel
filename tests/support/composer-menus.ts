import assert from "node:assert/strict";
import type { Browser } from "@e2e-dev/web";
import type { Result } from "../../packages/contracts/src/index.ts";
import { expect, type App, type Screen } from "e2e";

/** Opens the composer at 1440×900 with no remembered Project, Flow, or draft. */
export async function openComposerMenus(app: App, browser: Browser, screen: Screen) {
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open("/runs/new");
  await browser.evaluate(`(() => {
    localStorage.removeItem("factory-last-project:browser");
    localStorage.removeItem("factory-last-flow:browser");
    localStorage.removeItem("factory-run-drafts:browser");
  })()`);
  await browser.reload();
  await expect(screen.getByRole("combobox", /^Select Flow: /)).toBeVisible();
}

export async function readFactoryJson<T>(baseUrl: string | undefined, path: string) {
  const response = await fetch(new URL(path, baseUrl));
  const body = (await response.json()) as Result<T>;
  assert(body.ok, JSON.stringify(body));
  return body.value;
}

/** The open Flow list, named like its field. */
export const flowList = (screen: Screen) => screen.getByRole("listbox", "Flow", { exact: true });

export async function openFlowMenu(screen: Screen) {
  await screen.getByRole("combobox", /^Select Flow: /).tap();
  await expect(flowList(screen)).toBeVisible();
}

/** Chooses a ready Flow. The list closes and the field shows that Flow. */
export async function chooseComposerFlow(screen: Screen, name: string) {
  await openFlowMenu(screen);
  await screen.getByRole("option", name, { exact: true }).tap();
  await expect(flowList(screen)).toBeHidden();
  await expect(screen.getByRole("combobox", `Select Flow: ${name}`, { exact: true })).toBeVisible();
}

/** A page evaluation's string result. Page values are JSON, so this rejects anything else. */
export function pageString(value: unknown): string {
  if (typeof value !== "string")
    throw new Error(`Expected a string from the page, got ${typeof value}`);
  return value;
}
