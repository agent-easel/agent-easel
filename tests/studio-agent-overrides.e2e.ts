import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "./support/test.ts";
import type { ProjectCatalog, Result } from "../packages/contracts/src/index.ts";
import {
  copyAgentDefinition,
  listAgentDefinitions,
  readAgentDefinition,
} from "./support/agents.ts";
import { changeAgentOwnerElsewhere, ownedFlow } from "./support/owners.ts";
import { expectSavedAgentRevision } from "./support/studio.ts";
import type { StudioFixtures } from "./support/studio.ts";

const viewport = { width: 1440, height: 900 };
/** Settles dialog and menu transitions before a screenshot. */
const settled =
  "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished))";

/**
 * A new global Agent open in Studio with the Override for a Project dialog, opened from its model
 * picker, choosing Northwind, and the id of the fixture's available Northwind Project.
 */
async function overrideDialogForNorthwind(
  { app, screen, browser }: Pick<StudioFixtures, "app" | "screen" | "browser">,
  label: string,
) {
  await browser.setViewport(viewport);
  const northwind = (await ownedFlow(app.baseUrl, "Northwind release")).projectId;
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `${label} ${crypto.randomUUID().slice(0, 8)}`,
  );
  await app.open(`/studio/agents/${agent.id}`);
  await screen.getByRole("button", /^Worker: /).tap();
  await screen.getByRole("button", "Override for a Project…", { exact: true }).tap();
  const dialog = screen.getByRole("dialog", "Override for a Project");
  await dialog.getByRole("button", /^Project:/).tap();
  await screen.getByRole("menuitemradio", "Northwind", { exact: true }).tap();
  return { northwind, agent, dialog };
}

test("a global Agent saved with a Project override keeps it in its editor and list, also after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { northwind, agent, dialog } = await overrideDialogForNorthwind(
    { app, screen, browser },
    "Override",
  );
  await dialog.getByRole("button", /^Model:/).tap();
  await screen.getByRole("menuitemradio", "GPT 6 Astra", { exact: true }).tap();
  await browser.evaluate(settled);
  await app.screenshot("override-dialog");
  await dialog.getByRole("button", "Apply", { exact: true }).tap();

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  const picker = screen.getByRole("button", /^Worker: /);
  const overrides = screen.getByRole("list", "Project overrides");
  await picker.tap();
  await expect(overrides.getByText("Northwind", { exact: true })).toBeVisible();
  // A screen reader hears the override's Worker on its row, not only the Project.
  await expect(
    overrides.getByRole("button", /^Edit override for Northwind: .*GPT 6 Astra/),
  ).toBeVisible();
  const saved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.equal(saved.revision, agent.revision + 1);
  assert.deepEqual(
    saved.projectOverrides.map((override) => [override.projectId, override.execution.modelId]),
    [[northwind, "gpt-6-astra"]],
  );
  await app.open(`/studio/agents/${agent.id}`);
  await picker.tap();
  await expect(overrides.getByText("Northwind", { exact: true })).toBeVisible();
  await expect(screen.getByText(/\+1 Project override/).first()).toBeVisible();
  await app.screenshot("override-saved-after-reload");
});

test("unsaved Project overrides of an Agent moved to a Project elsewhere stay visible and block Save until removed", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { northwind, agent, dialog } = await overrideDialogForNorthwind(
    { app, screen, browser },
    "Stranded",
  );
  await dialog.getByRole("button", "Apply", { exact: true }).tap();
  await changeAgentOwnerElsewhere(app.baseUrl, agent, northwind);
  await screen
    .getByRole("status", "Owner changed elsewhere")
    .getByRole("button", "Acknowledge new owner", { exact: true })
    .tap();
  const stranded = screen.getByRole("alert", "Project overrides this Agent cannot keep");
  await expect(stranded).toContainText("Northwind");
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await browser.evaluate(settled);
  await app.screenshot("stranded-overrides");

  // Act
  await stranded.getByRole("button", "Remove Project overrides from draft", { exact: true }).tap();

  // Assert
  // The owner move is already saved. Dropping the unsaved override leaves nothing to save.
  await expect(stranded).toHaveCount(0);
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await expectSavedAgentRevision(screen, agent.revision);
  const saved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.equal(saved.revision, agent.revision);
  assert.equal(saved.projectId, northwind);
  assert.deepEqual(saved.projectOverrides, []);
});

test("removing an override while every available Project has one moves focus to Override for a Project…", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: an override for every available Project, so Override for a Project… starts disabled.
  await browser.setViewport(viewport);
  const response = await fetch(new URL("/api/projects", app.baseUrl));
  const catalog = (await response.json()) as Result<ProjectCatalog>;
  assert(catalog.ok);
  const available = catalog.value.projects.filter(
    (project) => project.availability === "available",
  );
  const sample = (await listAgentDefinitions(app.baseUrl)).find(
    (agent) => agent.name === "Sample worker",
  );
  assert(sample?.execution);
  const execution = sample.execution;
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Every Project ${crypto.randomUUID().slice(0, 8)}`,
    { projectOverrides: available.map((project) => ({ projectId: project.id, execution })) },
  );
  await app.open(`/studio/agents/${agent.id}`);
  await screen.getByRole("button", /^Worker: /).tap();
  await expect(screen.getByRole("button", /^Override for a Project…/)).toBeDisabled();
  const removed = available[0]!;
  await screen.getByRole("button", `Remove override for ${removed.title}`, { exact: true }).focus();

  // Act
  await browser.keyboard.press("Enter");

  // Assert
  const add = screen.getByRole("button", "Override for a Project…", { exact: true });
  await expect(add).toBeEnabled();
  await expect(add).toBeFocused();
});
