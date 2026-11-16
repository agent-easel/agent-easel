import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "./support/test.ts";
import { copyAgentDefinition, readAgentDefinition } from "./support/agents.ts";
import { readFlow, saveSingleAgentFlow } from "./support/flows.ts";
import type { StudioFixtures } from "./support/studio.ts";
import {
  changeAgentOwnerElsewhere,
  exportFlowFile,
  listFlows,
  namedAgent,
  ownedFlow,
  projectFlowPlacing,
} from "./support/owners.ts";

const viewport = { width: 1440, height: 900 };
const unique = () => crypto.randomUUID().slice(0, 8);
/** Settles dialog and menu transitions before a screenshot. */
const settled =
  "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished))";

/** A new global Agent open in Studio, and the id of the fixture's available Northwind Project. */
async function openGlobalAgent(
  { app, browser }: Pick<StudioFixtures, "app" | "browser">,
  label: string,
) {
  await browser.setViewport(viewport);
  const northwind = (await ownedFlow(app.baseUrl, "Northwind release")).projectId;
  const agent = await copyAgentDefinition(app.baseUrl, "Sample worker", `${label} ${unique()}`);
  await app.open(`/studio/agents/${agent.id}`);
  return { northwind, agent };
}

test("Change owner moves an Agent into a Project without a new revision, also after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { northwind, agent } = await openGlobalAgent({ app, browser }, "Owner move");
  await screen.getByRole("button", "Change owner…", { exact: true }).tap();
  const dialog = screen.getByRole("dialog", `Change owner of “${agent.name}”`);
  await dialog.getByRole("button", "New owner").tap();
  await screen.getByRole("menuitemradio", /^Northwind/).tap();
  await browser.evaluate(settled);
  await app.screenshot("change-owner-dialog");

  // Act
  await dialog.getByRole("button", "Change owner", { exact: true }).tap();

  // Assert
  await expect(dialog).toHaveCount(0);
  await expect(screen.getByText("Owned by Northwind", { exact: true })).toBeVisible();
  const moved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.equal(moved.projectId, northwind);
  assert.equal(moved.revision, agent.revision);
  await app.screenshot("change-owner-success");
  await app.open(`/studio/agents/${agent.id}`);
  await expect(screen.getByText("Owned by Northwind", { exact: true })).toBeVisible();
  await app.screenshot("change-owner-reload");
});

test("a refused Change owner names the blocking Flow and offers Duplicate into the target", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const agent = await copyAgentDefinition(app.baseUrl, "Sample worker", `Placed ${unique()}`);
  const flowName = `Global placing ${unique()}`;
  await saveSingleAgentFlow(app.baseUrl, flowName, agent.name, {
    id: "worker",
    name: "Worker",
    x: 320,
    y: 120,
  });
  await app.open(`/studio/agents/${agent.id}`);
  await screen.getByRole("button", "Change owner…", { exact: true }).tap();
  await screen.getByRole("button", "New owner").tap();
  await screen.getByRole("menuitemradio", /^Northwind/).tap();

  // Act
  await screen.getByRole("button", "Change owner", { exact: true }).tap();

  // Assert
  const refusal = screen.getByRole("dialog", `Can’t make “${agent.name}” a Northwind Agent`);
  await expect(refusal.getByRole("list", "Blocking Flows")).toContainText(flowName);
  await expect(refusal).toContainText("Global Flow · Worker block");
  assert.equal((await readAgentDefinition(app.baseUrl, agent.id)).projectId, null);
  await browser.evaluate(settled);
  await app.screenshot("change-owner-refused");
  await refusal.getByRole("button", "Duplicate to Northwind…", { exact: true }).tap();
  const duplicate = screen.getByRole("dialog", `Duplicate “${agent.name}”`);
  await expect(duplicate.getByRole("button", "Target owner")).toContainText("Northwind");
  await browser.evaluate(settled);
  await app.screenshot("change-owner-refused-duplicate");
});

test("Flow Duplicate into Global keeps or copies global Agents, copies the Project's, and opens the copy", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const source = await ownedFlow(app.baseUrl, "Northwind release");
  const shared = await copyAgentDefinition(app.baseUrl, "Sample worker", `Shared ${unique()}`);
  const qa = await namedAgent(app.baseUrl, "Northwind QA");
  const flow = await projectFlowPlacing(app.baseUrl, `Release ${unique()}`, source.projectId!, [
    shared,
    qa,
  ]);
  await app.open(`/studio/flows/${flow.id}`);
  await screen.getByRole("button", "More Flow actions").tap();
  await screen.getByRole("menuitem", "Duplicate…").tap();
  const dialog = screen.getByRole("dialog", `Duplicate “${flow.name}”`);
  await dialog.getByRole("button", "Target owner").tap();
  await screen.getByRole("menuitemradio", /^Global/).tap();
  await expect(
    dialog.getByRole("radiogroup", shared.name).getByRole("radio", "Keep shared"),
  ).toBeChecked();
  await expect(dialog).toContainText("Copied into target");
  await dialog.getByRole("radiogroup", shared.name).getByRole("radio", "Copy").tap();
  await expect(dialog).toContainText("Creates 1 Flow and 2 Agents as global definitions.");
  await browser.evaluate(settled);
  await app.screenshot("flow-duplicate-plan");

  // Act
  await dialog.getByRole("button", "Duplicate", { exact: true }).tap();

  // Assert
  await expect(screen.getByLabel("Flow name")).toHaveValue(`${flow.name} copy`);
  const copyId = new URL(await browser.url()).pathname.split("/").at(-1)!;
  const copy = await readFlow(app.baseUrl, copyId);
  assert.equal(copy.projectId, null);
  const placed = copy.graph.blocks.flatMap((block) =>
    block.kind === "agent" ? [block.agentId] : [],
  );
  assert.equal(placed.length, 2);
  assert(!placed.includes(shared.id) && !placed.includes(qa.id));
  assert.deepEqual((await readFlow(app.baseUrl, flow.id)).graph, flow.graph);
  await app.screenshot("flow-duplicate-opened");
});

test("Import creates the file's definitions in the chosen target Project", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const northwind = await ownedFlow(app.baseUrl, "Northwind release");
  const file = await exportFlowFile(app.baseUrl, northwind);
  await app.open("/studio/flows");
  await screen.getByLabel("Choose a Factory export file").setInputFiles([file]);
  const review = screen.getByRole("dialog", "Review the import");
  await expect(review.getByRole("button", "Target owner")).toContainText("Global");
  await review.getByRole("button", "Target owner").tap();
  await screen.getByRole("menuitemradio", /^Northwind/).tap();
  await browser.evaluate(settled);
  await app.screenshot("import-target");
  const before = new Set((await listFlows(app.baseUrl)).map((flow) => flow.id));

  // Act
  await review.getByRole("button", "Confirm import", { exact: true }).tap();

  // Assert
  await expect(screen.getByLabel("Flow name")).toHaveValue("Northwind release");
  const imported = (await listFlows(app.baseUrl)).filter((flow) => !before.has(flow.id));
  assert.equal(imported.length, 1);
  assert.equal(imported[0]!.projectId, northwind.projectId);
  await app.screenshot("import-target-opened");
});

test("a Flow of an unavailable Project is rescued by duplicating it and its Agent into another Project", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const northwind = (await ownedFlow(app.baseUrl, "Northwind release")).projectId;
  const source = await ownedFlow(app.baseUrl, "Docs refresh");
  await app.open(`/studio/flows/${source.id}`);
  await expect(screen.getByText("Docs site is unavailable — this Flow can’t start")).toBeVisible();
  await app.screenshot("rescue-banner");
  await screen.getByRole("button", "Duplicate to…", { exact: true }).tap();
  const dialog = screen.getByRole("dialog", "Duplicate “Docs refresh”");
  await expect(dialog.getByText(/Choose Global or an available Project\./)).toBeVisible();
  await expect(dialog.getByRole("button", "Duplicate", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", "Target owner").tap();
  await screen.getByRole("menuitemradio", /^Northwind/).tap();
  await expect(dialog).toContainText("Docs site Agent · can’t be placed in Northwind");
  await browser.evaluate(settled);
  await app.screenshot("rescue-plan");

  // Act
  await dialog.getByRole("button", "Duplicate", { exact: true }).tap();

  // Assert
  await expect(screen.getByLabel("Flow name")).toHaveValue("Docs refresh copy");
  const copy = await readFlow(
    app.baseUrl,
    new URL(await browser.url()).pathname.split("/").at(-1)!,
  );
  assert.equal(copy.projectId, northwind);
  assert.equal((await readFlow(app.baseUrl, source.id)).projectId, source.projectId);
  await expect(screen.getByText("Docs site is unavailable — this Flow can’t start")).toHaveCount(0);
  await app.screenshot("rescue-opened");
});

test("a dirty Agent editor acknowledges an owner changed elsewhere before saving, keeping its edits", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { northwind, agent } = await openGlobalAgent({ app, browser }, "Dirty owner");
  await screen.getByLabel("Prompt", { exact: true }).fill("Edited while the owner moves.");
  await changeAgentOwnerElsewhere(app.baseUrl, agent, northwind);
  const notice = screen.getByRole("status", "Owner changed elsewhere");
  await expect(notice).toContainText("This Agent is now owned by Northwind");
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Edited while the owner moves.",
  );
  await app.screenshot("dirty-owner-notice");

  // Act
  await notice.getByRole("button", "Acknowledge new owner", { exact: true }).tap();
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect(notice).toHaveCount(0);
  await expect(screen.getByText("Agent definition · rev 2", { exact: true })).toBeVisible();
  const saved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.equal(saved.prompt, "Edited while the owner moves.");
  assert.equal(saved.projectId, northwind);
  await app.open(`/studio/agents/${agent.id}`);
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Edited while the owner moves.",
  );
  await expect(screen.getByText("Owned by Northwind", { exact: true })).toBeVisible();
  await app.screenshot("dirty-owner-reload");
});
