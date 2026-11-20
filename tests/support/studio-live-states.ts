import assert from "node:assert/strict";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import type { AgentDefinition, FlowDraft, Result } from "../../packages/contracts/src/index.ts";
import { copyAgentDefinition, saveAgentElsewhere } from "./agents.ts";
import { readFlow, saveFlowElsewhere, saveSingleAgentFlow } from "./flows.ts";
import { browserRequests } from "./live.ts";
import { openApproved, openRemoteBrowser } from "./remote-access.ts";
import { readinessSummary } from "./studio.ts";
import type { StudioFixtures } from "./studio.ts";

const block = { id: "worker", name: "Worker", x: 320, y: 120 };

export const newStudioAgent = (app: App) =>
  copyAgentDefinition(app.baseUrl, "Sample worker", `Live worker ${crypto.randomUUID()}`);

export async function newStudioFlow(app: App, agent: AgentDefinition) {
  const id = await saveSingleAgentFlow(
    app.baseUrl,
    `Live Flow ${crypto.randomUUID()}`,
    agent.name,
    block,
    agent.exits[0]!.id,
  );
  return readFlow(app.baseUrl, id);
}

export async function openApprovedStudio({ app, browser }: StudioFixtures, path: string) {
  await browser.setViewport({ width: 1920, height: 1000 });
  await openRemoteBrowser(app);
  await openApproved(app, `/studio/${path}`);
}

export async function openLiveFlow(fixtures: StudioFixtures) {
  const agent = await newStudioAgent(fixtures.app);
  const flow = await newStudioFlow(fixtures.app, agent);
  await openApprovedStudio(fixtures, `flows/${flow.id}`);
  await expect(readinessSummary(fixtures.screen, "Ready")).toBeVisible();
  return { agent, flow };
}

export async function flowCount(app: App) {
  const result = (await (await fetch(new URL("/api/flows", app.baseUrl))).json()) as Result<
    FlowDraft[]
  >;
  assert(result.ok);
  return result.value.length;
}

export async function expectNoStudioListReads(app: App) {
  expect(
    (await browserRequests(app)).filter((request) => /^GET \/api\/(flows|agents)$/.test(request)),
  ).toEqual([]);
}

export async function moveStudioViewport({ screen, browser }: StudioFixtures) {
  const canvas = screen.getByRole("region", "Flow canvas");
  await screen.getByRole("button", "Zoom in", { exact: true }).tap();
  await canvas.press("ArrowRight");
  const layer = browser.locator('[aria-label="Flow canvas"] > div[style]');
  const view = (await layer.getAttribute("style"))!.split(";")[0]!;
  const zoom = (await canvas.getAttribute("data-zoom"))!;
  return { canvas, layer, view, zoom };
}

export async function openLiveFlowWithMovedViewport(fixtures: StudioFixtures) {
  const { flow } = await openLiveFlow(fixtures);
  const viewport = await moveStudioViewport(fixtures);
  return { flow, viewport };
}

export async function expectStudioViewport({
  canvas,
  layer,
  view,
  zoom,
}: Awaited<ReturnType<typeof moveStudioViewport>>) {
  expect(await layer.getAttribute("style")).toContain(view);
  await expect(canvas).toHaveAttribute("data-zoom", zoom);
}

async function compareStudioRevision(screen: Screen, revision: number) {
  await screen.getByRole("button", "Compare latest revision", { exact: true }).tap();
  await expect(screen.getByRole("dialog", `Compare with revision ${revision}`)).toBeVisible();
}

export async function openComparedFlow(fixtures: StudioFixtures, draftName: string) {
  const { app, screen } = fixtures;
  const { flow } = await openLiveFlow(fixtures);
  await screen.getByLabel("Flow name").fill(draftName);
  const previous = await saveFlowElsewhere(app.baseUrl, flow, { name: "External Flow revision" });
  await compareStudioRevision(screen, previous.revision);
  return { flow, previous };
}

export async function openComparedAgent(fixtures: StudioFixtures, draftPrompt: string) {
  const { app, screen } = fixtures;
  const agent = await newStudioAgent(app);
  await openApprovedStudio(fixtures, `agents/${agent.id}`);
  await screen.getByLabel("Prompt", { exact: true }).fill(draftPrompt);
  const previous = await saveAgentElsewhere(app.baseUrl, agent, {
    prompt: "External Agent revision",
  });
  await compareStudioRevision(screen, previous.revision);
  return { agent, previous };
}

export async function readRecoveredDefinition(screen: Screen, browser: Browser): Promise<unknown> {
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();
  await expect(screen.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  return browser.evaluate("navigator.clipboard.readText().then(JSON.parse)");
}

export function renameCanvasAgent(app: App, agent: AgentDefinition, name: string) {
  assert(agent.execution, "The canvas Agent has a model");
  return saveAgentElsewhere(app.baseUrl, agent, {
    name,
    execution: { ...agent.execution, modelId: "acceptance-unavailable-model" },
    exits: [{ ...agent.exits[0]!, name: "delivered" }, ...agent.exits.slice(1)],
  });
}

export const handoffExit = {
  id: "handoff",
  name: "handoff",
  description: "",
  messageRequired: false,
};
