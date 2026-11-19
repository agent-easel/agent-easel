import { expectSavedAgentRevision, openStudioAgent } from "./studio.ts";
import type { StudioFixtures } from "./studio.ts";
import { expect } from "e2e";
import { readAgentDefinition, saveAgentElsewhere } from "./agents.ts";
const editedPrompt = "Review the change and report only blocking problems.";
/** Prerequisite stages replay one continuous editor-open history; tested operations stay in the test Acts. */
export async function beforeCleanAgentRevision(fixtures: StudioFixtures, prefix: string) {
  const agent = await openStudioAgent(fixtures, `Live · ${prefix} · Clean Agent`);
  return { app: fixtures.app, screen: fixtures.screen, browser: fixtures.browser, prefix, agent };
}

export async function expectCleanAgentRevision(
  state: Awaited<ReturnType<typeof beforeCleanAgentRevision>>,
) {
  const { app, screen, prefix } = state;
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(
    `Live · ${prefix} · Clean Agent renamed`,
  );
  await expect(screen.getByText("Updated to revision 2", { exact: true })).toBeVisible();
  await expectSavedAgentRevision(screen, 2);
  await app.screenshot("agent-editor-updated-to-revision");
  return { ...state };
}

export async function beforeDirtyAgentRevision(fixtures: StudioFixtures, prefix: string) {
  const { screen } = fixtures;
  const agent = await openStudioAgent(fixtures, `Live · ${prefix} · Dirty Agent`);
  await screen.getByLabel("Prompt", { exact: true }).fill(editedPrompt);
  return { app: fixtures.app, screen: fixtures.screen, browser: fixtures.browser, prefix, agent };
}

export async function expectDirtyAgentRevision(
  state: Awaited<ReturnType<typeof beforeDirtyAgentRevision>>,
) {
  const { screen } = state;
  const panel = screen.getByText("Revision 2 was saved elsewhere", { exact: true });
  await expect(panel).toBeVisible();
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  return { ...state, panel };
}

export async function beforeAgentComparison(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeDirtyAgentRevision(fixtures, prefix);
  const { app, agent } = previous;
  await saveAgentElsewhere(app.baseUrl, agent, {
    name: `Live · ${prefix} · Dirty Agent renamed elsewhere`,
  });
  return expectDirtyAgentRevision({ ...previous });
}

export async function expectAgentComparison(
  state: Awaited<ReturnType<typeof beforeAgentComparison>>,
) {
  const { app, prefix, screen } = state;
  const comparison = screen.getByRole("dialog", "Compare with revision 2");
  await expect(comparison.getByLabel("Your draft", { exact: true })).toContainText(editedPrompt);
  await expect(comparison.getByLabel("Revision 2", { exact: true })).toContainText(
    `Name  Live · ${prefix} · Dirty Agent renamed elsewhere`,
  );
  // Display names only: the Worker reads as its provider, model and effort.
  await expect(comparison.getByLabel("Revision 2", { exact: true })).toContainText(
    "Worker  Codex · GPT 6.1 Sol · High",
  );
  await app.screenshot("agent-editor-compare-latest-revision");
  return { ...state };
}

export async function beforeKeptAgentEdits(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeAgentComparison(fixtures, prefix);
  await previous.screen.getByRole("button", "Compare latest revision", { exact: true }).tap();
  return expectAgentComparison({ ...previous });
}

export async function expectKeptAgentEdits(
  state: Awaited<ReturnType<typeof beforeKeptAgentEdits>>,
) {
  const { app, screen, agent, panel } = state;
  await expect(panel).toHaveCount(0);
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(editedPrompt);
  expect(await readAgentDefinition(app.baseUrl, agent.id)).toMatchObject({ revision: 2 });
  return { ...state };
}

export async function beforeSavedAgentEdits(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeKeptAgentEdits(fixtures, prefix);
  const { screen } = previous;
  await screen
    .getByRole("dialog", "Compare with revision 2")
    .getByRole("button", "Keep my edits", { exact: true })
    .tap();
  return expectKeptAgentEdits({ ...previous });
}

export async function expectSavedAgentEdits(
  state: Awaited<ReturnType<typeof beforeSavedAgentEdits>>,
) {
  const { app, screen, prefix, agent } = state;
  await expectSavedAgentRevision(screen, 3);
  const saved = await readAgentDefinition(app.baseUrl, agent.id);
  expect([saved.revision, saved.name, saved.prompt]).toEqual([
    3,
    `Live · ${prefix} · Dirty Agent`,
    editedPrompt,
  ]);
  await expect(screen.getByText(/was saved elsewhere/)).toHaveCount(0);
  return { ...state, saved };
}

export async function beforeReloadedAgentEdits(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeSavedAgentEdits(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Save", { exact: true }).tap();
  return expectSavedAgentEdits({ ...previous });
}

export async function expectReloadedAgentEdits(
  state: Awaited<ReturnType<typeof beforeReloadedAgentEdits>>,
) {
  const { screen } = state;
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(editedPrompt);
  return { ...state };
}

export async function beforeLoadedAgentRevision(fixtures: StudioFixtures, prefix: string) {
  const { app, screen } = fixtures;
  const agent = await openStudioAgent(fixtures, `Live · ${prefix} · Load Agent`);
  await screen.getByLabel("Prompt", { exact: true }).fill(editedPrompt);
  await saveAgentElsewhere(app.baseUrl, agent, {
    name: `Live · ${prefix} · Load Agent renamed elsewhere`,
  });
  const panel = screen.getByText("Revision 2 was saved elsewhere", { exact: true });
  await screen.getByRole("button", "Compare latest revision", { exact: true }).tap();
  await expect(screen.getByRole("dialog", "Compare with revision 2")).toBeVisible();
  return {
    app: fixtures.app,
    screen: fixtures.screen,
    browser: fixtures.browser,
    prefix,
    agent,
    panel,
  };
}

export async function expectLoadedAgentRevision(
  state: Awaited<ReturnType<typeof beforeLoadedAgentRevision>>,
) {
  const { screen, prefix, agent, panel } = state;
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(
    `Live · ${prefix} · Load Agent renamed elsewhere`,
  );
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(agent.prompt);
  await expect(panel).toHaveCount(0);
  // Loading the saved revision leaves a clean Agent, so Save stays neutral.
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  return { ...state };
}
