import { beforeEach, test } from "./support/test.ts";
import { saveAgentElsewhere } from "./support/agents.ts";
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
  expectAgentLoadConfirmation,
  beforeAgentLoadConfirmation,
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
  const state = await beforeAgentComparison({ app, screen, browser }, "agentComparison");
  const { panel } = state;

  // Act
  await panel.getByRole("button", "Compare latest revision", { exact: true }).tap();

  // Assert
  await expectAgentComparison({ ...state });
});

test("keeping Agent edits against a saved revision sends no implicit save", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeKeptAgentEdits({ app, screen, browser }, "keptAgentEdits");
  const { panel } = state;

  // Act
  await panel.getByRole("button", "Keep my edits against revision 2", { exact: true }).tap();

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

test("Load latest revision asks for confirmation with Keep editing focused", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const state = await beforeAgentLoadConfirmation(
    { app, screen, browser },
    "agentLoadConfirmation",
  );
  const { panel } = state;

  // Act
  await panel.getByRole("button", "Load latest revision", { exact: true }).tap();

  // Assert
  await expectAgentLoadConfirmation({ ...state });
});

test("confirming Load latest revision replaces Agent edits with the saved revision", async ({
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
