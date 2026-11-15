import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import { copyAgentDefinition } from "./agents.ts";

export type StudioFixtures = { app: App; screen: Screen; browser: Browser };

export async function openStudioAgent({ app, screen }: StudioFixtures, name: string) {
  const agent = await copyAgentDefinition(app.baseUrl, "Sample worker", name);
  await app.open(`/studio/agents/${agent.id}`);
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(name);
  return agent;
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
