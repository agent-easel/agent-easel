import assert from "node:assert/strict";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Locator, type Screen } from "e2e";
import { copyAgentDefinition } from "./agents.ts";
import { saveFlowCopy } from "./flows.ts";

export type StudioFixtures = { app: App; screen: Screen; browser: Browser };

/** What `field`'s description reads: the text of each element its `aria-describedby` names. */
export async function descriptionOf(browser: Browser, field: Locator) {
  const ids = (await field.getAttribute("aria-describedby")) ?? "";
  return String(
    await browser.evaluate(
      `${JSON.stringify(ids)}.split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ")`,
    ),
  );
}

/**
 * Runs `observe` while every Trigger check the page sends is held, so a journey can watch a check
 * that is still running. The checks are released before this returns, also when `observe` throws:
 * the runner settles held requests before any teardown, so a later release would leave a failed
 * journey waiting for its cleanup budget instead of reporting the failure.
 */
export async function whileTriggerChecksHeld(browser: Browser, observe: () => Promise<void>) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await browser.route("**/api/triggers/*/run", async (route) => {
    await held;
    await route.continue();
  });
  try {
    await observe();
  } finally {
    release();
  }
}

export async function openStudioAgent({ app, screen }: StudioFixtures, name: string) {
  const agent = await copyAgentDefinition(app.baseUrl, "Sample worker", name);
  await app.open(`/studio/agents/${agent.id}`);
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(name);
  return agent;
}

/** A saved copy of Sample worker is open in Studio with an unsaved Prompt edit. */
export async function openEditedStudioAgent(fixtures: StudioFixtures, name: string) {
  const agent = await openStudioAgent(fixtures, name);
  await fixtures.screen.getByLabel("Prompt", { exact: true }).fill("Edited prompt");
  return agent;
}

/**
 * How long a held save waits at most. A journey that fails before its release cannot run cleanup
 * first: the runner settles route handlers before `afterEach` within the default 30 s cleanup
 * budget, so the hold ends on its own well inside that budget and past the journey's 5 s
 * assertions after Save.
 */
const saveHoldMs = 20_000;

/**
 * Starts the open Studio editor's Save while its request to `path` is held, and returns the release.
 * Something else, such as a removal elsewhere, can then reach the editor before the save replies.
 * The release fails the journey when the hold already ended on its own: the save may then have
 * replied before the journey's assertions, so they no longer prove the pending-save state.
 */
export async function startHeldSave(browser: Browser, screen: Screen, path: string) {
  let expired = false;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      expired = true;
      resolve();
    }, saveHoldMs);
    release = () => {
      assert.equal(expired, false, `the held save ended on its own after ${saveHoldMs} ms`);
      clearTimeout(timer);
      resolve();
    };
  });
  await browser.route(`**${path}`, async (route) => {
    if (route.request.method === "PUT") await held;
    return route.continue();
  });
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expect(screen.getByRole("button", "Saving…", { exact: true })).toBeVisible();
  return release;
}

/** The open Studio editor's Save has unsaved changes to send: enabled and filled. */
export async function expectSaveFilled(screen: Screen) {
  const save = screen.getByRole("button", "Save", { exact: true });
  await expect(save).toBeEnabled();
  await expect(save).toHaveAttribute("data-variant", "default");
}

/** The open Studio editor's Save has nothing to send: disabled and neutral. */
export async function expectSaveNeutral(screen: Screen) {
  const save = screen.getByRole("button", "Save", { exact: true });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute("data-variant", "outline");
}

/** A saved copy of a seeded Flow is open in Studio with no unsaved changes. */
export async function openStudioFlowCopy({ app, screen, browser }: StudioFixtures, name: string) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const id = await saveFlowCopy(app.baseUrl, "Demo · Grill, spec and tickets", name, {
    mode: "checkout",
  });
  await app.open(`/studio/flows/${id}`);
  await expect(screen.getByLabel("Flow name")).toHaveValue(name);
  return id;
}

/** A saved copy of a seeded Flow is open in Studio with an unsaved rename. */
export async function openEditedStudioFlow(fixtures: StudioFixtures, name: string) {
  const id = await openStudioFlowCopy(fixtures, name);
  await fixtures.screen.getByLabel("Flow name").fill(`${name} edited`);
  return id;
}

/** The Studio header breadcrumb's Flows link, which precedes the Studio navigation's own. */
export const flowsBreadcrumb = (screen: Screen) =>
  screen.getByRole("link", "Flows", { exact: true }).first();

/** Each editor's actions menu: the Agent editor's More actions, the Flow editor's More Flow actions. */
const actionsMenu = { Agent: "More actions", Flow: "More Flow actions" } as const;

/** Picks `item` from the Agent editor's More actions menu. */
export async function chooseAgentAction(screen: Screen, item: string) {
  await screen.getByRole("button", actionsMenu.Agent, { exact: true }).tap();
  await screen.getByRole("menuitem", item, { exact: true }).tap();
}

/** Picks `item` from the Flow editor's More Flow actions menu. */
export async function chooseFlowAction(screen: Screen, item: string) {
  await screen.getByRole("button", actionsMenu.Flow, { exact: true }).tap();
  await screen.getByRole("menuitem", item, { exact: true }).tap();
}

/**
 * The live readiness summary at the canvas's top left: the Ready badge, or the Not ready button
 * whose name, such as "Not ready 2 issues", matches `readiness`.
 */
export const readinessSummary = (screen: Screen, readiness: "Ready" | RegExp) =>
  readiness === "Ready"
    ? screen.getByText("Ready", { exact: true })
    : screen.getByRole("button", readiness);

/** The open Flow has no unsaved changes: its save status reads Saved and Save is disabled. */
export async function expectFlowSaved(screen: Screen) {
  await expect(screen.getByRole("status", "Flow save status")).toHaveText("Saved");
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
}

/** Saves the open Flow and expects its readiness summary, Ready or Not ready. */
export async function saveFlowWithReadiness(screen: Screen, readiness: "Ready" | RegExp) {
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectFlowSaved(screen);
  await expect(readinessSummary(screen, readiness)).toBeVisible();
}

/** The Agent editor's status line names the saved revision `revision` with no unsaved changes. */
export async function expectSavedAgentRevision(screen: Screen, revision: number) {
  await expect(screen.getByText(new RegExp(`^Saved · Revision ${revision} · `))).toBeVisible();
}

/**
 * Known removal leaves recovery available while refusing definition commands: each of `actions`
 * is a disabled button, and each of `menuItems` a disabled item of the editor's actions menu that
 * says why.
 */
export async function expectRetainedDefinition(
  screen: Screen,
  kind: "Agent" | "Flow",
  actions: readonly string[],
  menuItems: readonly string[] = [],
) {
  await expect(
    screen.getByText(`This ${kind} was removed elsewhere`, { exact: true }),
  ).toBeVisible();
  for (const name of actions)
    await expect(screen.getByRole("button", name, { exact: true })).toBeDisabled();
  if (menuItems.length === 0) return;
  await screen.getByRole("button", actionsMenu[kind], { exact: true }).tap();
  for (const name of menuItems) {
    const item = screen.getByRole("menuitem", name, { exact: true });
    await expect(item).toBeDisabled();
    await expect(item).toContainText(`This ${kind} was removed elsewhere.`);
  }
  await screen.getByRole("menu").press("Escape");
}

/** A removed Agent exit leaves its existing wire visible as a broken connection. */
export async function expectBrokenAgentWire(screen: Screen, exitId: string) {
  // The removed exit's struck-through row names why for screen readers.
  await expect(
    screen.getByRole("region", "Flow canvas").getByText("removed", { exact: true }),
  ).toHaveCount(1);
  await expect(
    screen.getByRole("button", `Connection ${exitId} from Worker to Review`, { exact: true }),
  ).toBeVisible();
}
