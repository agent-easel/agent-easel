import assert from "node:assert/strict";
import type { StudioFixtures } from "./studio.ts";
import { expect } from "e2e";
import {
  copyAgentDefinition,
  listAgentDefinitions,
  readAgentDefinition,
  saveAgentElsewhere,
  removeAgentElsewhere,
  updateAgentExits,
} from "./agents.ts";
import { saveSingleAgentFlow, readFlow, saveFlowElsewhere, removeFlowElsewhere } from "./flows.ts";
import { browserRequests, resetBrowserRequests, delayLiveSnapshots } from "./live.ts";
import { expectRetainedDefinition, expectBrokenAgentWire } from "./studio.ts";
import { fixtureHandles } from "./fixture/handle.ts";
import { openApproved, openRemoteBrowser } from "./remote-access.ts";
const block = { id: "worker", name: "Worker", x: 320, y: 120 };
const listReads = expect.arrayContaining([expect.stringMatching(/^GET \/api\/(flows|agents)$/)]);
/** Prerequisite stages replay one continuous editor-open history; tested operations stay in the test Acts. */
export async function beforeCreatedAgent(fixtures: StudioFixtures, prefix: string) {
  const { app, screen, browser } = fixtures;
  await browser.setViewport({ width: 1920, height: 1000 });
  await openRemoteBrowser(app);
  await openApproved(app, "/studio/flows");
  const studio = screen.getByRole("navigation", "Studio navigation");
  const agentsBefore = await listAgentDefinitions(app.baseUrl);
  const flowsBefore = (await (await fetch(new URL("/api/flows", app.baseUrl))).json()) as {
    value: unknown[];
  };
  await expect(studio.getByRole("link", "Flows")).toContainText(String(flowsBefore.value.length));
  await resetBrowserRequests(app);
  return {
    app: fixtures.app,
    screen: fixtures.screen,
    browser: fixtures.browser,
    prefix,
    studio,
    agentsBefore,
    flowsBefore,
  };
}

export async function expectCreatedAgent(
  state: Awaited<ReturnType<typeof beforeCreatedAgent>> & {
    agent: Awaited<ReturnType<typeof copyAgentDefinition>>;
  },
) {
  const { app, studio, agentsBefore } = state;
  await expect(studio.getByRole("link", "Agents")).toContainText(String(agentsBefore.length + 1));
  expect(await browserRequests(app)).not.toEqual(listReads);
  return { ...state };
}

export async function beforeCreatedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeCreatedAgent(fixtures, prefix);
  const { app } = previous;
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Acceptance · ${prefix} · Worker`,
  );
  return expectCreatedAgent({ ...previous, agent });
}

export async function expectCreatedFlow(
  state: Awaited<ReturnType<typeof beforeCreatedFlow>> & {
    id: Awaited<ReturnType<typeof saveSingleAgentFlow>>;
  },
) {
  const { screen, prefix, studio, flowsBefore } = state;
  await expect(screen.getByRole("link", new RegExp(`Acceptance · ${prefix} · Flow`))).toBeVisible();
  await expect(studio.getByRole("link", "Flows")).toContainText(
    String(flowsBefore.value.length + 1),
  );
  await expectCreatedAgent(state);
  return { ...state };
}

export async function beforeRenamedDependency(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeCreatedFlow(fixtures, prefix);
    const { app, agent } = previous;
    const id = await saveSingleAgentFlow(
      app.baseUrl,
      `Acceptance · ${prefix} · Flow`,
      agent.name,
      block,
      agent.exits[0]!.id,
    );
    return expectCreatedFlow({ ...previous, id });
  })();
  const { app, screen, browser, agent, id } = state;
  await screen.getByRole("link", new RegExp(`Acceptance · ${prefix} · Flow`)).tap();
  const library = screen.getByRole("region", "Block library");
  const canvas = screen.getByRole("region", "Flow canvas");
  await expect(library.getByRole("button", `Add ${agent.name}`, { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", /Graph ready/)).toBeVisible();
  await expect(screen.getByRole("button", "Start Run", { exact: true })).toBeEnabled();
  await screen.getByRole("button", "Check readiness", { exact: true }).tap();
  await expect(screen.getByRole("button", /Graph ready/)).toBeVisible();
  await screen.getByRole("button", "Human step Review", { exact: true }).tap();
  await screen.getByRole("button", "Zoom in", { exact: true }).tap();
  await canvas.press("ArrowRight");
  const layer = browser.locator('[aria-label="Flow canvas"] > div[style]');
  const view = (await layer.getAttribute("style"))!.split(";")[0]!;
  const zoom = await canvas.getAttribute("data-zoom");
  const flow = await readFlow(app.baseUrl, id);
  return { ...state, library, canvas, layer, view, zoom, flow };
}

export async function expectRenamedDependency(
  state: Awaited<ReturnType<typeof beforeRenamedDependency>> & {
    renamed: Awaited<ReturnType<typeof saveAgentElsewhere>>;
  },
) {
  const { library, canvas, renamed } = state;
  await expect(canvas.getByText(renamed.name, { exact: true })).toBeVisible();
  await expect(library.getByRole("button", `Add ${renamed.name}`, { exact: true })).toContainText(
    "acceptance-unavailable-model",
  );
  await expect(
    canvas.getByRole("button", "Connect exit delivered of Worker", { exact: true }),
  ).toBeVisible();
  return { ...state };
}

export async function beforeBrokenDependency(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeRenamedDependency(fixtures, prefix);
  const { app, agent } = previous;
  const renamed = await renameCanvasAgent(
    app.baseUrl,
    agent,
    `Acceptance · ${prefix} · Renamed worker`,
  );
  return expectRenamedDependency({ ...previous, renamed });
}

export async function expectBrokenDependency(
  state: Awaited<ReturnType<typeof beforeBrokenDependency>> & {
    changed: Awaited<ReturnType<typeof saveAgentElsewhere>>;
  },
) {
  const { app, screen, agent, id, canvas, layer, view, zoom, flow } = state;
  await expect(canvas.getByText("handoff", { exact: true })).toBeVisible();
  await expectBrokenAgentWire(screen, agent.exits[0]!.id);
  await expect(screen.getByRole("button", "Start Run", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 1");
  expect(await layer.getAttribute("style")).toContain(view);
  await expect(canvas).toHaveAttribute("data-zoom", zoom!);
  expect((await readFlow(app.baseUrl, id)).graph).toEqual(flow.graph);
  await app.screenshot("acceptance-clean-dependency-broken-wire");
  return { ...state };
}

export async function beforeRestoredReadiness(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeBrokenDependency(fixtures, prefix);
  const { app, renamed } = previous;
  const changed = await saveAgentElsewhere(app.baseUrl, renamed, {
    exits: [
      ...renamed.exits.slice(1),
      { id: "handoff", name: "handoff", description: "", messageRequired: false },
    ],
  });
  return expectBrokenDependency({ ...previous, changed });
}

export async function expectRestoredReadiness(
  state: Awaited<ReturnType<typeof beforeRestoredReadiness>>,
) {
  const { screen } = state;
  await expect(screen.getByRole("button", /Graph ready/)).toBeVisible();
  await expect(screen.getByRole("button", "Start Run", { exact: true })).toBeEnabled();
  return { ...state };
}

export async function beforeReleasedTyping(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeRestoredReadiness(fixtures, prefix);
    const { app, agent, changed } = previous;
    await saveAgentElsewhere(app.baseUrl, changed, {
      exits: agent.exits,
      execution: agent.execution,
    });
    return expectRestoredReadiness({ ...previous });
  })();
  const { app, screen, library, flow } = state;
  await screen.getByLabel("Flow name", { exact: true }).focus();
  const revision2 = await saveFlowElsewhere(app.baseUrl, flow, {
    name: `Acceptance · ${prefix} · Flow revision 2`,
    graph: { ...flow.graph, blocks: [flow.graph.blocks[0]!], connections: [] },
  });
  const marker = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Acceptance · ${prefix} · Delivery marker`,
  );
  await expect(library.getByRole("button", `Add ${marker.name}`, { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(flow.name);
  return { ...state, revision2, marker };
}

export async function expectReleasedTyping(
  state: Awaited<ReturnType<typeof beforeReleasedTyping>>,
) {
  const { screen, canvas, layer, view, zoom, revision2 } = state;
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(revision2.name);
  await expect(screen.getByRole("complementary", "Block configuration")).toHaveCount(0);
  expect(await layer.getAttribute("style")).toContain(view);
  await expect(canvas).toHaveAttribute("data-zoom", zoom!);
  const worker = (await screen.getByRole("button", "Agent Worker", { exact: true }).boundingBox())!;
  return { ...state, worker };
}

export async function beforeReleasedGesture(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeReleasedTyping(fixtures, prefix);
    const { canvas } = previous;
    await canvas.focus();
    return expectReleasedTyping({ ...previous });
  })();
  const { app, screen, browser, library, revision2, marker, worker } = state;
  await browser.mouse.move(worker.x + worker.width / 2, worker.y + worker.height / 2);
  await browser.mouse.down();
  const revision3 = await saveFlowElsewhere(app.baseUrl, revision2, {
    name: `Acceptance · ${prefix} · Flow revision 3`,
  });
  await saveAgentElsewhere(app.baseUrl, marker, {
    name: `Acceptance · ${prefix} · Gesture delivered`,
  });
  await expect(
    library.getByRole("button", `Add Acceptance · ${prefix} · Gesture delivered`, { exact: true }),
  ).toBeVisible();
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(revision2.name);
  return { ...state, revision3 };
}

export async function expectReleasedGesture(
  state: Awaited<ReturnType<typeof beforeReleasedGesture>>,
) {
  const { screen, layer, view, revision3 } = state;
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(revision3.name);
  expect(await layer.getAttribute("style")).toContain(view);
  return { ...state };
}

export async function beforeOfflineFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeReleasedGesture(fixtures, prefix);
  const { browser } = previous;
  await browser.mouse.up();
  return expectReleasedGesture({ ...previous });
}

export async function expectOfflineFlow(state: Awaited<ReturnType<typeof beforeOfflineFlow>>) {
  const { screen } = state;
  await expect(screen.getByRole("button", "Save Flow", { exact: true })).toBeDisabled();
  return { ...state };
}

export async function beforeReconnectedFlow(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeOfflineFlow(fixtures, prefix);
    const { app } = previous;
    await fixtureHandles(app).remoteAccess.offline();
    return expectOfflineFlow({ ...previous });
  })();
  const { app, screen } = state;
  await screen
    .getByLabel("Flow name", { exact: true })
    .fill(`Acceptance · ${prefix} · Offline draft`);
  await delayLiveSnapshots(app, 1500);
  return { ...state };
}

export async function expectReconnectedFlow(
  state: Awaited<ReturnType<typeof beforeReconnectedFlow>>,
) {
  const { screen, prefix, layer, view } = state;
  await expect(screen.getByRole("button", "Save Flow", { exact: true })).toBeEnabled();
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(
    `Acceptance · ${prefix} · Offline draft`,
  );
  expect(await layer.getAttribute("style")).toContain(view);
  return { ...state };
}

export async function beforeDirtyFlow(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeReconnectedFlow(fixtures, prefix);
    const { app } = previous;
    await fixtureHandles(app).remoteAccess.online();
    return expectReconnectedFlow({ ...previous });
  })();
  const { app, screen } = state;
  await delayLiveSnapshots(app, 0);
  await screen.getByLabel("Flow name", { exact: true }).fill(`Acceptance · ${prefix} · Local Flow`);
  return { ...state };
}

export async function expectDirtyFlow(
  state: Awaited<ReturnType<typeof beforeDirtyFlow>> & {
    revision4: Awaited<ReturnType<typeof saveFlowElsewhere>>;
  },
) {
  const { screen } = state;
  const flowPanel = screen.getByRole("region", "Reconcile Flow");
  await expect(flowPanel).toContainText("Revision 4 was saved elsewhere");
  return { ...state, flowPanel };
}

export async function beforeNewestFlowComparison(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeDirtyFlow(fixtures, prefix);
    const { app, revision3 } = previous;
    const revision4 = await saveFlowElsewhere(app.baseUrl, revision3, {
      name: `Acceptance · ${prefix} · Flow revision 4`,
    });
    return expectDirtyFlow({ ...previous, revision4 });
  })();
  const { flowPanel } = state;
  await flowPanel.getByRole("button", "Compare latest revision", { exact: true }).tap();
  return { ...state };
}

export async function expectNewestFlowComparison(
  state: Awaited<ReturnType<typeof beforeNewestFlowComparison>> & {
    revision5: Awaited<ReturnType<typeof saveFlowElsewhere>>;
  },
) {
  const { flowPanel, revision5 } = state;
  await expect(flowPanel.getByRole("heading", "Saved revision 5", { exact: true })).toBeVisible();
  await expect(flowPanel).toContainText(revision5.name);
  await expect(
    flowPanel.getByRole("button", "Keep local draft against revision 4", { exact: true }),
  ).toHaveCount(0);
  return { ...state };
}

export async function beforeReboundFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeNewestFlowComparison(fixtures, prefix);
  const { app, revision4 } = previous;
  const revision5 = await saveFlowElsewhere(app.baseUrl, revision4, {
    name: `Acceptance · ${prefix} · Flow revision 5`,
  });
  return expectNewestFlowComparison({ ...previous, revision5 });
}

export async function expectReboundFlow(state: Awaited<ReturnType<typeof beforeReboundFlow>>) {
  const { app, screen, prefix, id } = state;
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(
    `Acceptance · ${prefix} · Local Flow`,
  );
  expect((await readFlow(app.baseUrl, id)).revision).toBe(5);
  return { ...state };
}

export async function beforeSavedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeReboundFlow(fixtures, prefix);
  const { flowPanel } = previous;
  await flowPanel.getByRole("button", "Keep local draft against revision 5", { exact: true }).tap();
  return expectReboundFlow({ ...previous });
}

export async function expectSavedFlow(state: Awaited<ReturnType<typeof beforeSavedFlow>>) {
  const { app, screen, prefix, id, flowPanel } = state;
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 6");
  const ownFlow = await readFlow(app.baseUrl, id);
  expect(ownFlow.name).toBe(`Acceptance · ${prefix} · Local Flow`);
  await expect(flowPanel).toHaveCount(0);
  expect(await browserRequests(app)).not.toEqual(listReads);
  return { ...state, ownFlow };
}

export async function beforeReloadedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeSavedFlow(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Save Flow", { exact: true }).tap();
  return expectSavedFlow({ ...previous });
}

export async function expectReloadedFlow(state: Awaited<ReturnType<typeof beforeReloadedFlow>>) {
  const { screen, ownFlow } = state;
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(ownFlow.name);
  return { ...state };
}

export async function beforeUnusedAgent(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeReloadedFlow(fixtures, prefix);
    const { browser } = previous;
    await browser.reload();
    return expectReloadedFlow({ ...previous });
  })();
  const { screen, renamed, revision5 } = state;
  await screen
    .getByLabel("Flow name", { exact: true })
    .fill(`Acceptance · ${prefix} · Retained Flow`);
  await screen.getByRole("link", "Agents", { exact: true }).tap();
  await expect(screen.getByRole("link", renamed.name, { exact: true })).toContainText("1 Flow");
  const empty = {
    ...revision5.graph,
    flowInput: { ...revision5.graph.flowInput, targetBlockIds: [] },
    blocks: [],
    connections: [],
  };
  return { ...state, empty };
}

export async function expectUnusedAgent(state: Awaited<ReturnType<typeof beforeUnusedAgent>>) {
  const { screen, renamed } = state;
  await expect(screen.getByRole("link", renamed.name, { exact: true })).toContainText("Unused");
  return { ...state };
}

export async function beforeRemovedDependency(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeUnusedAgent(fixtures, prefix);
  const { app, ownFlow, empty } = previous;
  await saveFlowElsewhere(app.baseUrl, ownFlow, { graph: empty });
  return expectUnusedAgent({ ...previous });
}

export async function expectRemovedDependency(
  state: Awaited<ReturnType<typeof beforeRemovedDependency>>,
) {
  const { screen, renamed } = state;
  await expect(screen.getByRole("link", renamed.name, { exact: true })).toHaveCount(0);
  return { ...state };
}

export async function beforeReopenedMissingDependency(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeRemovedDependency(fixtures, prefix);
    const { app, agent } = previous;
    await removeAgentElsewhere(app.baseUrl, agent.id);
    return expectRemovedDependency({ ...previous });
  })();
  const { screen } = state;
  await screen.getByRole("link", "Flows", { exact: true }).tap();
  return { ...state };
}

export async function expectReopenedMissingDependency(
  state: Awaited<ReturnType<typeof beforeReopenedMissingDependency>>,
) {
  const { screen, prefix, library, canvas, renamed } = state;
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(
    `Acceptance · ${prefix} · Retained Flow`,
  );
  await expect(canvas.getByText("Unavailable Agent", { exact: true })).toBeVisible();
  await expect(library.getByRole("button", `Add ${renamed.name}`, { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Start Run", { exact: true })).toBeDisabled();
  return { ...state };
}

export async function beforeRemovedFlow(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeReopenedMissingDependency(fixtures, prefix);
    const { screen } = previous;
    await screen.getByRole("link", new RegExp(`Acceptance · ${prefix} · Local Flow`)).tap();
    return expectReopenedMissingDependency({ ...previous });
  })();
  const { flowPanel } = state;
  await flowPanel.getByRole("button", "Compare latest revision", { exact: true }).tap();
  return { ...state };
}

export async function expectRemovedFlow(state: Awaited<ReturnType<typeof beforeRemovedFlow>>) {
  const { screen, studio, flowsBefore, flowPanel } = state;
  await expect(flowPanel).toHaveCount(0);
  await expect(studio.getByRole("link", "Flows")).toContainText(String(flowsBefore.value.length));
  await expectRetainedDefinition(screen, "Flow", ["Save Flow", "Start Run", "Remove"]);
  return { ...state };
}

export async function beforeCopiedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeRemovedFlow(fixtures, prefix);
  const { app, id } = previous;
  await removeFlowElsewhere(app.baseUrl, id);
  return expectRemovedFlow({ ...previous });
}

export async function expectCopiedFlow(state: Awaited<ReturnType<typeof beforeCopiedFlow>>) {
  const { app, screen, browser, prefix, ownFlow } = state;
  await expect(screen.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  expect(await browser.evaluate("navigator.clipboard.readText().then(JSON.parse)")).toEqual({
    name: `Acceptance · ${prefix} · Retained Flow`,
    graph: ownFlow.graph,
    workspace: ownFlow.workspace,
  });
  await app.screenshot("acceptance-removed-flow-recovery");
  return { ...state };
}

export async function beforeKeptFlow(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeCopiedFlow(fixtures, prefix);
    const { screen } = previous;
    await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();
    return expectCopiedFlow({ ...previous });
  })();
  const { screen } = state;
  await screen.getByRole("link", "Agents", { exact: true }).tap();
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  const flowGuard = screen.getByRole(
    "dialog",
    "This Flow was removed elsewhere. Discard the retained draft?",
    { exact: true },
  );
  return { ...state, flowGuard };
}

export async function expectKeptFlow(state: Awaited<ReturnType<typeof beforeKeptFlow>>) {
  const { screen, prefix } = state;
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(
    `Acceptance · ${prefix} · Retained Flow`,
  );
  return { ...state };
}

export async function beforeCleanAgent(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeKeptFlow(fixtures, prefix);
    const { flowGuard } = previous;
    await flowGuard.getByRole("button", "Keep editing", { exact: true }).tap();
    return expectKeptFlow({ ...previous });
  })();
  const { app, screen, marker, flowGuard } = state;
  await screen.getByRole("link", "All Flows", { exact: true }).tap();
  await screen.getByRole("link", /^Demo · Focused change /).tap();
  await flowGuard.getByRole("button", "Discard", { exact: true }).tap();
  await screen.getByRole("link", "Agents", { exact: true }).tap();
  await screen
    .getByRole("link", `Acceptance · ${prefix} · Gesture delivered`, { exact: true })
    .tap();
  const currentAgent = await readAgentDefinition(app.baseUrl, marker.id);
  return { ...state, currentAgent };
}

export async function expectCleanAgent(
  state: Awaited<ReturnType<typeof beforeCleanAgent>> & {
    cleanAgent: Awaited<ReturnType<typeof saveAgentElsewhere>>;
  },
) {
  const { screen, cleanAgent } = state;
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(cleanAgent.name);
  await expect(screen.getByText("Updated to revision 3", { exact: true })).toBeVisible();
  return { ...state };
}

export async function beforeComparedAgent(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeCleanAgent(fixtures, prefix);
    const { app, currentAgent } = previous;
    const cleanAgent = await saveAgentElsewhere(app.baseUrl, currentAgent, {
      name: `Acceptance · ${prefix} · Agent revision 3`,
    });
    return expectCleanAgent({ ...previous, cleanAgent });
  })();
  const { app, screen, cleanAgent } = state;
  await screen
    .getByLabel("Prompt", { exact: true })
    .fill(`Acceptance · ${prefix} · My retained prompt`);
  const agent4 = await saveAgentElsewhere(app.baseUrl, cleanAgent, {
    prompt: `Acceptance · ${prefix} · Saved prompt 4`,
  });
  const agentPanel = screen.getByRole("region", "Reconcile Agent");
  return { ...state, agent4, agentPanel };
}

export async function expectComparedAgent(state: Awaited<ReturnType<typeof beforeComparedAgent>>) {
  const { agentPanel } = state;
  await expect(agentPanel.getByLabel("Your local draft", { exact: true })).toContainText(
    "My retained prompt",
  );
  return { ...state };
}

export async function beforeInvalidatedAgentConfirmation(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeComparedAgent(fixtures, prefix);
    const { agentPanel } = previous;
    await agentPanel.getByRole("button", "Compare latest revision", { exact: true }).tap();
    return expectComparedAgent({ ...previous });
  })();
  const { screen, agentPanel } = state;
  await agentPanel.getByRole("button", "Load latest revision", { exact: true }).tap();
  await expect(screen.getByRole("alertdialog", "Load revision 4?", { exact: true })).toBeVisible();
  return { ...state };
}

export async function expectInvalidatedAgentConfirmation(
  state: Awaited<ReturnType<typeof beforeInvalidatedAgentConfirmation>>,
) {
  const { screen, agentPanel } = state;
  await expect(screen.getByRole("alertdialog", "Load revision 4?", { exact: true })).toHaveCount(0);
  await expect(agentPanel.getByLabel("Saved revision 5", { exact: true })).toContainText(
    "Saved prompt 5",
  );
  return { ...state };
}

export async function beforeReboundAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeInvalidatedAgentConfirmation(fixtures, prefix);
  const { app, agent4 } = previous;
  await saveAgentElsewhere(app.baseUrl, agent4, {
    prompt: `Acceptance · ${prefix} · Saved prompt 5`,
  });
  return expectInvalidatedAgentConfirmation({ ...previous });
}

export async function expectReboundAgent(state: Awaited<ReturnType<typeof beforeReboundAgent>>) {
  const { app, marker } = state;
  expect((await readAgentDefinition(app.baseUrl, marker.id)).revision).toBe(5);
  return { ...state };
}

export async function beforeSavedAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeReboundAgent(fixtures, prefix);
  const { agentPanel } = previous;
  await agentPanel.getByRole("button", "Keep my edits against revision 5", { exact: true }).tap();
  return expectReboundAgent({ ...previous });
}

export async function expectSavedAgent(state: Awaited<ReturnType<typeof beforeSavedAgent>>) {
  const { app, screen, prefix, marker } = state;
  await expect(screen.getByText("Agent definition · rev 6", { exact: true })).toBeVisible();
  const savedAgent = await readAgentDefinition(app.baseUrl, marker.id);
  expect(savedAgent.prompt).toBe(`Acceptance · ${prefix} · My retained prompt`);
  return { ...state, savedAgent };
}

export async function beforeReloadedAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeSavedAgent(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Save", { exact: true }).tap();
  return expectSavedAgent({ ...previous });
}

export async function expectReloadedAgent(state: Awaited<ReturnType<typeof beforeReloadedAgent>>) {
  const { screen, savedAgent } = state;
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(savedAgent.prompt);
  return { ...state };
}

export async function beforeRemovedAgent(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeReloadedAgent(fixtures, prefix);
    const { browser } = previous;
    await browser.reload();
    return expectReloadedAgent({ ...previous });
  })();
  const { app, screen, agentPanel, savedAgent } = state;
  await screen
    .getByLabel("Prompt", { exact: true })
    .fill(`Acceptance · ${prefix} · Recovery prompt`);
  await saveAgentElsewhere(app.baseUrl, savedAgent, {
    prompt: `Acceptance · ${prefix} · Saved prompt 7`,
  });
  await agentPanel.getByRole("button", "Compare latest revision", { exact: true }).tap();
  return { ...state };
}

export async function expectRemovedAgent(state: Awaited<ReturnType<typeof beforeRemovedAgent>>) {
  const { screen, studio, agentsBefore, agentPanel } = state;
  await expect(agentPanel).toHaveCount(0);
  await expect(studio.getByRole("link", "Agents")).toContainText(String(agentsBefore.length));
  await expectRetainedDefinition(screen, "Agent", ["Save", "Duplicate", "Delete"]);
  return { ...state };
}

export async function beforeCopiedAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeRemovedAgent(fixtures, prefix);
  const { app, marker } = previous;
  await removeAgentElsewhere(app.baseUrl, marker.id);
  return expectRemovedAgent({ ...previous });
}

export async function expectCopiedAgent(state: Awaited<ReturnType<typeof beforeCopiedAgent>>) {
  const { app, screen, browser, prefix, agent, marker, savedAgent } = state;
  await expect(screen.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  expect(await browser.evaluate("navigator.clipboard.readText().then(JSON.parse)")).toEqual({
    name: savedAgent.name,
    prompt: `Acceptance · ${prefix} · Recovery prompt`,
    execution: savedAgent.execution,
    exits: savedAgent.exits,
  });
  expect(
    (await listAgentDefinitions(app.baseUrl)).some(
      (item) => item.id === marker.id || item.id === agent.id,
    ),
  ).toBe(false);
  return { ...state };
}

export async function beforeGuardedAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeCopiedAgent(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();
  return expectCopiedAgent({ ...previous });
}

export async function expectGuardedAgent(state: Awaited<ReturnType<typeof beforeGuardedAgent>>) {
  const { app, screen, browser } = state;
  const agentGuard = screen.getByRole(
    "dialog",
    "This Agent was removed elsewhere. Discard the retained draft?",
    { exact: true },
  );
  await expect(agentGuard).toBeVisible();
  await browser.evaluate(
    "Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished)).then(() => null)",
  );
  await app.screenshot("acceptance-agent-retained-discard");
  return { ...state, agentGuard };
}

export async function beforeMissingFlow(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeGuardedAgent(fixtures, prefix);
    const { screen } = previous;
    await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
    return expectGuardedAgent({ ...previous });
  })();
  const { agentGuard } = state;
  await agentGuard.getByRole("button", "Discard", { exact: true }).tap();
  return { ...state };
}

export async function expectMissingFlow(state: Awaited<ReturnType<typeof beforeMissingFlow>>) {
  const { screen } = state;
  await expect(screen.getByText("Flow not found", { exact: true })).toBeVisible();
  return { ...state };
}

export async function beforeMissingAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeMissingFlow(fixtures, prefix);
  const { app, id } = previous;
  await app.open(`/studio/flows/${id}`);
  return expectMissingFlow({ ...previous });
}

export async function expectMissingAgent(state: Awaited<ReturnType<typeof beforeMissingAgent>>) {
  const { screen } = state;
  await expect(screen.getByText("Agent not found", { exact: true })).toBeVisible();
  return { ...state };
}

export async function beforeChangedDirtyDependency(fixtures: StudioFixtures, prefix: string) {
  const { app, screen, browser } = fixtures;
  await browser.setViewport({ width: 1920, height: 1000 });
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Live · ${prefix} · Canvas worker`,
  );
  const wired = agent.exits[0]!;
  const flow = await saveSingleAgentFlow(
    app.baseUrl,
    `Live · ${prefix} · Canvas Flow`,
    `Live · ${prefix} · Canvas worker`,
    block,
    wired.id,
  );
  await app.open(`/studio/flows/${flow}`);
  await screen.getByLabel("Flow name").fill(`Live · ${prefix} · Canvas Flow edited`);
  await screen.getByRole("button", "Check readiness", { exact: true }).tap();
  await expect(screen.getByRole("button", /Graph ready/)).toBeVisible();
  const handoff = { id: "handoff", name: "handoff", description: "", messageRequired: false };
  return {
    app: fixtures.app,
    screen: fixtures.screen,
    browser: fixtures.browser,
    prefix,
    agent,
    wired,
    flow,
    handoff,
  };
}

export async function expectChangedDirtyDependency(
  state: Awaited<ReturnType<typeof beforeChangedDirtyDependency>>,
) {
  const { app, screen, prefix, wired } = state;
  const canvas = screen.getByRole("region", "Flow canvas");
  await expect(screen.getByRole("button", /Agents changed — check readiness again/)).toBeVisible();
  await expect(canvas.getByText("handoff", { exact: true })).toBeVisible();
  await expectBrokenAgentWire(screen, wired.id);
  await expect(screen.getByRole("status", "Flow save status")).toContainText(
    "Unsaved changes · Revision 1",
  );
  await expect(screen.getByLabel("Flow name")).toHaveValue(`Live · ${prefix} · Canvas Flow edited`);
  await expect(screen.getByRole("button", "Start Run", { exact: true })).toBeDisabled();
  await app.screenshot("studio-live-agent-changed-on-canvas");
  return { ...state, canvas };
}

export async function beforeCheckedBrokenDependency(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeChangedDirtyDependency(fixtures, prefix);
  const { app, agent, handoff } = previous;
  await updateAgentExits(app.baseUrl, agent, [...agent.exits.slice(1), handoff]);
  return expectChangedDirtyDependency({ ...previous });
}

export async function expectCheckedBrokenDependency(
  state: Awaited<ReturnType<typeof beforeCheckedBrokenDependency>>,
) {
  const { app, screen } = state;
  await expect(screen.getByText(/Worker: its Agent no longer has exit/)).toBeVisible();
  await app.screenshot("studio-live-agent-changed-checked");
  return { ...state };
}

/** One independent public save changes the dependency shown by the open canvas. */
export function renameCanvasAgent(
  baseUrl: string | undefined,
  agent: Awaited<ReturnType<typeof readAgentDefinition>>,
  name: string,
) {
  assert(agent.execution, "The canvas Agent has a model");
  return saveAgentElsewhere(baseUrl, agent, {
    name,
    execution: { ...agent.execution, modelId: "acceptance-unavailable-model" },
    exits: [{ ...agent.exits[0]!, name: "delivered" }, ...agent.exits.slice(1)],
  });
}
