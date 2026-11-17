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

/** Known removal leaves recovery available while refusing definition commands. */
export async function expectRetainedDefinition(
  screen: Screen,
  kind: "Agent" | "Flow",
  actions: readonly string[],
) {
  await expect(
    screen.getByText(`This ${kind} was removed elsewhere. Your draft is kept.`, { exact: true }),
  ).toBeVisible();
  for (const name of actions)
    await expect(screen.getByRole("button", name, { exact: true })).toBeDisabled();
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
