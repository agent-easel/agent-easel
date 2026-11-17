import assert from "node:assert/strict";
import { expect } from "e2e";
import { test } from "./support/test.ts";
import { copyAgentDefinition, readAgentDefinition } from "./support/agents.ts";
import { ownedFlow } from "./support/owners.ts";

const viewport = { width: 1440, height: 900 };
/** Settles dialog and menu transitions before a screenshot. */
const settled =
  "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished))";

test("a global Agent saved with a Project override keeps it in its editor and list, also after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const northwind = (await ownedFlow(app.baseUrl, "Northwind release")).projectId;
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Override ${crypto.randomUUID().slice(0, 8)}`,
  );
  await app.open(`/studio/agents/${agent.id}`);
  await screen.getByRole("button", "Override for a Project").tap();
  const dialog = screen.getByRole("dialog", "Override for a Project");
  await dialog.getByRole("button", /^Project:/).tap();
  await screen.getByRole("menuitemradio", "Northwind", { exact: true }).tap();
  await dialog.getByRole("button", /^Model:/).tap();
  await screen.getByRole("menuitemradio", "GPT 6 Astra", { exact: true }).tap();
  await browser.evaluate(settled);
  await app.screenshot("override-dialog");
  await dialog.getByRole("button", "Apply", { exact: true }).tap();

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  const overrides = screen.getByRole("table", "Project overrides");
  await expect(overrides.getByText("Northwind", { exact: true })).toBeVisible();
  const saved = await readAgentDefinition(app.baseUrl, agent.id);
  assert.equal(saved.revision, agent.revision + 1);
  assert.deepEqual(
    saved.projectOverrides.map((override) => [override.projectId, override.execution.modelId]),
    [[northwind, "gpt-6-astra"]],
  );
  await app.open(`/studio/agents/${agent.id}`);
  await expect(overrides.getByText("Northwind", { exact: true })).toBeVisible();
  await expect(screen.getByText(/\+1 Project override/).first()).toBeVisible();
  await app.screenshot("override-saved-after-reload");
});
