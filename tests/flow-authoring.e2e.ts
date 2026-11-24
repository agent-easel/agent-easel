import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { FlowDraft, PortableFlowDocument, Result } from "../packages/contracts/src/index.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import { test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import {
  copyAgentDefinition,
  readAgentDefinition,
  saveAgentElsewhere,
  updateAgentExits,
} from "./support/agents.ts";
import {
  largestWirePortOffset,
  openFittedFlowBlock,
  releaseApprovalHumanStep,
  worktreeImplementBlock,
} from "./support/canvas.ts";
import {
  chooseFlowAction,
  expectFlowSaved,
  expectSaveFilled,
  expectSaveNeutral,
  expectSavedAgentRevision,
  flowsBreadcrumb,
  openEditedStudioFlow,
  openStudioFlowCopy,
  readinessSummary,
  saveFlowWithReadiness,
  startHeldSave,
} from "./support/studio.ts";
import {
  createStudioFlow,
  expectFlowBlocked,
  removeFlowElsewhere,
  renameFlow,
  saveFlowCopy,
  saveSingleAgentFlow,
} from "./support/flows.ts";

test("author a loop and fan-out by dragging exit ports, delete stray connections, save an incomplete draft, connect the Flow input to fix readiness, choose a custom worktree base and reconcile revisions saved elsewhere", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  await app.open("/studio/flows");

  // Act
  await screen.getByRole("button", "New Flow").tap();
  await screen.getByLabel("Flow name").fill("Change and review");
  await screen.getByRole("button", "Create Flow").tap();
  const canvas = screen.getByRole("region", "Flow canvas");
  await screen.getByRole("button", "Add Sample worker").tap();
  await screen.getByLabel("Name", { exact: true }).fill("Coder");
  // With the settings closed, a drop at the canvas centre lands right of Coder's default place.
  await screen.getByRole("button", "Close block settings").tap();
  await screen.getByRole("button", "Add Sample worker").dragTo(canvas);
  await expect(screen.getByRole("article", /^Block /)).toHaveCount(2);
  await screen.getByLabel("Name", { exact: true }).fill("Reviewer");
  const reviewerPress = (await screen.getByRole("button", "Agent Reviewer").boundingBox())!;
  await browser.mouse.move(
    reviewerPress.x + reviewerPress.width / 2,
    reviewerPress.y + reviewerPress.height / 2,
  );
  await browser.mouse.down();
  await browser.mouse.move(
    reviewerPress.x + reviewerPress.width / 2,
    reviewerPress.y + reviewerPress.height / 2 + 200,
  );
  await browser.mouse.up();
  await expect
    .poll(async () => (await screen.getByRole("button", "Agent Reviewer").boundingBox())!.y)
    .toBeGreaterThan(reviewerPress.y + 150);
  const wires = screen.getByRole("group", "Directed connections");
  const coder = screen.getByRole("article", "Block Coder");
  const reviewer = screen.getByRole("article", "Block Reviewer");
  await screen.getByRole("button", "Connect exit fail of Reviewer").dragTo(coder);
  await expect(wires).toHaveAttribute("data-connection-count", "1");
  await screen.getByRole("button", "Agent Reviewer").tap();
  // The Reviewer block offers its Agent's exits, each with the Blocks it reaches.
  await expect(
    screen
      .getByRole("complementary", "Block settings")
      .getByRole("listitem", "Exit fail")
      .getByRole("button", "Targets of exit fail: Coder"),
  ).toBeVisible();
  await app.screenshot("agent-block-exits");
  await screen.getByRole("button", "Add Human step").tap();
  await app.screenshot("human-block-exits");
  const human = screen.getByRole("article", "Block Human step");
  await screen.getByRole("button", "Connect exit ok of Reviewer").dragTo(human);
  await expect(wires).toHaveAttribute("data-connection-count", "2");
  await screen.getByRole("button", "Agent Coder").tap();
  const finishPort = screen.getByRole("button", "Connect exit finish of Coder");
  const port = (await finishPort.boundingBox())!;
  const target = (await reviewer.boundingBox())!;
  await browser.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
  await browser.mouse.down();
  await browser.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await browser.keyboard.press("Escape");
  await browser.mouse.up();
  await expect(wires).toHaveAttribute("data-connection-count", "2");
  await expect(screen.getByRole("complementary", "Block settings")).toBeVisible();
  await finishPort.dragTo(reviewer);
  await expect(wires).toHaveAttribute("data-connection-count", "3");
  // Clicking a forward wire's midpoint selects that connection.
  const finishToReviewer = wires.getByRole("button", "Connection finish from Coder to Reviewer");
  const wire = (await finishToReviewer.boundingBox())!;
  await browser.mouse.move(wire.x + wire.width / 2, wire.y + wire.height / 2);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(finishToReviewer).toHaveAttribute("aria-pressed", "true");
  await expect(screen.getByRole("complementary", "Block settings")).toBeHidden();
  await screen.getByRole("button", "Delete connection").tap();
  await expect(wires).toHaveAttribute("data-connection-count", "2");
  await finishPort.dragTo(reviewer);
  await finishPort.dragTo(human);
  await screen.getByRole("button", "Connect exit ok of Reviewer").dragTo(reviewer);
  await expect(wires).toHaveAttribute("data-connection-count", "5");
  await wires.getByRole("button", "Connection ok from Reviewer to Reviewer").press("Enter");
  await browser.keyboard.press("Delete");
  await expect(wires).toHaveAttribute("data-connection-count", "4");
  await expect(screen.getByRole("button", "Delete connection")).toBeHidden();
  await expect(screen.getByRole("region", "Flow canvas")).toBeFocused();
  await saveFlowWithReadiness(screen, /^Not ready/);
  const flowInputPort = screen.getByRole("button", "Connect Flow input");
  await flowInputPort.dragTo(coder);
  await expect(wires).toHaveAttribute("data-flow-input-count", "1");
  await flowInputPort.dragTo(reviewer);
  await expect(wires).toHaveAttribute("data-flow-input-count", "2");
  await flowInputPort.dragTo(human);
  await flowInputPort.dragTo(coder);
  await expect(wires).toHaveAttribute("data-flow-input-count", "2");
  await wires.getByRole("button", "Connection from Flow input to Reviewer").press("Enter");
  await browser.keyboard.press("Delete");
  await expect(wires).toHaveAttribute("data-flow-input-count", "1");
  const flowInput = (await screen.getByRole("button", "Flow input").boundingBox())!;
  await browser.mouse.move(flowInput.x + flowInput.width / 2, flowInput.y + flowInput.height / 2);
  await browser.mouse.down();
  await browser.mouse.move(
    flowInput.x + flowInput.width / 2,
    flowInput.y + flowInput.height / 2 + 150,
  );
  await browser.mouse.up();
  await expect(
    screen.getByRole("button", "Workspace: New worktree · default branch"),
  ).toBeVisible();
  await screen.getByRole("button", "Workspace: New worktree · default branch").tap();
  await screen.getByRole("menuitem", "New worktree").tap();
  await screen.getByRole("menuitemradio", "Custom ref").tap();
  await screen.getByRole("textbox", "Custom ref").fill("develop");
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("button", "Workspace: New worktree · develop")).toBeVisible();
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectFlowSaved(screen);

  // Assert
  const path = new URL(await browser.url()).pathname;
  const endpoint = new URL(`/api${path.replace(/^\/studio/, "")}`, app.baseUrl);
  const result = (await (await fetch(endpoint)).json()) as Result<FlowDraft>;
  assert(result.ok);
  const saved = result.value;
  assert.equal(saved.graph.connections.length, 4);
  assert.deepEqual(saved.workspace, { mode: "worktree", base: { kind: "ref", ref: "develop" } });
  assert.deepEqual(saved.graph.flowInput, {
    position: { x: 40, y: 200 },
    targetBlockIds: [saved.graph.blocks.find((block) => block.name === "Coder")!.id],
  });
  // A second author saves through the same public backend while this draft has unsaved edits.
  await screen.getByLabel("Flow name").fill("My preserved draft");
  await renameFlow(app.baseUrl, saved.id, "Another editor");
  await expect(screen.getByText("Revision 4 was saved elsewhere", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Flow name")).toHaveValue("My preserved draft");
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await screen.getByRole("button", "Compare latest revision").tap();
  const comparison = screen.getByRole("dialog", "Compare with revision 4");
  await expect(comparison.getByRole("heading", "Revision 4", { exact: true })).toBeVisible();
  await browser.setViewport({ width: 1440, height: 900 });
  await app.screenshot("after-flow-revision-comparison");
  await browser.setViewport({ width: 1920, height: 1000 });
  await comparison.getByRole("button", "Keep my edits", { exact: true }).tap();
  await saveFlowWithReadiness(screen, "Ready");
  await browser.reload();
  await expect(screen.getByLabel("Flow name")).toHaveValue("My preserved draft");
  await expect(screen.getByRole("button", "Workspace: New worktree · develop")).toBeVisible();
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  // With no unsaved edits, the editor switches to a revision saved elsewhere.
  await renameFlow(app.baseUrl, saved.id, "Renamed elsewhere");
  await expect(screen.getByText("Updated to revision 6")).toBeVisible();
  await expect(screen.getByLabel("Flow name")).toHaveValue("Renamed elsewhere");
  await expectFlowSaved(screen);
});

test("Undo restores a wire disconnected from the Block target menu", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await app.open("/studio/flows");
  await screen.getByRole("button", "New Flow").tap();
  await screen.getByLabel("Flow name").fill("Undo a target disconnection");
  await screen.getByRole("button", "Create Flow").tap();
  await screen.getByRole("button", "Add Sample worker").tap();
  await screen.getByRole("button", "Add Human step").tap();
  await screen.getByRole("button", "Agent Sample worker").tap();
  const target = screen.getByRole("button", /^Targets of exit finish:/);
  await target.tap();
  await screen.getByRole("menuitemcheckbox", "Human step", { exact: true }).tap();
  await browser.keyboard.press("Escape");
  await saveFlowWithReadiness(screen, /^Not ready/);
  await target.tap();
  await screen.getByRole("menuitemcheckbox", "Human step", { exact: true }).tap();
  await browser.keyboard.press("Escape");
  await expect(target).toHaveAttribute("aria-label", "Targets of exit finish: none");
  const undo = await browser.evaluate(
    '/Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? "Meta+z" : "Control+z"',
  );

  // Act
  await browser.keyboard.press(undo as string);

  // Assert
  await expect(target).toHaveAttribute("aria-label", "Targets of exit finish: Human step");
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
});

test("configure inherited and local Block exits, preserve wired hidden exits and report a name conflict as not ready", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const suffix = crypto.randomUUID().slice(0, 8);
  const agentName = `UI exit worker ${suffix}`;
  const flowName = `Block exit configuration ${suffix}`;
  const agent = await copyAgentDefinition(app.baseUrl, "Sample worker", agentName);
  await browser.setViewport({ width: 1600, height: 1000 });
  await app.open("/studio/flows");
  await screen.getByRole("button", "New Flow").tap();
  await screen.getByLabel("Flow name").fill(flowName);
  await screen.getByRole("button", "Create Flow").tap();
  await screen.getByRole("button", `Add ${agentName}`, { exact: true }).tap();
  await screen.getByLabel("Name", { exact: true }).fill("Implement");
  await screen.getByRole("button", "Add Human step").tap();
  await screen.getByRole("button", "Close block settings").tap();
  const human = screen.getByRole("article", "Block Human step");
  await screen
    .getByRole("button", "Connect Flow input")
    .dragTo(screen.getByRole("article", "Block Implement"));
  await screen.getByRole("button", "Connect exit finish of Implement").dragTo(human);
  await screen.getByRole("button", "Agent Implement").tap();
  const panel = screen.getByRole("complementary", "Block settings");
  const inherited = panel.getByRole("listitem", "Exit finish");

  // Act: author this Flow's exit configuration through the Block panel.
  await inherited.getByRole("button", "Hide exit finish").tap();

  // Assert: hiding a wired exit keeps the wire and saves an actionable blocker.
  await expect(inherited.getByRole("button", "Show exit finish")).toBeVisible();
  await expect(screen.getByRole("button", "Connect exit finish of Implement")).toHaveCount(0);
  await expect(screen.getByRole("article", "Block Implement")).toContainText("hidden");
  await expect(
    screen.getByRole("button", "Connection finish from Implement to Human step", { exact: true }),
  ).toBeVisible();
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectFlowSaved(screen);
  await expectFlowBlocked(screen, /Implement: exit "finish" is hidden/);
  await app.screenshot("wired-inherited-exit-hidden");
  await browser.reload();
  await screen.getByRole("button", "Agent Implement").tap();
  await expect(inherited.getByRole("button", "Show exit finish")).toBeVisible();
  await inherited.getByRole("button", "Show exit finish").tap();
  await panel.getByRole("listitem", "Exit fail").getByRole("button", "Hide exit fail").tap();
  await panel.getByRole("button", "Add local exit").tap();
  await panel.getByLabel("Exit name", { exact: true }).fill("github-url");
  await panel
    .getByLabel("Description", { exact: true })
    .fill("A fix is ready. Include its GitHub URL.");
  await panel.getByRole("checkbox", "Message required").tap();
  await screen.getByRole("button", "Connect exit github-url of Implement").dragTo(human);
  await expect(
    panel.getByRole("button", "Targets of local exit github-url: Human step"),
  ).toBeVisible();
  await saveFlowWithReadiness(screen, "Ready");
  await app.screenshot("inherited-and-local-exits");
  await panel.getByLabel("Exit name", { exact: true }).fill("finish");
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectFlowSaved(screen);
  await expectFlowBlocked(screen, /Implement: local exit "finish" has the same name/);
  await app.screenshot("local-exit-name-conflict");
  await panel.getByLabel("Exit name", { exact: true }).fill("github-url");
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectFlowSaved(screen);
  await browser.reload();
  await screen.getByRole("button", "Agent Implement").tap();
  await expect(panel.getByLabel("Exit name", { exact: true })).toHaveValue("github-url");
  await expect(panel.getByLabel("Description", { exact: true })).toHaveValue(
    "A fix is ready. Include its GitHub URL.",
  );
  await expect(panel.getByRole("checkbox", "Message required")).toBeChecked();
  const path = new URL(await browser.url()).pathname;
  const endpoint = new URL(`/api${path.replace(/^\/studio/, "")}`, app.baseUrl);
  const saved = (await (await fetch(endpoint)).json()) as Result<FlowDraft>;
  assert(saved.ok);
  const block = saved.value.graph.blocks[0]!;
  assert(block.kind === "agent");
  assert.deepEqual(block.hiddenExitIds, ["fail"]);
  assert.equal(block.localExits[0]?.name, "github-url");
  assert.equal(block.localExits[0]?.messageRequired, true);
  assert.equal(saved.value.graph.connections[0]?.exitId, "finish");
  assert.equal(saved.value.graph.connections[1]?.exitId, block.localExits[0]?.id);

  // A saved Agent edit is read by both Flows, including collision and removed-exit readiness.
  const copyId = await saveFlowCopy(app.baseUrl, flowName, `Another exit Flow ${suffix}`, {
    mode: "checkout",
  });
  await updateAgentExits(app.baseUrl, agent, [
    {
      id: "new-exit",
      name: "github-url",
      description: "Added on the Agent",
      messageRequired: false,
    },
  ]);
  await browser.reload();
  await expectFlowBlocked(screen, /Implement: local exit "github-url" has the same name/);
  const issues = screen.getByRole("list", "Readiness issues");
  await expect(
    issues.getByRole("button", /Implement: its Agent no longer has exit "finish"/),
  ).toBeVisible();
  await issues.getByRole("button", /Implement: its Agent no longer has exit "finish"/).tap();
  const agentExits = panel.getByRole("region", "Exits");
  await expect(agentExits.getByRole("listitem", "Exit github-url")).toBeVisible();
  await expect(agentExits.getByRole("listitem", "Exit finish")).toHaveCount(0);
  await expect(panel.getByRole("listitem", "Exit fail")).toHaveCount(0);
  await expect
    .poll(() =>
      browser.evaluate(
        `getComputedStyle(document.querySelector('[aria-label="Block settings"]')).opacity`,
      ),
    )
    .toBe("1");
  await app.screenshot("agent-exit-change-readiness");
  await app.open(`/studio/flows/${copyId}`);
  await expectFlowBlocked(screen, /Implement: its Agent no longer has exit "finish"/);
  await screen.getByRole("button", "Agent Implement").tap();
  await expect(agentExits.getByRole("listitem", "Exit github-url")).toBeVisible();
  await panel.getByRole("button", "Remove local exit").tap();
  await expect(screen.getByRole("group", "Directed connections")).toHaveAttribute(
    "data-connection-count",
    "1",
  );
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectFlowSaved(screen);
  await browser.reload();
  await expect(screen.getByRole("group", "Directed connections")).toHaveAttribute(
    "data-connection-count",
    "1",
  );
});

const revisitInstruction =
  "On a return, verify the corrections and the newly affected scope; keep earlier dispositions.";

test("a saved Agent block's Revisit instruction is shown again after reload and marks the block on the canvas without its text", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await createStudioFlow(app, screen, browser, "Revisit review loop");
  await screen.getByRole("button", "Add Sample worker").tap();
  await screen.getByLabel("Name", { exact: true }).fill("Reviewer");
  const panel = screen.getByRole("complementary", "Block settings");
  const field = panel.getByRole("textbox", "Revisit instruction (optional)");
  const reviewer = screen.getByRole("article", "Block Reviewer");
  await expect(field).toHaveValue("");
  await expect(reviewer).not.toContainText("Revisit instruction");
  await field.fill(revisitInstruction);
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Unsaved changes");

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectFlowSaved(screen);
  await browser.reload();
  await expect(reviewer).toContainText("Revisit instruction");
  await expect(reviewer).not.toContainText(revisitInstruction);
  await screen.getByRole("button", "Agent Reviewer").tap();
  await expect(field).toHaveValue(revisitInstruction);
  await app.screenshot("revisit-instruction-authoring");
});

test("switching an Agent block to Fresh context on revisit persists across reload and marks the block on the canvas", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const flowId = await saveSingleAgentFlow(app.baseUrl, "Fresh revisit loop", "Sample worker", {
    id: "poller",
    name: "Poller",
    x: 320,
    y: 180,
  });
  await app.open(`/studio/flows/${flowId}`);
  const poller = screen.getByRole("article", "Block Poller");
  await expect(poller).not.toContainText("Fresh context");
  await screen.getByRole("button", "Agent Poller").tap();
  const panel = screen.getByRole("complementary", "Block settings");
  await expect(panel.getByRole("radio", "Keep context")).toBeChecked();
  await panel.getByRole("radio", "Fresh context").tap();

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectFlowSaved(screen);
  await browser.reload();
  await expect(poller).toContainText("Fresh context");
  await screen.getByRole("button", "Agent Poller").tap();
  await expect(panel.getByRole("radio", "Fresh context")).toBeChecked();
  await app.screenshot("revisit-fresh-context-authoring");
});

test("choosing another Agent for a block keeps its Revisit instruction and canvas marker", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(app.baseUrl, "Revisit agent swap", "Sample worker", {
    id: "reviewer",
    name: "Reviewer",
    x: 320,
    y: 180,
    revisitInstruction,
  });
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Agent Reviewer").tap();
  const panel = screen.getByRole("complementary", "Block settings");
  await panel.getByRole("combobox", /^Agent: /).tap();

  // Act
  await screen
    .getByRole("listbox", "Agent", { exact: true })
    .getByRole("option", "Demo · Product engineer", { exact: true })
    .tap();

  // Assert
  await expect(panel.getByRole("textbox", "Revisit instruction (optional)")).toHaveValue(
    revisitInstruction,
  );
  await expect(screen.getByRole("article", "Block Reviewer")).toContainText("Revisit instruction");
});

test("saving a Revisit instruction over 120,000 characters is refused with an error and keeps the whole text in the draft", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(app.baseUrl, "Revisit oversize", "Sample worker", {
    id: "reviewer",
    name: "Reviewer",
    x: 320,
    y: 180,
  });
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Agent Reviewer").tap();
  const field = screen
    .getByRole("complementary", "Block settings")
    .getByRole("textbox", "Revisit instruction (optional)");
  const oversize = "x".repeat(120_001);
  await field.fill(oversize);

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("alert")).toContainText(
    "Enter a Revisit instruction up to 120,000 characters.",
  );
  await expect(screen.getByRole("status", "Flow save status")).not.toContainText("Saved");
  await expect(field).toHaveValue(oversize);
});

test("a saved copy of a Flow keeps its Agent block's Revisit instruction and canvas marker", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  await saveSingleAgentFlow(app.baseUrl, "Revisit copy source", "Sample worker", {
    id: "reviewer",
    name: "Reviewer",
    x: 320,
    y: 180,
    revisitInstruction,
  });
  const copyId = await saveFlowCopy(app.baseUrl, "Revisit copy source", "Revisit review copy", {
    mode: "checkout",
  });

  // Act
  await app.open(`/studio/flows/${copyId}`);

  // Assert
  await expect(screen.getByRole("article", "Block Reviewer")).toContainText("Revisit instruction");
  await screen.getByRole("button", "Agent Reviewer").tap();
  await expect(
    screen
      .getByRole("complementary", "Block settings")
      .getByRole("textbox", "Revisit instruction (optional)"),
  ).toHaveValue(revisitInstruction);
});

test("Agent exit edits persist, renaming keeps Flow wires and removing a wired exit makes the Flow not ready", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: author a reusable Agent and connect its default exit in a saved Flow.
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open("/studio/agents/new");
  await screen.getByLabel("Name", { exact: true }).fill("Exit journey worker");
  await screen
    .getByLabel("Prompt", { exact: true })
    .fill("Implement the requested change and report its result.");
  await expect(screen.getByLabel("Exit 1 name", { exact: true })).toHaveValue("done");
  await app.screenshot("agent-exits-new");
  await expect(screen.getByRole("table", "Agent exits")).toBeVisible();
  await screen.getByRole("button", "Add exit", { exact: true }).tap();
  await screen.getByLabel("Exit 2 name", { exact: true }).fill("changes-needed");
  await screen
    .getByLabel("Exit 2 description", { exact: true })
    .fill("Explain the changes needed before this work can continue.");
  await screen.getByRole("switch", "Exit 2 message required", { exact: true }).tap();
  await screen.getByRole("button", "Create Agent", { exact: true }).tap();
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeVisible();
  const agentId = new URL(await browser.url()).pathname.split("/").at(-1)!;
  const agent = await readAgentDefinition(app.baseUrl, agentId);
  assert.equal(agent.exits[1]?.messageRequired, true);
  assert.equal(
    agent.exits[1]?.description,
    "Explain the changes needed before this work can continue.",
  );
  const headers = { "content-type": "application/json", "X-Factory-Request": "1" };
  const created = (await (
    await fetch(new URL("/api/flows", app.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Agent exit journey" }),
    })
  ).json()) as Result<FlowDraft>;
  assert(created.ok);
  const flowEndpoint = new URL(`/api/flows/${created.value.id}`, app.baseUrl);
  const saved = (await (
    await fetch(flowEndpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: created.value.name,
        expectedRevision: 1,
        expectedProjectId: created.value.projectId,
        graph: {
          flowInput: { position: { x: 40, y: 50 }, targetBlockIds: ["worker"] },
          blocks: [
            {
              id: "worker",
              kind: "agent",
              name: "Implementer",
              agentId,
              hiddenExitIds: [],
              localExits: [],
              position: { x: 320, y: 50 },
            },
            { id: "review", kind: "human", name: "Review", position: { x: 680, y: 50 } },
          ],
          connections: [
            { sourceBlockId: "worker", exitId: agent.exits[0]!.id, targetBlockId: "review" },
          ],
        },
      }),
    })
  ).json()) as Result<FlowDraft>;
  assert(saved.ok);

  // Act: save a rename on the Agent, retaining the exit's identity.
  await screen.getByLabel("Exit 1 name", { exact: true }).fill("ready-for-review");
  await screen
    .getByLabel("Exit 1 description", { exact: true })
    .fill("The implementation is ready for a human review.");
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectSavedAgentRevision(screen, 2);
  await browser.reload();

  // Assert: the saved revision keeps the wire; removing that exit exposes its readiness blocker.
  await expect(screen.getByLabel("Exit 1 name", { exact: true })).toHaveValue("ready-for-review");
  const renamed = await readAgentDefinition(app.baseUrl, agentId);
  assert.equal(renamed.exits[0]!.id, agent.exits[0]!.id);
  await app.screenshot("agent-exits-saved");
  await browser.setViewport({ width: 900, height: 1100 });
  await screen.getByRole("table", "Agent exits").scrollIntoView();
  await app.screenshot("agent-exits-narrow");
  await browser.setViewport({ width: 1440, height: 1100 });
  await app.open(`/studio/flows/${created.value.id}`);
  await expect(
    screen.getByRole("button", "Connection ready-for-review from Implementer to Review"),
  ).toBeVisible();
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  await app.screenshot("agent-exit-renamed-wire");
  await screen.getByRole("link", "Agents", { exact: true }).tap();
  await screen.getByRole("link", /Exit journey worker/).tap();
  await screen.getByRole("button", "Remove exit ready-for-review", { exact: true }).tap();
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectSavedAgentRevision(screen, 3);
  await expect(screen.getByLabel("Exit 1 name", { exact: true })).toHaveValue("changes-needed");
  await expect(
    screen.getByRole("switch", "Exit 1 message required", { exact: true }),
  ).toBeChecked();
  await screen.getByRole("link", "Flows", { exact: true }).tap();
  await screen.getByRole("link", /Agent exit journey/).tap();
  await expectFlowBlocked(screen, /Implementer: its Agent no longer has exit "ready-for-review"/);
  const retained = (await (await fetch(flowEndpoint)).json()) as Result<FlowDraft>;
  assert(retained.ok);
  assert.deepEqual(retained.value.graph.connections, saved.value.graph.connections);
  await app.screenshot("agent-exit-removed-readiness");
});

test("the Flow header's Save is filled once the Flow has unsaved changes", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const name = `Header unsaved state ${crypto.randomUUID()}`;
  await openStudioFlowCopy({ app, screen, browser }, name);

  // Act
  await screen.getByLabel("Flow name").fill(`${name} edited`);

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toHaveText("Unsaved changes");
  await expectSaveFilled(screen);
  await app.screenshot("flow-header-unsaved");
});

test("the Flow header's Save turns neutral and disabled once the Flow is saved", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openEditedStudioFlow({ app, screen, browser }, `Header saved state ${crypto.randomUUID()}`);

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectFlowSaved(screen);
  await expectSaveNeutral(screen);
  await app.screenshot("flow-header-saved");
});

test("the Flow header's Save stays neutral and disabled while the Flow name is blank", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openStudioFlowCopy({ app, screen, browser }, `Header blank name ${crypto.randomUUID()}`);

  // Act
  await screen.getByLabel("Flow name").fill("");

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toHaveText("Unsaved changes");
  await expectSaveNeutral(screen);
});

test("the Flow header's Save stays neutral and disabled while Studio is offline", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const name = `Header offline ${crypto.randomUUID()}`;
  await browser.setViewport({ width: 1600, height: 1000 });
  const id = await saveFlowCopy(app.baseUrl, "Demo · Grill, spec and tickets", name, {
    mode: "checkout",
  });
  await openRemoteBrowser(app);
  await openApproved(app, `/studio/flows/${id}`);
  await expect(screen.getByLabel("Flow name")).toHaveValue(name);
  await fixture.remoteAccess.offline();

  // Act
  await screen.getByLabel("Flow name").fill(`${name} edited`);

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toHaveText("Unsaved changes");
  await expectSaveNeutral(screen);
  await app.screenshot("flow-header-offline-unsaved");
});

test("the Flow header's Save turns neutral when the Flow is removed elsewhere during its save", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const name = `Header removed while saving ${crypto.randomUUID()}`;
  const id = await openEditedStudioFlow({ app, screen, browser }, name);
  const releaseSave = await startHeldSave(browser, screen, `/api/flows/${id}`);

  // Act
  await removeFlowElsewhere(app.baseUrl, id);

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toHaveText(
    "Removed elsewhere · draft kept",
  );
  await expectSaveNeutral(screen);
  await app.screenshot("flow-header-removed-while-saving");
  releaseSave();
});

test("removing a Flow with unsaved changes returns to the Flow list without a discard dialog", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const name = `Removal navigation ${crypto.randomUUID()}`;
  const id = await saveFlowCopy(app.baseUrl, "Demo · Focused change", name, { mode: "checkout" });
  await app.open(`/studio/flows/${id}`);
  await screen.getByLabel("Flow name").fill(`${name} edited`);
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Unsaved changes");
  await chooseFlowAction(screen, "Remove");
  const confirmation = screen.getByRole("dialog", `Remove “${name} edited”?`);
  await expect(confirmation).toContainText("Removing this Flow discards your unsaved edits");

  // Act
  await confirmation.getByRole("button", "Remove Flow", { exact: true }).tap();

  // Assert
  await expect(browser).toHaveURL(/\/studio\/flows$/);
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  await expect(screen.getByRole("dialog", "Discard unsaved changes?")).toHaveCount(0);
  await expect(screen.getByRole("link", new RegExp(name))).toHaveCount(0);
});

test("an exported Flow imported through the review arrives as a new Flow with a new Agent", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: a saved Flow with Continuations and a custom worktree ref, then unsaved edits.
  await browser.setViewport({ width: 1600, height: 1000 });
  const name = `Export journey ${crypto.randomUUID().slice(0, 8)}`;
  const workspace = { mode: "worktree", base: { kind: "ref", ref: "release/2.0" } } as const;
  const id = await saveFlowCopy(app.baseUrl, "Demo · Grill, spec and tickets", name, workspace);
  const source = (await (
    await fetch(new URL(`/api/flows/${id}`, app.baseUrl))
  ).json()) as Result<FlowDraft>;
  assert(source.ok);
  await app.open(`/studio/flows/${id}`);
  await screen.getByLabel("Flow name").fill(`${name} edited`);
  await chooseFlowAction(screen, "Export JSON");
  const confirmation = screen.getByRole("dialog", "Export the saved revision?");
  await expect(confirmation).toContainText("Unsaved changes won't be included.");
  const download = await browser.waitForDownload(() =>
    confirmation.getByRole("button", "Export saved revision", { exact: true }).tap(),
  );
  const exported = JSON.parse(
    await readFile(download.absolutePath, "utf8"),
  ) as PortableFlowDocument;
  await flowsBreadcrumb(screen).tap();
  await screen.getByRole("button", "Discard changes", { exact: true }).tap();

  // Act: import the file through the review and confirm.
  await screen
    .getByLabel("Choose an AgentEasel export file")
    .setInputFiles([download.absolutePath]);
  const review = screen.getByRole("dialog", /^Import “/);
  await expect(review).toContainText(name);
  await expect(review).toContainText("Imported prompts run with your T3 Code permissions");
  await expect(review).toContainText("Read them in Studio before you start a Run.");
  await browser.evaluate(
    "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished)).then(() => null)",
  );
  await app.screenshot("flow-import-review");
  await browser.setViewport({ width: 560, height: 1000 });
  await review.getByRole("group", "Demo · Product engineer").scrollIntoView();
  await app.screenshot("flow-import-review-narrow");
  await browser.setViewport({ width: 1600, height: 1000 });
  await review.getByRole("button", "Import", { exact: true }).tap();

  // Assert: the file holds the saved revision; the imported Flow opens with its own new Agent.
  assert.equal(download.suggestedFilename, `${name.toLowerCase().replaceAll(" ", "-")}.flow.json`);
  assert.equal(exported.flows[0]?.name, name);
  assert.equal(exported.agents.length, 1);
  await expect(screen.getByLabel("Flow name")).toHaveValue(name);
  await expect(screen.getByRole("article", "Block Tickets")).toBeVisible();
  const importedId = new URL(await browser.url()).pathname.split("/").at(-1)!;
  assert.notEqual(importedId, id);
  const imported = (await (
    await fetch(new URL(`/api/flows/${importedId}`, app.baseUrl))
  ).json()) as Result<FlowDraft>;
  assert(imported.ok);
  assert.deepEqual(imported.value.workspace, workspace);
  assert.deepEqual(
    imported.value.graph.blocks.map((block) => block.id),
    source.value.graph.blocks.map((block) => block.id),
  );
  assert.deepEqual(imported.value.graph.connections, source.value.graph.connections);
  const [sourceWorker, importedWorker] = [source.value, imported.value].map((flow) =>
    flow.graph.blocks.find((block) => block.kind === "agent"),
  );
  assert(sourceWorker?.kind === "agent" && importedWorker?.kind === "agent");
  assert.notEqual(importedWorker.agentId, sourceWorker.agentId);
  const agent = await readAgentDefinition(app.baseUrl, importedWorker.agentId!);
  assert.equal(agent.name, exported.agents[0]!.name);
  await app.screenshot("flow-imported");
});

test("authoring wires start and end at their port centres while a block is selected", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const block = await openFittedFlowBlock({ app, screen, browser }, worktreeImplementBlock);

  // Act
  await block.selectByName();

  // Assert
  await expect.poll(() => largestWirePortOffset(browser)).toBeLessThan(0.5);
  await app.screenshot("authoring-wires-meet-port-centres");
});

test("selecting an authoring block keeps it at the height its geometry reserves", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const block = await openFittedFlowBlock({ app, screen, browser }, worktreeImplementBlock);
  const unselected = await block.height();

  // Act
  await block.selectByName();

  // Assert
  expect(await block.height()).toBe(unselected);
  await app.screenshot("selected-block-reserved-height");
});

test("a selected Human step keeps its dashed edge, reserved height and wire ends on its ports", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const step = await openFittedFlowBlock({ app, screen, browser }, releaseApprovalHumanStep);
  const unselected = await step.height();

  // Act
  await step.selectByName();

  // Assert
  expect(await step.outlineStyle()).toBe("dashed");
  expect(await step.height()).toBe(unselected);
  await expect.poll(() => largestWirePortOffset(browser)).toBeLessThan(0.5);
  await app.screenshot("selected-human-step");
});

test("leaving an edited Flow for another Studio page asks before discarding its edits", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const name = `Leave guard ${crypto.randomUUID().slice(0, 8)}`;
  const id = await openEditedStudioFlow({ app, screen, browser }, name);

  // Act
  await screen.getByRole("navigation", "Studio navigation").getByRole("link", "Agents").tap();

  // Assert
  await expect(screen.getByRole("dialog", "Discard unsaved changes?")).toBeVisible();
  await expect(browser).toHaveURL(`/studio/flows/${id}`);
});

test("a Flow reopened after discarding its edits on leaving shows its saved revision", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const name = `Leave discard ${crypto.randomUUID().slice(0, 8)}`;
  await openEditedStudioFlow({ app, screen, browser }, name);
  const studio = screen.getByRole("navigation", "Studio navigation");
  await studio.getByRole("link", "Flows").tap();
  await screen.getByRole("button", "Discard changes", { exact: true }).tap();

  // Act
  await screen.getByRole("link", new RegExp(`^${name} `)).tap();

  // Assert
  await expect(screen.getByLabel("Flow name")).toHaveValue(name);
});

/** A copy of Sample worker named `name` whose saved model T3 no longer offers. */
async function retiredModelAgent(baseUrl: string | undefined, name: string) {
  const agent = await copyAgentDefinition(baseUrl, "Sample worker", name);
  assert(agent.execution);
  await saveAgentElsewhere(baseUrl, agent, {
    execution: { ...agent.execution, modelId: "retired-model" },
  });
  return agent;
}

/** A new Flow whose Worker block places the saved Agent `agentName`, at a 1440×900 viewport. */
async function saveWorkerFlow(app: App, browser: Browser, flowName: string, agentName: string) {
  await browser.setViewport({ width: 1440, height: 900 });
  return saveSingleAgentFlow(app.baseUrl, flowName, agentName, {
    id: "worker",
    name: "Worker",
    x: 320,
    y: 60,
  });
}

/** A retired-model Agent, not placed, and a new Flow whose Worker block places Sample worker. */
async function retiredBesideWorkerFlow(app: App, browser: Browser) {
  const name = `Review · Retired model ${crypto.randomUUID().slice(0, 8)}`;
  await retiredModelAgent(app.baseUrl, name);
  return {
    name,
    flowId: await saveWorkerFlow(app, browser, "Review · Placement", "Sample worker"),
  };
}

const blockAgentPicker = (screen: Screen) =>
  screen.getByRole("complementary", "Block settings").getByRole("combobox", /^Agent: /);

test("a saved Agent with a retired model cannot be placed from the library", async ({
  app,
  browser,
}) => {
  // Arrange
  const { name, flowId } = await retiredBesideWorkerFlow(app, browser);

  // Act
  await app.open(`/studio/flows/${flowId}`);

  // Assert
  const retired = browser.locator(`#block-library [aria-label=${JSON.stringify(name)}]`);
  await retired.scrollIntoView();
  await expect(retired).toHaveAttribute("aria-disabled", "true");
  await expect(retired).toContainText("Needs a model");
  await app.screenshot("after-flow-library-retired-model");
});

test("a saved Agent with a retired model cannot be picked for a Block", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const { name, flowId } = await retiredBesideWorkerFlow(app, browser);
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Agent Worker").tap();

  // Act
  await blockAgentPicker(screen).tap();

  // Assert
  const option = screen.getByRole("option", new RegExp(name));
  await expect(option).toBeDisabled();
  await expect(option).toContainText("Needs a model");
  await app.screenshot("after-block-picker-retired-model");
});

test("a Block's configured Agent that needs a model stays checked, but not choosable, in the Agent list", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const run = crypto.randomUUID().slice(0, 8);
  const name = `Configured · Retired model ${run}`;
  await retiredModelAgent(app.baseUrl, name);
  const flowId = await saveWorkerFlow(app, browser, `Configured placement ${run}`, name);
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Agent Worker").tap();
  const picker = blockAgentPicker(screen);
  await expect(picker).toContainText(name);

  // Act
  await picker.tap();

  // Assert
  const option = screen.getByRole("option", `${name} Needs a model`, { exact: true });
  await expect(option).toBeDisabled();
  await expect(option).toHaveAttribute("data-state", "checked");
  await expect(option).toHaveAttribute("aria-selected", "true");
  await app.screenshot("after-block-picker-configured-retired-model");
});
