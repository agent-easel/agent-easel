import assert from "node:assert/strict";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import type { Fixture } from "./support/fixture/handle.ts";
import type {
  Result,
  RunNavigationEntry,
  TriggerDefinition,
} from "../packages/contracts/src/index.ts";
import { archiveJourneyRun } from "./support/run-history.ts";
import { saveFlowCopy, readFlow, saveFlowElsewhere } from "./support/flows.ts";
import { expectSaveFilled, expectSaveNeutral, startHeldSave } from "./support/studio.ts";
import { afterEach, beforeEach, test } from "./support/test.ts";

/** Runs a journey's Trigger started, archived afterwards so later journeys do not list them. */
const startedRuns: string[] = [];

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 900 });
});

afterEach(async ({ app }) => {
  for (const runId of startedRuns.splice(0)) await archiveJourneyRun(app.baseUrl, runId);
});

const studioNavigation = (screen: Screen) => screen.getByRole("navigation", "Studio navigation");

async function runFromMenu(screen: Screen, trigger: string) {
  await screen.getByRole("button", `${trigger} actions`, { exact: true }).tap();
  await screen.getByRole("menuitem", "Check now", { exact: true }).tap();
}

async function fillTrigger(screen: Screen, name: string, flow = "Demo · Focused change") {
  await screen.getByRole("textbox", "Name", { exact: true }).fill(name);
  await screen.getByRole("combobox", "Project", { exact: true }).tap();
  await screen
    .getByRole("listbox", "Project", { exact: true })
    .getByRole("option", "Atlas demo", { exact: true })
    .tap();
  await expect(screen.getByText("factory-demo/atlas", { exact: true })).toBeVisible();
  await screen.getByRole("combobox", "Flow", { exact: true }).tap();
  await screen
    .getByRole("listbox", "Flow", { exact: true })
    .getByRole("option", flow, { exact: true })
    .tap();
}

async function expectEditorOff(screen: Screen, name: string) {
  await expect(screen.getByRole("heading", name, { exact: true })).toBeVisible();
  await expect(
    screen.getByRole("switch", "Trigger enabled", { exact: true, checked: false }),
  ).toBeVisible();
}

/** Opens a saved, enabled Trigger named `name` from the Trigger list. */
async function openSavedTrigger(
  { app, screen, fixture }: { app: App; screen: Screen; fixture: Fixture },
  name: string,
) {
  await fixture.github.trigger({ name });
  await app.open("/studio/triggers");
  await screen.getByRole("link", name, { exact: false }).tap();
  await expect(screen.getByRole("heading", name, { exact: true })).toBeVisible();
}

/** Opens a saved, enabled Trigger named `name` and edits its name, leaving the edit unsaved. */
async function openEditedTrigger(
  fixtures: { app: App; screen: Screen; fixture: Fixture },
  name: string,
) {
  await openSavedTrigger(fixtures, name);
  await fixtures.screen.getByRole("textbox", "Name", { exact: true }).fill(`${name} edited`);
}

/** Opens the named Trigger from the list; answers its status strip once it shows Problem. */
async function openedInProblem(screen: Screen, trigger: string) {
  await screen.getByRole("link", trigger, { exact: false }).tap();
  const status = screen.getByRole("region", "Trigger status");
  await expect(status.getByText("Problem", { exact: true })).toBeVisible();
  return status;
}

/** The Run the named Trigger started, as Run navigation lists it. */
async function runStartedBy(baseUrl: string | undefined, trigger: string) {
  const response = await fetch(new URL("/api/run-navigation", baseUrl));
  const navigation = (await response.json()) as Result<readonly RunNavigationEntry[]>;
  assert(navigation.ok);
  const run = navigation.value.find((entry) => entry.origin?.trigger.name === trigger);
  assert(run, `Expected a Run started by ${trigger}`);
  return run;
}

const mutation = { "content-type": "application/json", "X-Factory-Request": "1" };

/** The saved Trigger named `name`, as Factory answers it now. */
async function savedTrigger(baseUrl: string | undefined, name: string) {
  const listed = (await (await fetch(new URL("/api/triggers", baseUrl))).json()) as Result<
    readonly TriggerDefinition[]
  >;
  assert(listed.ok);
  const trigger = listed.value.find((entry) => entry.name === name);
  assert(trigger, `Expected a saved Trigger named ${name}`);
  return trigger;
}

/** Another client switches the saved Trigger named `name` off. */
async function disableElsewhere(baseUrl: string | undefined, name: string) {
  const trigger = await savedTrigger(baseUrl, name);
  const reply = await fetch(new URL(`/api/triggers/${trigger.id}/enabled`, baseUrl), {
    method: "PUT",
    headers: mutation,
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(reply.ok, true);
}

/**
 * Holds the page's next check of the Trigger named `name` until another client saved it as
 * `renamed`, a newer revision, then sends that check.
 */
async function saveBeforeCheck(
  browser: Browser,
  baseUrl: string | undefined,
  name: string,
  renamed: string,
) {
  const trigger = await savedTrigger(baseUrl, name);
  await browser.route(`**/api/triggers/${trigger.id}/run`, async (route) => {
    const current = await savedTrigger(baseUrl, name);
    const saved = await fetch(new URL(`/api/triggers/${trigger.id}`, baseUrl), {
      method: "PUT",
      headers: mutation,
      body: JSON.stringify({
        expectedRevision: current.revision,
        kind: current.kind,
        name: renamed,
        projectId: current.projectId,
        flowId: current.flowId,
        schedule: current.schedule,
        maxActiveRuns: current.maxActiveRuns,
        github: { repositoryNodeId: current.github.repository.nodeId, query: current.github.query },
      }),
    });
    assert.equal(saved.ok, true);
    await route.continue();
  });
}

test("a GitHub Issues Trigger made in Studio starts a Run for a ready issue, and removing it keeps where the Run started", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Implement ready issues";
  const origin = `Started from Trigger “${name}” · atlas#7`;
  await app.open("/studio/flows");
  await studioNavigation(screen).getByRole("link", "Triggers", { exact: true }).tap();
  await screen.getByRole("button", "New Trigger", { exact: true }).tap();
  await fillTrigger(screen, name);
  await screen.getByRole("button", "Review and enable", { exact: true }).tap();
  const review = screen.getByRole("dialog", /Enable “/);
  await expect(review.getByRole("heading", "No issues ready", { exact: true })).toBeVisible();
  await app.screenshot("trigger-review");
  await review.getByRole("button", "Enable and check", { exact: true }).tap();
  const status = screen.getByRole("region", "Trigger status");
  await expect(status.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(status).toContainText(/Started 0 Runs · next check /);
  await fixture.github.issue({
    number: 7,
    title: "Add a dark mode toggle to settings",
    labels: ["factory:ready"],
  });
  await status.getByRole("button", "Check now", { exact: true }).tap();
  await status.getByRole("link", "1 Run", { exact: true }).tap();
  const run = await runStartedBy(app.baseUrl, name);
  startedRuns.push(run.id);
  await expect(screen.getByText(origin, { exact: true })).toBeVisible();
  const startedFrom = screen.getByRole("region", "Started from");
  await expect(
    startedFrom.getByRole("link", "atlas#7 Add a dark mode toggle to settings", { exact: true }),
  ).toHaveAttribute("href", "https://github.com/factory-demo/atlas/issues/7");
  await app.screenshot("trigger-started-run");
  await app.open("/studio/triggers");
  await screen.getByRole("button", `${name} actions`, { exact: true }).tap();
  await screen.getByRole("menuitem", "Remove", { exact: true }).tap();

  // Act
  await screen.getByRole("alertdialog").getByRole("button", "Remove", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("heading", "No Triggers yet", { exact: true })).toBeVisible();
  await app.open(`/runs/${run.id}`);
  await expect(screen.getByText(origin, { exact: true })).toBeVisible();
  await expect(screen.getByRole("region", "Started from")).toContainText(name);
});

test("an opened Trigger returns to the Trigger list from its breadcrumb", async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Back to the list";
  await openSavedTrigger({ app, screen, fixture }, name);

  // Act
  await browser
    .locator("[data-studio] > header")
    .getByRole("link", "Triggers", { exact: true })
    .tap();

  // Assert
  await expect(screen.getByRole("button", `${name} actions`, { exact: true })).toBeVisible();
});

test("a Trigger whose host gh is signed out shows Problem with the host step that repairs it", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Signed-out gh";
  await fixture.github.trigger({ name });
  await fixture.github.host({ signedIn: false });
  await app.open("/studio/triggers");

  // Act
  await runFromMenu(screen, name);

  // Assert
  const guidance = "On the Factory host, run gh auth login --hostname github.com as the user";
  await expect(screen.getByText(`${guidance} Factory runs as.`)).toBeVisible();
  await expect(studioNavigation(screen).getByText("1 Trigger in Error")).toBeAttached();
  const status = await openedInProblem(screen, name);
  await expect(status).toContainText(`${guidance} Factory runs as.`);
  await app.screenshot("trigger-error-strip");
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  await expect(
    screen.getByRole("navigation", "Sidebar footer").getByText("1 Trigger in Error"),
  ).toBeAttached();
});

test("a Trigger whose Project now names another repository is repaired by confirming that repository and applying the reviewed edit", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Moved repository";
  await fixture.github.trigger({ name });
  await fixture.github.repository({ nameWithOwner: "factory-demo/atlas-next" });
  await app.open("/studio/triggers");
  await runFromMenu(screen, name);
  const status = await openedInProblem(screen, name);
  await expect(status).toContainText("Choose Confirm under Repository");
  await expect(screen.getByText("Detected now", { exact: true })).toBeVisible();
  await expect(screen.getByText("factory-demo/atlas-next", { exact: true })).toBeVisible();
  await app.screenshot("trigger-repository-reconfirm");
  await screen.getByRole("button", "Confirm", { exact: true }).tap();
  await screen.getByRole("button", "Save", { exact: true }).tap();
  const review = screen.getByRole("dialog", /Enable “/);
  await expect(review.getByText(/factory-demo\/atlas-next/)).toBeVisible();
  await expect(review.getByRole("heading", "No issues ready", { exact: true })).toBeVisible();
  await app.screenshot("trigger-repository-review");

  // Act
  await review.getByRole("button", "Apply and check", { exact: true }).tap();

  // Assert
  await expect(status.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(screen.getByText("factory-demo/atlas-next", { exact: true })).toBeVisible();
  await expect(studioNavigation(screen).getByText("1 Trigger in Error")).not.toBeAttached();
});

test("Save creates a Trigger off and lands in its editor", async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Save off";
  await fixture.github.trigger({ name: "Journey · Existing watcher" });
  await app.open("/studio/triggers");
  await screen.getByRole("button", "New Trigger", { exact: true }).tap();
  await expect(browser).toHaveURL("/studio/triggers/new/github-issues");
  await expect(
    screen.getByRole("heading", "New GitHub Issues Trigger", { exact: true }),
  ).toBeVisible();
  await app.screenshot("new-trigger-empty");
  await fillTrigger(screen, name);
  await expect(
    screen.getByText("Another Trigger watches factory-demo/atlas", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("button", "Review and enable", { exact: true })).toBeEnabled();

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectEditorOff(screen, name);
  await expect(screen.getByRole("button", "Check now", { exact: true })).toBeDisabled();
  const response = await fetch(new URL("/api/triggers", app.baseUrl));
  const saved = (await response.json()) as Result<readonly TriggerDefinition[]>;
  assert(saved.ok);
  assert.equal(saved.value.find((trigger) => trigger.name === name)?.enabled, false);
  await app.screenshot("edit-trigger-off");
});

test("a new Trigger's Flow list with no Flows says so in its named popup, with no empty listbox", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  await fixture.definitions.removeFlows();
  await app.open("/studio/triggers/new/github-issues");

  // Act
  await screen.getByRole("combobox", "Flow", { exact: true }).tap();

  // Assert
  const popup = screen.getByRole("dialog", "Flow", { exact: true });
  await expect(popup.getByRole("status")).toHaveText("No Flows available");
  await expect(screen.getByRole("listbox", "Flow", { exact: true })).toHaveCount(0);
  await app.screenshot("trigger-flow-list-empty");
});

test("a complete new Trigger has Save as its only filled action", async ({ app, screen }) => {
  // Arrange
  const name = "Journey · New Trigger Save";
  await app.open("/studio/triggers/new/github-issues");
  await expect(
    screen.getByRole("heading", "New GitHub Issues Trigger", { exact: true }),
  ).toBeVisible();

  // Act
  await fillTrigger(screen, name);

  // Assert
  await expect(screen.getByRole("button", "Save", { exact: true })).toHaveAttribute(
    "data-variant",
    "default",
  );
  const review = screen.getByRole("button", "Review and enable", { exact: true });
  await expect(review).toBeEnabled();
  await expect(review).not.toHaveAttribute("data-variant", "default");
  await expect(screen.getByRole("switch", "Trigger enabled", { exact: true })).toHaveCount(0);
});

test("a saved Trigger's footer Save is filled once the Trigger has unsaved edits", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Footer Save unsaved";
  await openSavedTrigger({ app, screen, fixture }, name);

  // Act
  await screen.getByRole("textbox", "Name", { exact: true }).fill(`${name} edited`);

  // Assert
  await expectSaveFilled(screen);
});

test("a saved Trigger's footer Save turns neutral and disabled once saved", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Footer Save saved";
  await openEditedTrigger({ app, screen, fixture }, name);

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("heading", `${name} edited`, { exact: true })).toBeVisible();
  await expectSaveNeutral(screen);
});

test("Escape on an edited Trigger asks before discarding and returns to the Trigger list, not out of Studio", async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  // Arrange
  await openEditedTrigger({ app, screen, fixture }, "Journey · Escape to Triggers");

  // Act
  await browser.keyboard.press("Escape");
  await screen
    .getByRole("dialog", "Discard unsaved changes?")
    .getByRole("button", "Discard changes", { exact: true })
    .tap();

  // Assert
  await expect(screen.getByRole("dialog", "Studio", { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "Triggers", { exact: true })).toBeVisible();
  await expect(screen.getByRole("textbox", "Name", { exact: true })).toHaveCount(0);
});

test("a saved Trigger's footer Save turns neutral when the Trigger is removed elsewhere during its save", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Removed while saving";
  await openEditedTrigger({ app, screen, fixture }, name);
  const listed = (await (await fetch(new URL("/api/triggers", app.baseUrl))).json()) as Result<
    readonly TriggerDefinition[]
  >;
  assert(listed.ok);
  const trigger = listed.value.find((entry) => entry.name === name);
  assert(trigger);
  const releaseSave = await startHeldSave(browser, screen, `/api/triggers/${trigger.id}`);

  // Act
  const removal = await fetch(new URL(`/api/triggers/${trigger.id}`, app.baseUrl), {
    method: "DELETE",
    headers: { "X-Factory-Request": "1" },
  });

  // Assert
  assert.equal(removal.ok, true);
  await expect(
    screen.getByText("This Trigger was removed elsewhere", { exact: true }),
  ).toBeVisible();
  await expectSaveNeutral(screen);
  await app.screenshot("trigger-footer-removed-while-saving");
  releaseSave();
});

const retainedTrigger = "Journey · Retain Trigger draft";
const flowDraftName = "Unsaved Flow repair";

/**
 * A new Trigger draft whose Flow lost its input wiring elsewhere, opened from the Trigger, renamed
 * there without saving, with its Agent block selected.
 */
async function repairingTriggerFlow(app: App, screen: Screen) {
  const flowToRepair = `Journey · Flow to repair ${crypto.randomUUID().slice(0, 8)}`;
  const id = await saveFlowCopy(app.baseUrl, "Demo · Focused change", flowToRepair, {
    mode: "checkout",
  });
  const flow = await readFlow(app.baseUrl, id);
  await app.open("/studio/triggers/new/github-issues");
  await fillTrigger(screen, retainedTrigger, flowToRepair);
  await saveFlowElsewhere(app.baseUrl, flow, {
    graph: { ...flow.graph, flowInput: { ...flow.graph.flowInput, targetBlockIds: [] } },
  });
  const flowPicker = screen.getByRole("combobox", "Flow", { exact: true });
  await expect(flowPicker).toHaveAttribute("aria-invalid", "true");
  await expect(screen.getByRole("button", "Review and enable", { exact: true })).toBeDisabled();
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await screen.getByRole("link", "Open Flow", { exact: true }).tap();
  await expect(screen.getByRole("button", "Back to Trigger", { exact: true })).toBeVisible();
  await screen.getByLabel("Flow name", { exact: true }).fill(flowDraftName);
  const agentBlock = flow.graph.blocks.find((block) => block.kind === "agent");
  assert(agentBlock);
  await screen.getByRole("button", `Agent ${agentBlock.name}`, { exact: true }).tap();
  return { flowPicker, flowToRepair };
}

/** That Flow's Agent opened over the Flow and the Trigger. */
async function agentOverRepair(app: App, screen: Screen) {
  const repairing = await repairingTriggerFlow(app, screen);
  await screen.getByRole("link", "Open Agent", { exact: true }).tap();
  await expect(screen.getByRole("heading", "Agents", { exact: true })).toBeVisible();
  return repairing;
}

/**
 * Back to Trigger from that edited Flow after its Agent was opened over it and closed, asking
 * whether to discard the Flow draft.
 */
async function discardPrompt(app: App, screen: Screen, browser: Browser) {
  const repairing = await agentOverRepair(app, screen);
  await browser.keyboard.press("Escape");
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(flowDraftName);
  await screen.getByRole("button", "Back to Trigger", { exact: true }).tap();
  return { ...repairing, discard: screen.getByRole("dialog", "Discard unsaved changes?") };
}

test("an Agent opens over an edited Flow and Trigger without asking to discard them", async ({
  app,
  screen,
}) => {
  // Arrange
  const { flowToRepair } = await repairingTriggerFlow(app, screen);

  // Act
  await screen.getByRole("link", "Open Agent", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("link", flowToRepair, { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "Agents", { exact: true })).toBeVisible();
  await expect(screen.getByRole("dialog", "Discard unsaved changes?")).toHaveCount(0);
  await app.screenshot("agent-opened-over-flow-and-trigger");
});

test("closing an Agent opened over an edited Flow returns to the Flow draft", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await agentOverRepair(app, screen);

  // Act
  await browser.keyboard.press("Escape");

  // Assert
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(flowDraftName);
});

test("going back to the Trigger from an edited Flow asks before discarding the Flow draft", async ({
  app,
  screen,
}) => {
  // Arrange
  await repairingTriggerFlow(app, screen);

  // Act
  await screen.getByRole("button", "Back to Trigger", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("dialog", "Discard unsaved changes?")).toBeVisible();
});

test("discarding the Flow draft after its Agent was opened and closed returns to the Trigger with its edits", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const { flowPicker, flowToRepair, discard } = await discardPrompt(app, screen, browser);

  // Act
  await discard.getByRole("button", "Discard changes", { exact: true }).tap();

  // Assert
  await expect(browser).toHaveURL("/studio/triggers/new/github-issues");
  await expect(screen.getByRole("textbox", "Name", { exact: true })).toHaveValue(retainedTrigger);
  await expect(flowPicker).toContainText(flowToRepair);
  await expect(flowPicker).toHaveAttribute("aria-describedby", "trigger-flow-problem");
});

async function loseTriggerCreateReply(browser: Browser) {
  await browser.route("**/api/triggers", async (route) => {
    if (route.request.method !== "POST") return route.continue();
    await route.fetch();
    await route.abort();
  });
}

test("an unknown Create with a saved Trigger offers to open it without creating again", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const name = "Journey · Lost Create reply";
  await app.open("/studio/triggers/new/github-issues");
  await fillTrigger(screen, name);
  await loseTriggerCreateReply(browser);

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("button", "Open Trigger", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Create again", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeDisabled();
  await screen.getByRole("button", "Open Trigger", { exact: true }).tap();
  await expectEditorOff(screen, name);
});

test("Check now on a Trigger saved elsewhere meanwhile checks nothing and reviews the saved revision", async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Checked while saved elsewhere";
  const renamed = `${name} renamed`;
  await fixture.github.trigger({ name });
  await app.open("/studio/triggers");
  await expect(screen.getByRole("switch", name, { exact: true, checked: true })).toBeVisible();
  await saveBeforeCheck(browser, app.baseUrl, name, renamed);

  // Act
  await runFromMenu(screen, name);

  // Assert
  const review = screen.getByRole("dialog", `Enable “${renamed}”?`);
  await expect(
    review.getByText("so nothing was checked. Review these settings before checking.", {
      exact: false,
    }),
  ).toBeVisible();
  await app.screenshot("trigger-check-now-saved-elsewhere");
});

test("Enable and check on a Trigger saved elsewhere after enabling leaves it on, checks nothing and reviews the saved revision", async ({
  app,
  browser,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Enabled while saved elsewhere";
  const renamed = `${name} renamed`;
  await fixture.github.trigger({ name });
  await disableElsewhere(app.baseUrl, name);
  await app.open("/studio/triggers");
  await screen.getByRole("switch", name, { exact: true, checked: false }).tap();
  const confirm = screen
    .getByRole("dialog", `Enable “${name}”?`)
    .getByRole("button", "Enable and check", { exact: true });
  await expect(confirm).toBeEnabled();
  await saveBeforeCheck(browser, app.baseUrl, name, renamed);

  // Act
  await confirm.tap();

  // Assert
  const review = screen.getByRole("dialog", `Enable “${renamed}”?`);
  await expect(
    review.getByText("so nothing was checked. Review these settings before checking.", {
      exact: false,
    }),
  ).toBeVisible();
  assert.equal((await savedTrigger(app.baseUrl, renamed)).enabled, true);
  await app.screenshot("trigger-enable-and-check-saved-elsewhere");
});
