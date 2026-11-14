import type { StudioFixtures } from "./studio.ts";
import { expect, type Screen } from "e2e";
import { saveSingleAgentFlow, removeFlowElsewhere, readFlow } from "./flows.ts";
function retainedFlowGuard(screen: Screen) {
  return screen.getByRole(
    "dialog",
    "This Flow was removed elsewhere. Discard the retained draft?",
    { exact: true },
  );
}
export async function keepRetainedFlow(screen: Screen) {
  const guard = retainedFlowGuard(screen);
  await expect(guard).toBeVisible();
  await guard.getByRole("button", "Keep editing", { exact: true }).tap();
  return guard;
}
/** Prerequisite stages replay one continuous editor-open history; tested operations stay in the test Acts. */
export async function beforeRetainedCleanFlow(fixtures: StudioFixtures, prefix: string) {
  const { app, screen } = fixtures;
  const name = `Removal · ${prefix} · Retained Flow`;
  const id = await saveSingleAgentFlow(app.baseUrl, name, "Sample worker", {
    id: "worker",
    name: "Worker",
    x: 300,
    y: 120,
  });
  await app.open(`/studio/flows/${id}`);
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(name);
  await screen.getByRole("button", "Remove", { exact: true }).tap();
  await expect(screen.getByRole("dialog", `Remove “${name}”?`, { exact: true })).toBeVisible();
  return {
    app: fixtures.app,
    screen: fixtures.screen,
    browser: fixtures.browser,
    prefix,
    name,
    id,
  };
}

export async function expectRetainedCleanFlow(
  state: Awaited<ReturnType<typeof beforeRetainedCleanFlow>>,
) {
  const { app, screen, browser, name, id } = state;
  await expect(screen.getByRole("dialog", `Remove “${name}”?`, { exact: true })).toHaveCount(0);
  await expect(
    screen.getByText("This Flow was removed elsewhere. Your draft is kept.", { exact: true }),
  ).toBeVisible();
  await expect(browser).toHaveURL(`/studio/flows/${id}`);
  await expect(screen.getByRole("button", "Save Flow", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("button", "Start Run", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("button", "Remove", { exact: true })).toBeDisabled();
  await app.screenshot("flow-removed-retained");
  return { ...state };
}

export async function beforeKeptCleanFlow(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeRetainedCleanFlow(fixtures, prefix);
    const { app, id } = previous;
    await removeFlowElsewhere(app.baseUrl, id);
    return expectRetainedCleanFlow({ ...previous });
  })();
  const { screen } = state;
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  return { ...state };
}

export async function expectKeptCleanFlow(
  state: Awaited<ReturnType<typeof beforeKeptCleanFlow>> & {
    guard: Awaited<ReturnType<typeof keepRetainedFlow>>;
  },
) {
  const { screen, name } = state;
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(name);
  return { ...state };
}

export async function beforeHiddenFlowGuard(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeKeptCleanFlow(fixtures, prefix);
    const { screen } = previous;
    const guard = await keepRetainedFlow(screen);
    return expectKeptCleanFlow({ ...previous, guard });
  })();
  const { screen } = state;
  await screen.getByRole("link", "All Flows", { exact: true }).tap();
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  return { ...state };
}

export async function expectHiddenFlowGuard(
  state: Awaited<ReturnType<typeof beforeHiddenFlowGuard>>,
) {
  const { app, guard } = state;
  await expect(guard).toBeVisible();
  await app.screenshot("flow-hidden-discard-confirmation");
  return { ...state };
}

export async function beforeDiscardedHiddenFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeHiddenFlowGuard(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  return expectHiddenFlowGuard({ ...previous });
}

export async function expectDiscardedHiddenFlow(
  state: Awaited<ReturnType<typeof beforeDiscardedHiddenFlow>>,
) {
  const { screen } = state;
  await expect(screen.getByRole("button", "Back to Runs", { exact: true })).toHaveCount(0);
  return { ...state };
}

export async function beforeMissingRemovedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeDiscardedHiddenFlow(fixtures, prefix);
  const { guard } = previous;
  await guard.getByRole("button", "Discard", { exact: true }).tap();
  return expectDiscardedHiddenFlow({ ...previous });
}

export async function expectMissingRemovedFlow(
  state: Awaited<ReturnType<typeof beforeMissingRemovedFlow>>,
) {
  const { screen } = state;
  await expect(screen.getByText("Flow not found", { exact: true })).toBeVisible();
  return { ...state };
}

export async function beforeRemovedFlowBackList(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeMissingRemovedFlow(fixtures, prefix);
  const { app, id } = previous;
  await app.open(`/studio/flows/${id}`);
  return expectMissingRemovedFlow({ ...previous });
}

export async function expectRemovedFlowBackList(
  state: Awaited<ReturnType<typeof beforeRemovedFlowBackList>>,
) {
  const { browser } = state;
  await expect(browser).toHaveURL("/studio/flows");
  return { ...state };
}

export async function beforeReopenedRetainedFlow(fixtures: StudioFixtures, prefix: string) {
  const { app, screen } = fixtures;
  const name = `Removal · ${prefix} · Hidden retained Flow`;
  const id = await saveSingleAgentFlow(app.baseUrl, name, "Sample worker", {
    id: "hidden-worker",
    name: "Worker",
    x: 320,
    y: 180,
  });
  const otherName = `Removal · ${prefix} · Other Flow`;
  await saveSingleAgentFlow(app.baseUrl, otherName, "Sample worker", {
    id: "other-worker",
    name: "Worker",
    x: 320,
    y: 180,
  });
  await app.open(`/studio/flows/${id}`);
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(name);
  await screen.getByRole("link", "Agents", { exact: true }).tap();
  await removeFlowElsewhere(app.baseUrl, id);
  await screen.getByRole("link", "Flows", { exact: true }).tap();
  await screen.getByRole("link", new RegExp(`^Removal · ${prefix} · Other Flow `)).tap();
  return {
    app: fixtures.app,
    screen: fixtures.screen,
    browser: fixtures.browser,
    prefix,
    name,
    id,
    otherName,
  };
}

export async function expectReopenedRetainedFlow(
  state: Awaited<ReturnType<typeof beforeReopenedRetainedFlow>>,
) {
  const { app, screen, browser, id } = state;
  await expect(browser).toHaveURL(`/studio/flows/${id}`);
  await expect(
    screen.getByText("This Flow was removed elsewhere. Your draft is kept.", { exact: true }),
  ).toBeVisible();
  await app.screenshot("hidden-flow-reopened");
  return { ...state };
}

export async function beforeCombinedFlowGuard(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeReopenedRetainedFlow(fixtures, prefix);
    const { screen } = previous;
    await keepRetainedFlow(screen);
    return expectReopenedRetainedFlow({ ...previous });
  })();
  const { screen } = state;
  await screen.getByRole("link", "Agents", { exact: true }).tap();
  await screen.getByRole("link", "Sample worker", { exact: true }).tap();
  await screen.getByLabel("Prompt", { exact: true }).fill("Unsaved Agent beside retained Flow");
  return { ...state };
}

export async function expectCombinedFlowGuard(
  state: Awaited<ReturnType<typeof beforeCombinedFlowGuard>>,
) {
  const { app, screen } = state;
  const both = screen.getByRole("dialog", "Discard the Flow and Agent drafts?", { exact: true });
  await expect(both).toContainText("This Flow was removed elsewhere");
  await expect(both).toContainText("Your Agent has unsaved changes");
  await app.screenshot("hidden-removed-flow-with-agent-draft");
  return { ...state, both };
}

export async function beforeKeptCombinedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeCombinedFlowGuard(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  return expectCombinedFlowGuard({ ...previous });
}

export async function expectKeptCombinedFlow(
  state: Awaited<ReturnType<typeof beforeKeptCombinedFlow>>,
) {
  const { screen } = state;
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Unsaved Agent beside retained Flow",
  );
  return { ...state };
}

export async function beforeCopiedEditedFlow(fixtures: StudioFixtures, prefix: string) {
  const { app, screen, browser } = fixtures;
  const id = await saveSingleAgentFlow(
    app.baseUrl,
    `Removal · ${prefix} · JSON Flow`,
    "Sample worker",
    { id: "json-worker", name: "Worker", x: 320, y: 180 },
    "done",
  );
  const saved = await readFlow(app.baseUrl, id);
  await app.open(`/studio/flows/${id}`);
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(saved.name);
  await removeFlowElsewhere(app.baseUrl, id);
  await expect(screen.getByRole("button", "Copy as JSON", { exact: true })).toBeVisible();
  await screen.getByLabel("Flow name", { exact: true }).fill("");
  await browser.evaluate(
    "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedFlowJson = text; } } })",
  );
  return {
    app: fixtures.app,
    screen: fixtures.screen,
    browser: fixtures.browser,
    prefix,
    id,
    saved,
  };
}

export async function expectCopiedEditedFlow(
  state: Awaited<ReturnType<typeof beforeCopiedEditedFlow>>,
) {
  const { screen, browser, saved } = state;
  await expect(screen.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  expect(await browser.evaluate("JSON.parse(window.copiedFlowJson)")).toEqual({
    name: "",
    graph: saved.graph,
    workspace: saved.workspace,
  });
  return { ...state };
}

export async function beforeFlowJsonFallback(fixtures: StudioFixtures, prefix: string) {
  const state = await (async () => {
    const previous = await beforeCopiedEditedFlow(fixtures, prefix);
    const { screen } = previous;
    await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();
    return expectCopiedEditedFlow({ ...previous });
  })();
  const { browser } = state;
  await browser.evaluate(
    "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } })",
  );
  return { ...state };
}

export async function expectFlowJsonFallback(
  state: Awaited<ReturnType<typeof beforeFlowJsonFallback>>,
) {
  const { screen, saved } = state;
  const json = screen.getByRole("textbox", "Flow draft JSON", { exact: true });
  await expect(json).toBeVisible();
  await expect(json).toHaveAttribute("readonly", "");
  await expect(json).toHaveValue(
    JSON.stringify({ name: "", workspace: saved.workspace, graph: saved.graph }, null, 2),
  );
  return { ...state, json };
}

export async function beforeSelectedFlowJson(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeFlowJsonFallback(fixtures, prefix);
  const { screen } = previous;
  await screen.getByRole("button", "Copy as JSON", { exact: true }).tap();
  return expectFlowJsonFallback({ ...previous });
}

export async function expectSelectedFlowJson(
  state: Awaited<ReturnType<typeof beforeSelectedFlowJson>>,
) {
  const { app, browser } = state;
  expect(
    await browser.evaluate(
      "(() => { const field = document.activeElement; return field.selectionEnd - field.selectionStart === field.value.length; })()",
    ),
  ).toBe(true);
  await app.screenshot("flow-json-fallback");
  return { ...state };
}

export async function beforeUpdatedFlowJson(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeSelectedFlowJson(fixtures, prefix);
  const { json } = previous;
  await json.focus();
  return expectSelectedFlowJson({ ...previous });
}

export async function expectUpdatedFlowJson(
  state: Awaited<ReturnType<typeof beforeUpdatedFlowJson>>,
) {
  const { saved, json } = state;
  await expect(json).toHaveValue(
    JSON.stringify(
      { name: "Recovered unfinished Flow", workspace: saved.workspace, graph: saved.graph },
      null,
      2,
    ),
  );
  return { ...state };
}
