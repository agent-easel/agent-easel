import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import { copyAgentDefinition } from "./agents.ts";
import { saveFlowCopy } from "./flows.ts";

export type StudioFixtures = { app: App; screen: Screen; browser: Browser };

export async function openStudioAgent({ app, screen }: StudioFixtures, name: string) {
  const agent = await copyAgentDefinition(app.baseUrl, "Sample worker", name);
  await app.open(`/studio/agents/${agent.id}`);
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(name);
  return agent;
}

/** A saved copy of a seeded Flow is open in Studio with an unsaved rename. */
export async function openEditedStudioFlow({ app, screen, browser }: StudioFixtures, name: string) {
  await browser.setViewport({ width: 1600, height: 1000 });
  const id = await saveFlowCopy(app.baseUrl, "Demo · Grill, spec and tickets", name, {
    mode: "checkout",
  });
  await app.open(`/studio/flows/${id}`);
  await screen.getByLabel("Flow name").fill(`${name} edited`);
  return id;
}

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

/** The Agent editor's status line names the saved revision `revision` with no unsaved changes. */
export async function expectSavedAgentRevision(screen: Screen, revision: number) {
  await expect(screen.getByText(new RegExp(`^Saved · rev ${revision} · `))).toBeVisible();
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
    screen.getByText(`This ${kind} was removed elsewhere. Your draft is kept.`, { exact: true }),
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
  await expect(
    screen.getByRole("region", "Flow canvas").getByText("Agent · removed", { exact: true }),
  ).toBeVisible();
  await expect(
    screen.getByRole("button", `Connection ${exitId} from Worker to Review`, { exact: true }),
  ).toBeVisible();
}
