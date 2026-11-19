import { chooseAgentAction, expectRetainedDefinition, openStudioAgent } from "./studio.ts";
import type { StudioFixtures } from "./studio.ts";
import { expect } from "e2e";
import { copyAgentDefinition, removeAgentElsewhere } from "./agents.ts";
/** Prerequisite stages replay one continuous editor-open history; tested operations stay in the test Acts. */
export async function beforeRetainedCleanAgent(fixtures: StudioFixtures, prefix: string) {
  const { screen } = fixtures;
  const agent = await openStudioAgent(fixtures, `Removal · ${prefix} · Retained Agent`);
  await chooseAgentAction(screen, "Remove");
  await expect(
    screen.getByRole("dialog", `Remove “${agent.name}”?`, { exact: true }),
  ).toBeVisible();
  return { app: fixtures.app, screen: fixtures.screen, browser: fixtures.browser, prefix, agent };
}

export async function expectRetainedCleanAgent(
  state: Awaited<ReturnType<typeof beforeRetainedCleanAgent>>,
) {
  const { app, screen, browser, agent } = state;
  await expect(screen.getByRole("dialog", `Remove “${agent.name}”?`, { exact: true })).toHaveCount(
    0,
  );
  await expect(browser).toHaveURL(`/studio/agents/${agent.id}`);
  // Save and More actions are disabled as a whole while the Agent no longer exists.
  await expectRetainedDefinition(screen, "Agent", ["Save", "More actions"]);
  await app.screenshot("agent-removed-retained");
  return { ...state };
}

export async function beforeCleanAgentGuard(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeRetainedCleanAgent(fixtures, prefix);
  const { app, agent } = previous;
  await removeAgentElsewhere(app.baseUrl, agent.id);
  return expectRetainedCleanAgent({ ...previous });
}

export async function expectCleanAgentGuard(
  state: Awaited<ReturnType<typeof beforeCleanAgentGuard>>,
) {
  const { app, screen, browser } = state;
  const guard = screen.getByRole(
    "dialog",
    "This Agent was removed elsewhere. Discard the retained draft?",
    { exact: true },
  );
  await expect(guard).toBeVisible();
  await browser.evaluate(
    "Promise.allSettled(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished)).then(() => null)",
  );
  await app.screenshot("agent-removed-discard-confirmation");
  return { ...state, guard };
}

export async function beforeKeptCleanAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeCleanAgentGuard(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  return expectCleanAgentGuard({ ...previous });
}

export async function expectKeptCleanAgent(
  state: Awaited<ReturnType<typeof beforeKeptCleanAgent>>,
) {
  const { screen, agent } = state;
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(agent.name);
  return { ...state };
}

export async function beforeDiscardedCleanAgent(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeKeptCleanAgent(fixtures, prefix);
    const { guard } = previous;
    await guard.getByRole("button", "Keep editing", { exact: true }).tap();
    return expectKeptCleanAgent({ ...previous });
  })();
  const { screen } = state;
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  return { ...state };
}

export async function expectDiscardedCleanAgent(
  state: Awaited<ReturnType<typeof beforeDiscardedCleanAgent>>,
) {
  const { screen } = state;
  await expect(screen.getByRole("button", "Back to Runs", { exact: true })).toHaveCount(0);
  return { ...state };
}

export async function beforeMissingRemovedAgent(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeDiscardedCleanAgent(fixtures, prefix);
  const { guard } = previous;
  await guard.getByRole("button", "Discard", { exact: true }).tap();
  return expectDiscardedCleanAgent({ ...previous });
}

export async function expectMissingRemovedAgent(
  state: Awaited<ReturnType<typeof beforeMissingRemovedAgent>>,
) {
  const { screen } = state;
  await expect(screen.getByText("Agent not found", { exact: true })).toBeVisible();
  return { ...state };
}

export async function beforeRemovedAgentBackList(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeMissingRemovedAgent(fixtures, prefix);
  const { app, agent } = previous;
  await app.open(`/studio/agents/${agent.id}`);
  return expectMissingRemovedAgent({ ...previous });
}

export async function expectRemovedAgentBackList(
  state: Awaited<ReturnType<typeof beforeRemovedAgentBackList>>,
) {
  const { browser, screen } = state;
  // An Agents URL with no id selects the first Agent, so the list never stays on /studio/agents.
  await expect(browser).toHaveURL(/\/studio\/agents\/[^/]+$/);
  await expect(screen.getByRole("heading", "Agents", { exact: true })).toBeVisible();
  await expect(screen.getByText("Agent not found", { exact: true })).toHaveCount(0);
  return { ...state };
}

export async function beforeCopiedEditedAgent(fixtures: StudioFixtures, prefix: string) {
  const { app, screen, browser } = fixtures;
  const agent = await openStudioAgent(fixtures, `Removal · ${prefix} · Clipboard Agent`);
  await removeAgentElsewhere(app.baseUrl, agent.id);
  await expect(screen.getByRole("button", "Copy as JSON", { exact: true })).toBeVisible();
  await screen.getByLabel("Prompt", { exact: true }).fill("Recover these unfinished edits.");
  await browser.evaluate(
    "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedAgentJson = text; } } })",
  );
  return { app: fixtures.app, screen: fixtures.screen, browser: fixtures.browser, prefix, agent };
}

export async function expectCopiedEditedAgent(
  state: Awaited<ReturnType<typeof beforeCopiedEditedAgent>>,
) {
  const { app, screen, browser, agent } = state;
  await expect(screen.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  const copied = await browser.evaluate("JSON.parse(window.copiedAgentJson)");
  expect(copied).toEqual({
    name: agent.name,
    prompt: "Recover these unfinished edits.",
    execution: agent.execution,
    exits: agent.exits,
    projectOverrides: agent.projectOverrides,
  });
  await app.screenshot("agent-removed-json-copied");
  return { ...state, copied };
}

export async function beforeAgentJsonFallback(fixtures: StudioFixtures, prefix: string) {
  const { app, screen, browser } = fixtures;
  const agent = await copyAgentDefinition(
    app.baseUrl,
    "Sample worker",
    `Removal · ${prefix} · Fallback Agent`,
  );
  await app.open("/studio/agents");
  await screen.getByRole("link", agent.name, { exact: false }).tap();
  await screen.getByLabel("Prompt", { exact: true }).fill("Keep my recovery edits");
  await removeAgentElsewhere(app.baseUrl, agent.id);
  await expect(screen.getByRole("button", "Copy as JSON", { exact: true })).toBeVisible();
  await browser.evaluate(
    "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } })",
  );
  return { app: fixtures.app, screen: fixtures.screen, browser: fixtures.browser, prefix, agent };
}

export async function expectAgentJsonFallback(
  state: Awaited<ReturnType<typeof beforeAgentJsonFallback>>,
) {
  const { screen, agent } = state;
  const json = screen.getByRole("textbox", "Agent draft JSON", { exact: true });
  await expect(json).toBeVisible();
  await expect(json).toHaveAttribute("readonly", "");
  await expect(json).toHaveValue(
    JSON.stringify(
      {
        name: agent.name,
        prompt: "Keep my recovery edits",
        execution: agent.execution,
        exits: agent.exits,
        projectOverrides: agent.projectOverrides,
      },
      null,
      2,
    ),
  );
  return { ...state, json };
}

export async function beforeSelectedAgentJson(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeAgentJsonFallback(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();
  return expectAgentJsonFallback({ ...previous });
}

export async function expectSelectedAgentJson(
  state: Awaited<ReturnType<typeof beforeSelectedAgentJson>>,
) {
  const { app, browser } = state;
  expect(
    await browser.evaluate(
      "(() => { const field = document.activeElement; return field.selectionEnd - field.selectionStart === field.value.length; })()",
    ),
  ).toBe(true);
  await app.screenshot("agent-removed-json-fallback");
  return { ...state };
}

export async function beforeDeletedOwnAgent(fixtures: StudioFixtures, prefix: string) {
  const { screen } = fixtures;
  const agent = await openStudioAgent(fixtures, `Removal · ${prefix} · Own Delete Agent`);
  await screen.getByLabel("Prompt", { exact: true }).fill("Unsaved edits to delete");
  await chooseAgentAction(screen, "Remove");
  return { app: fixtures.app, screen: fixtures.screen, browser: fixtures.browser, prefix, agent };
}

export async function expectDeletedOwnAgent(
  state: Awaited<ReturnType<typeof beforeDeletedOwnAgent>>,
) {
  const { screen, browser, agent } = state;
  await expect(browser).toHaveURL(/\/studio\/agents\/[^/]+$/);
  await expect(browser).not.toHaveURL(`/studio/agents/${agent.id}`);
  await expect(screen.getByRole("dialog", /Discard/)).toHaveCount(0);
  await expect(screen.getByRole("link", agent.name, { exact: false })).toHaveCount(0);
  return { ...state };
}
