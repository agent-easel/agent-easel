import { chooseFlowAction, flowsBreadcrumb, type StudioFixtures } from "./studio.ts";
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
  await chooseFlowAction(screen, "Remove");
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
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await screen.getByRole("button", "More Flow actions", { exact: true }).tap();
  await expect(screen.getByRole("menuitem", "Remove", { exact: true })).toBeDisabled();
  await screen.getByRole("menu").press("Escape");
  await expect(screen.getByRole("menu")).toHaveCount(0);
  // The closed menu refocuses ⋯, whose tooltip would cover Studio's Back to Runs.
  await screen.getByLabel("Flow name", { exact: true }).focus();
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

export async function beforeLeftRetainedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeKeptCleanFlow(fixtures, prefix);
  const { screen } = previous;
  const guard = await keepRetainedFlow(screen);
  return expectKeptCleanFlow({ ...previous, guard });
}

export async function expectLeftRetainedFlow(
  state: Awaited<ReturnType<typeof beforeLeftRetainedFlow>>,
) {
  const { app, guard } = state;
  await expect(guard).toBeVisible();
  await app.screenshot("flow-retained-discard-confirmation");
  return { ...state };
}

export async function beforeDiscardedRetainedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeLeftRetainedFlow(fixtures, prefix);
  const { screen } = previous;
  await flowsBreadcrumb(screen).tap();
  return expectLeftRetainedFlow({ ...previous });
}

export async function expectDiscardedRetainedFlow(
  state: Awaited<ReturnType<typeof beforeDiscardedRetainedFlow>>,
) {
  const { screen, guard } = state;
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  await expect(guard).toHaveCount(0);
  return { ...state };
}

export async function beforeMissingRemovedFlow(fixtures: StudioFixtures, prefix: string) {
  const previous = await beforeDiscardedRetainedFlow(fixtures, prefix);
  const { guard } = previous;
  await guard.getByRole("button", "Discard", { exact: true }).tap();
  return expectDiscardedRetainedFlow({ ...previous });
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
