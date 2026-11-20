import assert from "node:assert/strict";
import { beforeEach, test } from "./support/test.ts";
import { expect } from "e2e";
import { copyAgentDefinition, readAgentDefinition, saveAgentElsewhere } from "./support/agents.ts";
import { namedAgent } from "./support/owners.ts";
import {
  chooseAgentAction,
  expectSaveFilled,
  expectSaveNeutral,
  expectSavedAgentRevision,
  openEditedStudioAgent,
  openStudioAgent,
} from "./support/studio.ts";
import {
  expectCleanAgentRevision,
  beforeCleanAgentRevision,
  expectDirtyAgentRevision,
  beforeDirtyAgentRevision,
  expectAgentComparison,
  beforeAgentComparison,
  expectKeptAgentEdits,
  beforeKeptAgentEdits,
  expectSavedAgentEdits,
  beforeSavedAgentEdits,
  expectReloadedAgentEdits,
  beforeReloadedAgentEdits,
  expectLoadedAgentRevision,
  beforeLoadedAgentRevision,
} from "./support/studio-editor-states.ts";
beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 1000 });
});

test("a clean open Agent editor switches to a revision saved elsewhere and says so", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeCleanAgentRevision({ app, screen, browser }, "cleanAgentRevision");
  const { prefix, agent } = state;

  // Act
  await saveAgentElsewhere(app.baseUrl, agent, { name: `Live · ${prefix} · Clean Agent renamed` });

  // Assert
  await expectCleanAgentRevision({ ...state });
});

test("a dirty Agent keeps its edits and refuses Save after an external revision", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeDirtyAgentRevision({ app, screen, browser }, "dirtyAgentRevision");
  const { prefix, agent } = state;

  // Act
  await saveAgentElsewhere(app.baseUrl, agent, {
    name: `Live · ${prefix} · Dirty Agent renamed elsewhere`,
  });

  // Assert
  await expectDirtyAgentRevision({ ...state });
});

test("Compare latest revision shows both the local Agent edits and the saved revision", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  const state = await beforeAgentComparison({ app, screen, browser }, "agentComparison");

  // Act
  await screen.getByRole("button", "Compare latest revision", { exact: true }).tap();

  // Assert
  await expectAgentComparison({ ...state });
  await app.screenshot("after-agent-revision-comparison");
});

test("keeping Agent edits against a saved revision sends no implicit save", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeKeptAgentEdits({ app, screen, browser }, "keptAgentEdits");
  const comparison = screen.getByRole("dialog", "Compare with revision 2");

  // Act
  await comparison.getByRole("button", "Keep my edits", { exact: true }).tap();

  // Assert
  await expectKeptAgentEdits({ ...state });
});

test("Save persists Agent edits against the chosen revision", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeSavedAgentEdits({ app, screen, browser }, "savedAgentEdits");

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectSavedAgentEdits({ ...state });
});

test("saved Agent edits survive reload", async ({ app, screen, browser }) => {
  // Arrange
  const state = await beforeReloadedAgentEdits({ app, screen, browser }, "reloadedAgentEdits");

  // Act
  await browser.reload();

  // Assert
  await expectReloadedAgentEdits({ ...state });
});

test("Load revision replaces Agent edits with the saved revision at once", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeLoadedAgentRevision({ app, screen, browser }, "loadedAgentRevision");

  // Act
  await screen.getByRole("button", "Load revision 2", { exact: true }).tap();

  // Assert
  await expectLoadedAgentRevision({ ...state });
});

test("closing a More actions dialog returns focus to More actions", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openStudioAgent({ app, screen, browser }, `Menu focus ${crypto.randomUUID().slice(0, 8)}`);
  await screen.getByLabel("Prompt", { exact: true }).fill("Unsaved prompt");
  await chooseAgentAction(screen, "Export JSON");
  const confirmation = screen.getByRole("dialog", "Export the saved revision?");
  await expect(confirmation).toBeVisible();

  // Act
  await confirmation.getByRole("button", "Keep editing", { exact: true }).tap();

  // Assert
  await expect(confirmation).toHaveCount(0);
  await expect(screen.getByRole("button", "More actions", { exact: true })).toBeFocused();
});

test("a Worker change made in the model picker marks the draft dirty and Save stores it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const agent = await openStudioAgent(
    { app, screen, browser },
    `Model picker ${crypto.randomUUID().slice(0, 8)}`,
  );
  const picker = screen.getByRole("button", "Worker: Codex · GPT 6.1 Sol · High", {
    exact: true,
  });
  await picker.tap();
  const settings = screen.getByRole("dialog", "Worker");
  await settings.getByRole("combobox", "Reasoning effort: High", { exact: true }).tap();
  await screen.getByRole("option", "Low", { exact: true }).tap();
  await expect(screen.getByText(/^Unsaved changes · Revision 1 · /)).toBeVisible();
  await settings.press("Escape");

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectSavedAgentRevision(screen, 2);
  await expect(
    screen.getByRole("button", "Worker: Codex · GPT 6.1 Sol · Low", { exact: true }),
  ).toBeVisible();
  const saved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.deepEqual(
    saved.execution?.modelOptions.find((option) => option.id === "reasoning"),
    { id: "reasoning", value: "low" },
  );
});

test("Escape closes only the model picker and returns focus to it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openStudioAgent(
    { app, screen, browser },
    `Picker focus ${crypto.randomUUID().slice(0, 8)}`,
  );
  const picker = screen.getByRole("button", /^Worker: /);
  await picker.tap();
  const settings = screen.getByRole("dialog", "Worker");
  await expect(settings.getByRole("combobox", /^Environment: /)).toBeFocused();

  // Act
  await settings.press("Escape");

  // Assert
  await expect(settings).toHaveCount(0);
  await expect(screen.getByRole("dialog", "Studio")).toBeVisible();
  await expect(picker).toBeFocused();
});

test("the Agent header's Save is filled once the Agent has unsaved changes", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openStudioAgent(
    { app, screen, browser },
    `Header unsaved state ${crypto.randomUUID().slice(0, 8)}`,
  );
  await expectSavedAgentRevision(screen, 1);

  // Act
  await screen.getByLabel("Prompt", { exact: true }).fill("Edited prompt");

  // Assert
  await expect(screen.getByText(/^Unsaved changes · Revision 1 · Unused$/)).toBeVisible();
  await expectSaveFilled(screen);
  await app.screenshot("agent-header-unsaved");
});

test("the Agent header's Save turns neutral and disabled once the Agent is saved", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openEditedStudioAgent(
    { app, screen, browser },
    `Header saved state ${crypto.randomUUID().slice(0, 8)}`,
  );

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectSavedAgentRevision(screen, 2);
  await expectSaveNeutral(screen);
  await app.screenshot("agent-header-saved");
});

test("a Project group heading in the Agents list says only that Project's Flows can place its Agents", async ({
  app,
  screen,
}) => {
  // Arrange
  const { projectId } = await namedAgent(app.baseUrl, "Northwind QA");
  const second = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Northwind second ${crypto.randomUUID().slice(0, 8)}`,
    { projectId },
  );
  await app.open("/studio/agents");
  const northwind = screen.getByRole("region", "Northwind", { exact: true });
  await expect(northwind.getByText(second.name, { exact: true })).toBeVisible();

  // Act
  await northwind.getByText("Northwind", { exact: true }).hover();

  // Assert
  await expect(screen.getByRole("tooltip")).toHaveText(
    "Only Northwind Flows can place these Agents.",
  );
  await app.screenshot("agents-placement-rule");
});

test("an open Project Agent stays listed under its Project while the search hides it", async ({
  app,
  screen,
}) => {
  // Arrange
  const agent = await namedAgent(app.baseUrl, "Northwind QA");
  await app.open(`/studio/agents/${agent.id}`);
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(agent.name);

  // Act
  await screen.getByLabel("Search Agents", { exact: true }).fill("Sample worker");

  // Assert
  const northwind = screen.getByRole("region", "Northwind", { exact: true });
  await expect(northwind.getByText(agent.name, { exact: true })).toBeVisible();
  await expect(screen.getByText("Launch worker", { exact: true })).toHaveCount(0);
  await northwind.getByText("Northwind", { exact: true }).hover();
  await expect(screen.getByRole("tooltip")).toHaveText(
    "Only Northwind Flows can place this Agent.",
  );
  await app.screenshot("agents-open-agent-kept-in-search");
});
