import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "./support/test.ts";
import {
  listAgentDefinitions,
  removeAgentElsewhere,
  saveAgentElsewhere,
  updateAgentExits,
} from "./support/agents.ts";
import { readFlow, removeFlowElsewhere, saveFlowElsewhere } from "./support/flows.ts";
import { delayLiveSnapshots, resetBrowserRequests } from "./support/live.ts";
import {
  expectBrokenAgentWire,
  expectFlowSaved,
  expectRetainedDefinition,
  readinessSummary,
} from "./support/studio.ts";
import {
  expectNoStudioListReads,
  expectStudioViewport,
  flowCount,
  handoffExit,
  moveStudioViewport,
  newStudioAgent,
  newStudioFlow,
  openApprovedStudio,
  openComparedAgent,
  openComparedFlow,
  openLiveFlow,
  openLiveFlowWithMovedViewport,
  readRecoveredDefinition,
  renameCanvasAgent,
} from "./support/studio-live-states.ts";

test("an independent Agent create updates the open Studio count without a list read", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const count = (await listAgentDefinitions(app.baseUrl)).length;
  await openApprovedStudio({ app, screen, browser }, "agents");
  const agents = screen.getByRole("navigation", "Studio navigation").getByRole("link", "Agents");
  await expect(agents).toContainText(String(count));
  await resetBrowserRequests(app);

  // Act
  const agent = await newStudioAgent(app);

  // Assert
  await expect(screen.getByRole("link", agent.name, { exact: false })).toBeVisible();
  await expect(agents).toContainText(String(count + 1));
  await expectNoStudioListReads(app);
});

test("an independent Flow create updates the open Studio list and count without a list read", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const agent = await newStudioAgent(app);
  const count = await flowCount(app);
  await openApprovedStudio({ app, screen, browser }, "flows");
  const flows = screen.getByRole("navigation", "Studio navigation").getByRole("link", "Flows");
  await expect(flows).toContainText(String(count));
  await resetBrowserRequests(app);

  // Act
  const flow = await newStudioFlow(app, agent);

  // Assert
  await expect(screen.getByRole("link", flow.name, { exact: false })).toBeVisible();
  await expect(flows).toContainText(String(count + 1));
  await expectNoStudioListReads(app);
});

test("an open Flow resolves changed Agent names, execution and ports", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { agent } = await openLiveFlow({ app, screen, browser });
  const library = screen.getByRole("region", "Block library");
  await expect(library.getByRole("button", `Add ${agent.name}`, { exact: true })).toBeVisible();

  // Act
  const renamed = await renameCanvasAgent(app, agent, `${agent.name} renamed`);

  // Assert
  const canvas = screen.getByRole("region", "Flow canvas");
  await expect(canvas.getByText(renamed.name, { exact: true })).toBeVisible();
  const row = browser.locator(`#block-library [aria-label=${JSON.stringify(renamed.name)}]`);
  await expect(row).toHaveAttribute("aria-disabled", "true");
  await expect(row).toContainText("Needs a model");
  await expect(
    canvas.getByRole("button", "Connect exit delivered of Worker", { exact: true }),
  ).toBeVisible();
});

test("an open clean Flow retains broken wires and its viewport after an Agent exit disappears", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { agent, flow } = await openLiveFlow({ app, screen, browser });
  const viewport = await moveStudioViewport({ app, screen, browser });

  // Act
  await updateAgentExits(app.baseUrl, agent, [handoffExit, ...agent.exits.slice(1)]);

  // Assert
  await expect(viewport.canvas.getByText("handoff", { exact: true })).toBeVisible();
  await expectBrokenAgentWire(screen, agent.exits[0]!.id);
  await expect(readinessSummary(screen, /^Not ready/)).toBeVisible();
  await expectFlowSaved(screen);
  await expectStudioViewport(viewport);
  expect((await readFlow(app.baseUrl, flow.id)).graph).toEqual(flow.graph);
  await app.screenshot("acceptance-clean-dependency-broken-wire");
});

test("restoring the Agent dependency restores clean Flow readiness", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const agent = await newStudioAgent(app);
  const flow = await newStudioFlow(app, agent);
  const changed = await saveAgentElsewhere(app.baseUrl, agent, { exits: [handoffExit] });
  await openApprovedStudio({ app, screen, browser }, `flows/${flow.id}`);
  await expect(readinessSummary(screen, /^Not ready/)).toBeVisible();

  // Act
  await updateAgentExits(app.baseUrl, changed, agent.exits);

  // Assert
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
});

test("releasing typing adopts the deferred Flow revision and clears its obsolete selection", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { flow, viewport } = await openLiveFlowWithMovedViewport({ app, screen, browser });
  await screen.getByRole("button", "Human step Review", { exact: true }).tap();
  const name = screen.getByLabel("Flow name", { exact: true });
  await name.focus();
  const updated = await saveFlowElsewhere(app.baseUrl, flow, {
    name: `${flow.name} revised`,
    graph: { ...flow.graph, blocks: [flow.graph.blocks[0]!], connections: [] },
  });
  const marker = await newStudioAgent(app);
  await expect(screen.getByRole("button", `Add ${marker.name}`, { exact: true })).toBeVisible();
  await expect(name).toHaveValue(flow.name);

  // Act
  await viewport.canvas.focus();

  // Assert
  await expect(name).toHaveValue(updated.name);
  await expect(screen.getByRole("complementary", "Block settings")).toHaveCount(0);
  await expectStudioViewport(viewport);
});

test("releasing the held canvas gesture adopts the deferred Flow revision without moving the view", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { flow, viewport } = await openLiveFlowWithMovedViewport({ app, screen, browser });
  const worker = await screen.getByRole("button", "Agent Worker", { exact: true }).boundingBox();
  assert(worker);
  await browser.mouse.move(worker.x + worker.width / 2, worker.y + worker.height / 2);
  await browser.mouse.down();
  const updated = await saveFlowElsewhere(app.baseUrl, flow, { name: `${flow.name} revised` });
  const marker = await newStudioAgent(app);
  await expect(screen.getByRole("button", `Add ${marker.name}`, { exact: true })).toBeVisible();
  const name = screen.getByLabel("Flow name", { exact: true });
  await expect(name).toHaveValue(flow.name);

  // Act
  await browser.mouse.up();

  // Assert
  await expect(name).toHaveValue(updated.name);
  await expectStudioViewport(viewport);
});

test("a reconnect snapshot preserves the Flow draft and viewport", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { viewport } = await openLiveFlowWithMovedViewport({ app, screen, browser });
  await fixture.remoteAccess.offline();
  const name = screen.getByLabel("Flow name", { exact: true });
  await name.fill("Offline Flow draft");
  await expect(screen.getByRole("status", "Flow save status")).toHaveText("Unsaved changes");
  const save = screen.getByRole("button", "Save", { exact: true });
  await expect(save).toBeDisabled();
  const reason = screen.getByRole("dialog", "Studio").getByText("Offline", { exact: true });
  await expect(reason).toBeVisible();
  await delayLiveSnapshots(app, 1500);

  // Act
  await fixture.remoteAccess.online();

  // Assert
  await expect(reason).toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(name).toHaveValue("Offline Flow draft");
  await expectStudioViewport(viewport);
});

test("an open Flow comparison follows the newest saved revision", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { previous } = await openComparedFlow({ app, screen, browser }, "Local Flow draft");

  // Act
  const latest = await saveFlowElsewhere(app.baseUrl, previous, { name: "Newest Flow revision" });

  // Assert
  const comparison = screen.getByRole("dialog", `Compare with revision ${latest.revision}`);
  await expect(
    comparison.getByRole("button", `Load revision ${latest.revision}`, { exact: true }),
  ).toBeVisible();
  await expect(
    screen.getByRole("dialog", `Compare with revision ${previous.revision}`),
  ).toHaveCount(0);
});

test("an external Flow graph save updates the open Agent usage count", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const agent = await newStudioAgent(app);
  const flow = await newStudioFlow(app, agent);
  await openApprovedStudio({ app, screen, browser }, "agents");
  const row = screen.getByRole("link", agent.name, { exact: false });
  await expect(row).toContainText("1 Flow");

  // Act
  await saveFlowElsewhere(app.baseUrl, flow, {
    graph: {
      ...flow.graph,
      flowInput: { ...flow.graph.flowInput, targetBlockIds: [] },
      blocks: [],
      connections: [],
    },
  });

  // Assert
  await expect(row).toContainText("Unused");
});

test("an external Agent removal removes its open Studio list entry", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const agent = await newStudioAgent(app);
  await openApprovedStudio({ app, screen, browser }, "agents");
  const row = screen.getByRole("link", agent.name, { exact: false });
  await expect(row).toBeVisible();

  // Act
  await removeAgentElsewhere(app.baseUrl, agent.id);

  // Assert
  await expect(row).toHaveCount(0);
});

test("external Flow removal closes the comparison and leaves its draft recoverable from the clipboard", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { flow, previous } = await openComparedFlow(
    { app, screen, browser },
    "Retained Flow draft",
  );

  // Act
  await removeFlowElsewhere(app.baseUrl, flow.id);

  // Assert
  await expect(
    screen.getByRole("dialog", `Compare with revision ${previous.revision}`),
  ).toHaveCount(0);
  await expectRetainedDefinition(
    screen,
    "Flow",
    ["Save"],
    ["Duplicate…", "Change owner…", "Export JSON", "Remove"],
  );
  expect(await readRecoveredDefinition(screen, browser)).toEqual({
    name: "Retained Flow draft",
    graph: flow.graph,
    workspace: flow.workspace,
  });
  await app.screenshot("acceptance-removed-flow-recovery");
});

test("a newer Agent revision moves the open comparison to it", async ({ app, screen, browser }) => {
  // Arrange
  const { previous } = await openComparedAgent({ app, screen, browser }, "Local Agent draft");

  // Act
  const latest = await saveAgentElsewhere(app.baseUrl, previous, { prompt: "Newest Agent prompt" });

  // Assert
  const comparison = screen.getByRole("dialog", `Compare with revision ${latest.revision}`);
  await expect(comparison.getByLabel(`Revision ${latest.revision}`, { exact: true })).toContainText(
    latest.prompt,
  );
  await expect(
    comparison.getByRole("button", `Load revision ${previous.revision}`, { exact: true }),
  ).toHaveCount(0);
});

test("external Agent removal closes the comparison and leaves its draft recoverable from the clipboard", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { agent, previous } = await openComparedAgent(
    { app, screen, browser },
    "Retained Agent prompt",
  );

  // Act
  await removeAgentElsewhere(app.baseUrl, agent.id);

  // Assert
  await expect(
    screen.getByRole("dialog", `Compare with revision ${previous.revision}`),
  ).toHaveCount(0);
  await expectRetainedDefinition(screen, "Agent", ["Save", "More actions"]);
  expect(await readRecoveredDefinition(screen, browser)).toEqual({
    name: agent.name,
    prompt: "Retained Agent prompt",
    execution: agent.execution,
    exits: agent.exits,
    projectOverrides: agent.projectOverrides,
  });
});

test("an Agent exit change invalidates an open dirty Flow and retains its broken wire", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { agent } = await openLiveFlow({ app, screen, browser });
  const name = screen.getByLabel("Flow name");
  await name.fill("Dirty Flow draft");
  await expect(readinessSummary(screen, "Ready")).toBeVisible();

  // Act
  await updateAgentExits(app.baseUrl, agent, [handoffExit, ...agent.exits.slice(1)]);

  // Assert
  await expect(
    screen.getByRole("region", "Flow canvas").getByText("handoff", { exact: true }),
  ).toBeVisible();
  await expectBrokenAgentWire(screen, agent.exits[0]!.id);
  await expect(screen.getByRole("status", "Flow save status")).toHaveText("Unsaved changes");
  await expect(name).toHaveValue("Dirty Flow draft");
  await expect(readinessSummary(screen, /^Not ready/)).toBeVisible();
  await app.screenshot("studio-live-agent-changed-on-canvas");
  await screen.getByRole("button", /^Not ready/).tap();
  await expect(
    screen
      .getByRole("list", "Readiness issues")
      .getByRole("button", /Worker: its Agent no longer has exit/),
  ).toBeVisible();
  await app.screenshot("studio-live-agent-changed-checked");
});
