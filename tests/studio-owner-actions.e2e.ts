import assert from "node:assert/strict";
import { expect, type Screen } from "e2e";
import { test } from "./support/test.ts";
import {
  copyAgentDefinition,
  listAgentDefinitions,
  readAgentDefinition,
} from "./support/agents.ts";
import { readFlow, saveSingleAgentFlow } from "./support/flows.ts";
import {
  chooseAgentAction,
  chooseFlowAction,
  descriptionOf,
  expectSavedAgentRevision,
} from "./support/studio.ts";
import type { StudioFixtures } from "./support/studio.ts";
import {
  changeAgentOwnerElsewhere,
  exportDefinitionFile,
  listFlows,
  namedAgent,
  ownedFlow,
  projectFlowPlacing,
} from "./support/owners.ts";

const viewport = { width: 1440, height: 900 };
const unique = () => crypto.randomUUID().slice(0, 8);
/** Settles dialog and menu transitions before a screenshot. */
// allSettled: a focus transition that a later style change cancels rejects its `finished`.
const settled =
  "Promise.allSettled(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished)).then(() => null)";

/** The list beside the editor names an Agent's owner: its row sits in the `owner` group. */
async function expectListedUnder(screen: Screen, owner: string, name: string) {
  await expect(
    screen.getByRole("region", owner, { exact: true }).getByText(name, { exact: true }),
  ).toBeVisible();
}

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

test("Change owner moves an Agent into a Project without a new revision", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { northwind, agent } = await openGlobalAgent({ app, browser }, "Owner move");
  await chooseAgentAction(screen, "Change owner…");
  const dialog = screen.getByRole("dialog", `Change owner of “${agent.name}”`);
  await dialog.getByRole("combobox", "New owner").tap();
  await screen.getByRole("option", /^Northwind/).tap();
  await browser.evaluate(settled);
  await app.screenshot("change-owner-dialog");

  // Act
  await dialog.getByRole("button", "Change owner", { exact: true }).tap();

  // Assert
  await expect(dialog).toHaveCount(0);
  await expectListedUnder(screen, "Northwind", agent.name);
  const moved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.equal(moved.projectId, northwind);
  assert.equal(moved.revision, agent.revision);
  await app.screenshot("change-owner-success");
});

test("an Agent moved into a Project opens with that owner after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { northwind, agent } = await openGlobalAgent({ app, browser }, "Owner reload");
  await changeAgentOwnerElsewhere(app.baseUrl, agent, northwind);

  // Act
  await app.open(`/studio/agents/${agent.id}`);

  // Assert
  await expectListedUnder(screen, "Northwind", agent.name);
  await app.screenshot("change-owner-reload");
});

/** A global Agent placed by a global Flow, whose Change owner to Northwind was just refused. */
async function refusedChangeOwner({ app, screen, browser }: StudioFixtures) {
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
  await chooseAgentAction(screen, "Change owner…");
  await screen.getByRole("combobox", "New owner").tap();
  await screen.getByRole("option", /^Northwind/).tap();
  return { agent, flowName };
}

const refusalDialog = (screen: Screen, agent: { name: string }) =>
  screen.getByRole("dialog", `Can’t make “${agent.name}” a Northwind Agent`);

/** The refusal of that Change owner, shown. */
async function shownRefusal(fixtures: StudioFixtures) {
  const { agent } = await refusedChangeOwner(fixtures);
  await fixtures.screen.getByRole("button", "Change owner", { exact: true }).tap();
  return { agent, refusal: refusalDialog(fixtures.screen, agent) };
}

/** The Duplicate dialog that replaced that refusal. */
async function duplicateAfterRefusal(fixtures: StudioFixtures) {
  const { agent, refusal } = await shownRefusal(fixtures);
  await refusal.getByRole("button", "Duplicate to Northwind…", { exact: true }).tap();
  const duplicate = fixtures.screen.getByRole("dialog", `Duplicate “${agent.name}”`);
  await expect(duplicate).toBeVisible();
  return duplicate;
}

test("a refused Change owner names the blocking Flow and offers Duplicate into the target", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { agent, flowName } = await refusedChangeOwner({ app, screen, browser });

  // Act
  await screen.getByRole("button", "Change owner", { exact: true }).tap();

  // Assert
  const refusal = refusalDialog(screen, agent);
  await expect(refusal.getByRole("list", "Blocking Flows")).toContainText(flowName);
  await expect(refusal).toContainText("Global Flow · Worker block");
  await expect(
    refusal.getByRole("button", "Duplicate to Northwind…", { exact: true }),
  ).toBeVisible();
  assert.equal((await readAgentDefinition(app.baseUrl, agent.id)).projectId, null);
  await browser.evaluate(settled);
  await app.screenshot("change-owner-refused");
});

test("Duplicate from a refused Change owner targets that Project", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { agent, refusal } = await shownRefusal({ app, screen, browser });

  // Act
  await refusal.getByRole("button", "Duplicate to Northwind…", { exact: true }).tap();

  // Assert
  const duplicate = screen.getByRole("dialog", `Duplicate “${agent.name}”`);
  await expect(duplicate.getByRole("combobox", "Owning Project")).toContainText("Northwind");
  await browser.evaluate(settled);
  await app.screenshot("change-owner-refused-duplicate");
});

test("cancelling the Duplicate that replaced a refusal returns focus to More actions", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const duplicate = await duplicateAfterRefusal({ app, screen, browser });

  // Act
  await duplicate.getByRole("button", "Cancel", { exact: true }).tap();

  // Assert
  await expect(duplicate).toHaveCount(0);
  await expect(screen.getByRole("button", "More actions", { exact: true })).toBeFocused();
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
  await dialog.getByRole("radio", "Global", { exact: true }).tap();
  const sharedChoice = dialog.getByRole("radiogroup", shared.name);
  await expect(sharedChoice.getByRole("radio", "Keep shared")).toBeChecked();
  await expect(dialog).toContainText("Copied");
  await sharedChoice.getByRole("radio", "Copy").tap();
  await expect(sharedChoice.getByRole("radio", "Copy")).toBeChecked();
  await browser.evaluate(settled);
  await app.screenshot("flow-duplicate-plan");

  // Act
  await dialog.getByRole("button", "Duplicate", { exact: true }).tap();

  // Assert
  await expect(screen.getByLabel("Flow name")).toHaveValue(`${flow.name} copy`);
  const copyId = new URL(await browser.url()).pathname.split("/").at(-1)!;
  const copy = await readFlow(app.baseUrl, copyId);
  assert.equal(copy.projectId, null);
  const placed = copy.graph.blocks
    .filter((block) => block.kind === "agent")
    .map((block) => block.agentId);
  assert.equal(placed.length, 2);
  assert(!placed.includes(shared.id) && !placed.includes(qa.id));
  assert.deepEqual((await readFlow(app.baseUrl, flow.id)).graph, flow.graph);
  await app.screenshot("flow-duplicate-opened");
});

async function waitForImportedRoute(
  browser: StudioFixtures["browser"],
  review: ReturnType<Screen["getByRole"]>,
  kind: "flows" | "agents",
  before: ReadonlySet<string>,
) {
  await expect(review).toHaveCount(0);
  const pattern = new RegExp(`^/studio/${kind}/([^/]+)$`);
  await expect
    .poll(async () => {
      const id = pattern.exec(new URL(await browser.url()).pathname)?.[1];
      return Boolean(id && !before.has(id));
    })
    .toBe(true);
  const openedId = new URL(await browser.url()).pathname.split("/").at(-1)!;
  assert.ok(!before.has(openedId));
  return openedId;
}

test("Import creates the file's definitions in the chosen target Project", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const northwind = await ownedFlow(app.baseUrl, "Northwind release");
  const file = await exportDefinitionFile(app.baseUrl, "flow", northwind.id);
  await app.open("/studio/flows");
  // The list heading renders before the connection is current; a delivered row means it is.
  await expect(screen.getByRole("link", /Northwind release/)).toBeVisible();
  await screen.getByLabel("Choose a Factory export file").setInputFiles([file]);
  const review = screen.getByRole("dialog", /^Import “/);
  await review.getByRole("radio", "Project", { exact: true }).tap();
  await review.getByRole("combobox", "Owning Project", { exact: true }).tap();
  await screen.getByRole("option", /^Northwind/).tap();
  await browser.evaluate(settled);
  await app.screenshot("import-target");
  const before = new Set((await listFlows(app.baseUrl)).map((flow) => flow.id));

  // Act
  await review.getByRole("button", "Import", { exact: true }).tap();

  // Assert
  const openedFlowId = await waitForImportedRoute(browser, review, "flows", before);
  await expect(screen.getByLabel("Flow name")).toHaveValue("Northwind release");
  const imported = (await listFlows(app.baseUrl)).filter((flow) => !before.has(flow.id));
  assert.equal(imported.length, 1);
  assert.equal(imported[0]!.id, openedFlowId);
  assert.equal(imported[0]!.projectId, northwind.projectId);
  await app.screenshot("import-target-opened");
});

test("Import on the Agents list creates the file's Agent and opens it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const source = await copyAgentDefinition(app.baseUrl, "Sample worker", `Imported ${unique()}`);
  const file = await exportDefinitionFile(app.baseUrl, "agent", source.id);
  await app.open("/studio/agents");
  // A delivered row means the connection is current.
  await expect(screen.getByRole("link", source.name, { exact: false })).toBeVisible();
  // Records that Import… opens the file chooser; the test supplies the chosen file below.
  await browser.evaluate(
    `document.querySelector('input[aria-label="Choose a Factory export file"]').addEventListener("click", (event) => { event.preventDefault(); document.body.dataset.chooserOpened = "true"; }, { once: true })`,
  );
  const before = new Set((await listAgentDefinitions(app.baseUrl)).map((agent) => agent.id));

  // Act
  await app.screenshot("agents-import");
  await screen.getByRole("button", "Import", { exact: true }).tap();
  await screen.getByLabel("Choose a Factory export file").setInputFiles([file]);
  const review = screen.getByRole("dialog", /^Import “/);
  await review.getByRole("button", "Import", { exact: true }).tap();

  // Assert
  assert.equal(await browser.evaluate("document.body.dataset.chooserOpened"), "true");
  const openedId = await waitForImportedRoute(browser, review, "agents", before);
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(source.name);
  const imported = (await listAgentDefinitions(app.baseUrl)).filter(
    (agent) => !before.has(agent.id),
  );
  assert.equal(imported.length, 1);
  assert.equal(imported[0]!.id, openedId);
  assert.equal(imported[0]!.name, source.name);
});

test("an unavailable owner of a Duplicate is described by its title and then its problem", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const source = await ownedFlow(app.baseUrl, "Docs refresh");
  await app.open(`/studio/flows/${source.id}`);

  // Act
  await chooseFlowAction(screen, "Duplicate…");

  // Assert
  const dialog = screen.getByRole("dialog", "Duplicate “Docs refresh”");
  const owner = dialog.getByRole("combobox", "Owning Project", { exact: true });
  await expect(owner).toHaveAttribute("aria-invalid", "true");
  expect(await descriptionOf(browser, owner)).toMatch(
    /^Docs site .*Docs site: Project unavailable\. Choose Global or an available Project\.$/,
  );
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
  const gone = screen.getByText("Docs site is no longer in T3", { exact: true });
  await expect(gone).toBeVisible();
  await app.screenshot("rescue-banner");
  await chooseFlowAction(screen, "Duplicate…");
  const dialog = screen.getByRole("dialog", "Duplicate “Docs refresh”");
  await expect(dialog.getByRole("button", "Duplicate", { exact: true })).toBeDisabled();
  const owner = dialog.getByRole("combobox", "Owning Project", { exact: true });
  await expect(owner).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("Docs site: Project unavailable");
  await owner.tap();
  await screen.getByRole("option", /^Northwind/).tap();
  await expect(dialog).toContainText("Copied");
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
  await expect(gone).toHaveCount(0);
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
  const notice = screen.getByText("This Agent is now owned by Northwind", { exact: true });
  await expect(notice).toBeVisible();
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Edited while the owner moves.",
  );
  await app.screenshot("dirty-owner-notice");

  // Act
  await screen.getByRole("button", "Acknowledge new owner", { exact: true }).tap();
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect(notice).toHaveCount(0);
  await expectSavedAgentRevision(screen, 2);
  const saved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.equal(saved.prompt, "Edited while the owner moves.");
  assert.equal(saved.projectId, northwind);
  await app.open(`/studio/agents/${agent.id}`);
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Edited while the owner moves.",
  );
  await expectListedUnder(screen, "Northwind", agent.name);
  await app.screenshot("dirty-owner-reload");
});
