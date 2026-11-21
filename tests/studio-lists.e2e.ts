import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import type { Result, TriggerDefinition } from "../packages/contracts/src/index.ts";
import { exportDefinitionFile, exportWithoutAgentModels, ownedFlow } from "./support/owners.ts";
import { refuseFlowCreate } from "./support/flows.ts";
import { descriptionOf, whileTriggerChecksHeld } from "./support/studio.ts";
import { desktopBridgeOptions, desktopBridgeScript } from "./support/desktop-bridge.ts";
import { test } from "./support/test.ts";

const viewport = { width: 1440, height: 900 };
// A cancelled animation rejects `finished` with AbortError. A shot still waits for the rest.
const settled =
  "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => null))).then(() => true)";
const mutation = { "content-type": "application/json", "X-Factory-Request": "1" };

/** Chrome the three Studio lists must share: title, primary button, search, first group heading. */
type ListChrome = {
  title: { x: number; y: number };
  createRight: number;
  createY: number;
  search: { x: number; y: number };
  group: { x: number; y: number };
};

async function shot(
  app: { screenshot(name: string): Promise<unknown> },
  browser: Browser,
  name: string,
) {
  await browser.evaluate(settled);
  await app.screenshot(name);
}

/** Scrolls a labelled owner group into the Studio list, which scrolls inside the dialog. */
async function revealGroup(browser: Browser, label: string) {
  await browser.evaluate(
    `document.querySelector(${JSON.stringify(`section[aria-label="${label}"]`)})?.scrollIntoView({ block: "center" })`,
  );
}

async function listChrome(browser: Browser, title: string): Promise<ListChrome> {
  return browser.evaluate<ListChrome>(`(() => {
    const round = (value) => Math.round(value);
    const heading = [...document.querySelectorAll("h1")].find((node) => node.textContent.trim() === ${JSON.stringify(title)});
    const page = heading.closest(".content-start");
    const search = page.querySelector(${JSON.stringify(`input[aria-label="Search ${title}"]`)});
    const create = [...page.querySelectorAll("button")].find((node) => node.textContent.includes("New "));
    const group = page.querySelector("h2");
    const titleBox = heading.getBoundingClientRect();
    const searchBox = search.getBoundingClientRect();
    const createBox = create.getBoundingClientRect();
    const groupBox = group.getBoundingClientRect();
    return {
      title: { x: round(titleBox.x), y: round(titleBox.y) },
      createRight: round(createBox.right),
      createY: round(createBox.y),
      search: { x: round(searchBox.x), y: round(searchBox.y) },
      group: { x: round(groupBox.x), y: round(groupBox.y) },
    };
  })()`);
}

function sameChrome(left: ListChrome, right: ListChrome, label: string) {
  const near = (name: string, a: number, b: number) =>
    assert.ok(Math.abs(a - b) <= 2, `${label} ${name}: ${a} vs ${b}`);
  near("title x", left.title.x, right.title.x);
  near("title y", left.title.y, right.title.y);
  near("create right", left.createRight, right.createRight);
  near("create y", left.createY, right.createY);
  near("search x", left.search.x, right.search.x);
  near("search y", left.search.y, right.search.y);
  near("group x", left.group.x, right.group.x);
  near("group y", left.group.y, right.group.y);
}

async function readTriggers(baseUrl: string | undefined) {
  const result = (await (await fetch(new URL("/api/triggers", baseUrl))).json()) as Result<
    readonly TriggerDefinition[]
  >;
  assert(result.ok);
  return result.value;
}

/** Raises how many Runs one check may start. The fixture Trigger allows one. */
async function allowRuns(baseUrl: string | undefined, name: string, maxActiveRuns: number) {
  const trigger = (await readTriggers(baseUrl)).find((entry) => entry.name === name);
  assert(trigger);
  const result = (await (
    await fetch(new URL(`/api/triggers/${trigger.id}`, baseUrl), {
      method: "PUT",
      headers: mutation,
      body: JSON.stringify({
        expectedRevision: trigger.revision,
        kind: trigger.kind,
        name: trigger.name,
        projectId: trigger.projectId,
        flowId: trigger.flowId,
        schedule: trigger.schedule,
        maxActiveRuns,
        github: {
          repositoryNodeId: trigger.github.repository.nodeId,
          query: trigger.github.query,
        },
      }),
    })
  ).json()) as Result<{ trigger: TriggerDefinition }>;
  assert(result.ok, JSON.stringify(result));
}

test.beforeEach(async ({ browser }) => {
  await browser.setViewport(viewport);
});

// The desktop window keeps a 48 px title-bar strip for the native macOS traffic lights.
test("in the desktop app Studio opens below the title bar that holds the native window controls", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  await browser.addInitScript(desktopBridgeScript, desktopBridgeOptions("server"));

  // Act
  await app.open("/studio/flows");

  // Assert
  await expect
    .poll(() => screen.getByRole("dialog", "Studio").boundingBox())
    .toMatchObject({ x: 16, y: 48, width: 1408, height: 836 });
  await shot(app, browser, "studio-desktop-below-title-bar");
});

test("Flows, Agents and Triggers share one header, toolbar and group heading", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await app.open("/studio/flows");
  const blocked = screen.getByRole("link", /Launch blocked draft/);
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("Not ready");
  const nav = screen.getByRole("navigation", "Studio navigation");
  await expect(nav.getByText("Author", { exact: true })).toBeVisible();
  await expect(nav.getByText("Automate", { exact: true })).toBeVisible();
  const flows = await listChrome(browser, "Flows");
  await shot(app, browser, "flows-grouped");

  await nav.getByRole("link", "Agents", { exact: true }).tap();
  await expect(
    screen.getByRole("region", "Agent editor").getByRole("button", "Save", { exact: true }),
  ).toBeDisabled();
  const agents = await listChrome(browser, "Agents");
  sameChrome(flows, agents, "Agents");
  await shot(app, browser, "agents-list");

  await fixture.github.trigger({ name: "Journey · Atlas issues" });
  await nav.getByRole("link", "Triggers", { exact: true }).tap();
  await expect(screen.getByRole("button", "Journey · Atlas issues actions")).toBeVisible();
  const triggers = await listChrome(browser, "Triggers");
  sameChrome(flows, triggers, "Triggers");
  await shot(app, browser, "triggers-grouped");
});

test("the Flows owner filter lists All, Global and each Project", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/studio/flows");
  await expect(screen.getByRole("link", /Launch blocked draft/)).toBeVisible();

  // Act
  await screen.getByRole("combobox", "Owner filter: All", { exact: true }).tap();

  // Assert
  const owners = screen.getByRole("listbox", "Owner filter", { exact: true });
  await expect(owners.getByRole("option", "All", { exact: true })).toBeVisible();
  await expect(owners.getByRole("option", "Global", { exact: true })).toBeVisible();
  await expect(owners.getByRole("option", /^Northwind/)).toBeVisible();
  await shot(app, browser, "flows-owner-filter");
});

/** The Flows list filtered on a new Project titled `title`, whose id is returned. */
async function filterOnNewProject(
  app: App,
  screen: Screen,
  fixture: { projects: { add(input: { title: string }): Promise<{ id: string }> } },
  title: string,
) {
  const { id } = await fixture.projects.add({ title });
  await app.open("/studio/flows");
  await screen.getByRole("combobox", "Owner filter: All", { exact: true }).tap();
  await screen.getByRole("option", title, { exact: true }).tap();
  await expect(
    screen.getByRole("combobox", `Owner filter: ${title}`, { exact: true }),
  ).toBeVisible();
  return id;
}

test("the Owner filter names a filtered Project that left the catalog Unknown Project", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const id = await filterOnNewProject(app, screen, fixture, "Journey · Leaving Project");

  // Act
  await fixture.projects.forget({ id });

  // Assert
  await expect(
    screen.getByRole("combobox", "Owner filter: Unknown Project", { exact: true }),
  ).toBeVisible();
  await shot(app, browser, "owner-filter-unknown-project");
});

test("New Flow from a filter on a Project that left the catalog describes its owner as Unknown Project", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const id = await filterOnNewProject(app, screen, fixture, "Journey · Gone owner");
  await fixture.projects.forget({ id });
  await expect(
    screen.getByRole("combobox", "Owner filter: Unknown Project", { exact: true }),
  ).toBeVisible();

  // Act
  await screen.getByRole("button", "New Flow", { exact: true }).tap();

  // Assert
  const owner = screen
    .getByRole("dialog", "New Flow", { exact: true })
    .getByRole("combobox", "Owning Project", { exact: true });
  await expect(owner).toContainText("Unknown Project");
  expect(await descriptionOf(browser, owner)).toMatch(/^Unknown Project /);
  await shot(app, browser, "new-flow-unknown-owner");
});

test("a Flows search with no match says so", async ({ app, screen, browser }) => {
  // Arrange
  await app.open("/studio/flows");
  await expect(screen.getByRole("link", /Launch blocked draft/)).toBeVisible();

  // Act
  await screen.getByLabel("Search Flows", { exact: true }).fill("zzzz-no-such-flow");

  // Assert
  await expect(screen.getByText("No matching Flows", { exact: true })).toBeVisible();
  await shot(app, browser, "flows-search-no-match");
});

test("the Flows list in Light", async ({ app, screen, browser }) => {
  // Arrange
  await app.open("/settings/appearance");
  await screen.getByRole("radio", "Light", { exact: true }).tap();
  await expect(screen.getByRole("radio", "Light", { exact: true })).toBeChecked();

  // Act
  await app.open("/studio/flows");

  // Assert
  await expect(screen.getByRole("link", /Launch blocked draft/)).toBeVisible();
  await shot(app, browser, "flows-light");
});

test("a Flow whose Project left T3 stays listed and its menu only moves or removes it", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/studio/flows");
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  await revealGroup(browser, "Docs site");
  const docs = screen.getByRole("region", "Docs site", { exact: true });
  await expect(docs.getByText("Not in T3", { exact: true })).toBeVisible();
  await expect(docs.getByText("Docs refresh", { exact: true })).toBeVisible();
  await expect(docs.getByRole("link")).toHaveCount(0);
  await shot(app, browser, "flows-not-in-t3");
  await docs.getByRole("button", "Docs refresh actions", { exact: true }).tap();
  await expect(screen.getByRole("menuitem", "Change owner…", { exact: true })).toBeVisible();
  await expect(screen.getByRole("menuitem", "Remove…", { exact: true })).toBeVisible();
  await expect(screen.getByRole("menuitem", "Check now")).toHaveCount(0);
  await shot(app, browser, "flows-not-in-t3-menu");
});

/** The New Flow dialog, opened from the Flows list. */
async function openNewFlow(app: App, screen: Screen) {
  await app.open("/studio/flows");
  await screen.getByRole("button", "New Flow", { exact: true }).tap();
  return screen.getByRole("dialog", "New Flow", { exact: true });
}

/** New Flow with Project chosen as its owner kind; answers the dialog's Owning Project field. */
async function openProjectOwnedNewFlow(app: App, screen: Screen) {
  const dialog = await openNewFlow(app, screen);
  await dialog.getByRole("radio", "Project", { exact: true }).tap();
  return dialog.getByRole("combobox", "Owning Project", { exact: true });
}

test("New Flow opens quiet, with Create Flow unavailable and Global chosen", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/studio/flows");

  // Act
  await screen.getByRole("button", "New Flow", { exact: true }).tap();

  // Assert
  const dialog = screen.getByRole("dialog", "New Flow", { exact: true });
  await expect(dialog.getByRole("button", "Create Flow", { exact: true })).toBeDisabled();
  await expect(dialog.getByRole("radio", "Global", { exact: true })).toBeChecked();
  await shot(app, browser, "new-flow-blank");
});

test("a Project-owned New Flow lists the Projects that can own it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const owner = await openProjectOwnedNewFlow(app, screen);

  // Act
  await owner.tap();

  // Assert
  await expect(screen.getByRole("option", /^Northwind/)).toBeVisible();
  await shot(app, browser, "new-flow-owner");
});

test("a chosen Owning Project describes its field with the Project's title and path", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const owner = await openProjectOwnedNewFlow(app, screen);
  await owner.tap();

  // Act
  await screen.getByRole("option", /^Northwind/).tap();

  // Assert
  expect(await descriptionOf(browser, owner)).toMatch(/^Northwind \S*\/northwind$/);
});

test("a failed New Flow create reports one card and keeps the entered name", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const dialog = await openNewFlow(app, screen);
  await refuseFlowCreate(browser);
  await dialog.getByLabel("Flow name", { exact: true }).fill("Unsaved draft");

  // Act
  await dialog.getByRole("button", "Create Flow", { exact: true }).tap();

  // Assert
  await expect(dialog.getByRole("alert")).toContainText("Couldn’t create the Flow");
  await expect(dialog.getByLabel("Flow name")).toHaveValue("Unsaved draft");
  await shot(app, browser, "new-flow-failed");
});

/** An exported Northwind Flow file, beside which the Import journeys write their variants. */
async function northwindExport(baseUrl: string | undefined) {
  const northwind = await ownedFlow(baseUrl, "Northwind release");
  return exportDefinitionFile(baseUrl, "flow", northwind.id);
}

/** The Flows list, ready to import. */
async function openFlowsForImport(app: App, screen: Screen) {
  await app.open("/studio/flows");
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Import", { exact: true })).toBeEnabled();
}

test("Import reviews a Flow file whose Agent needs a model", async ({ app, screen, browser }) => {
  // Arrange
  await browser.setViewport(viewport);
  const needsModel = await exportWithoutAgentModels(await northwindExport(app.baseUrl));
  await openFlowsForImport(app, screen);

  // Act
  await screen.getByLabel("Choose a Factory export file").setInputFiles([needsModel]);

  // Assert
  const review = screen.getByRole("dialog", /^Import “/);
  await expect(review).toContainText("Imported prompts run with your T3 permissions");
  await expect(review).toContainText("Read them in Studio before you start a Run.");
  const model = review.getByRole("combobox", /^Model for Northwind QA/);
  await expect(model).toHaveAttribute("aria-invalid", "true");
  const cardId = await model.getAttribute("aria-describedby");
  await expect(browser.locator(`[id=${JSON.stringify(cardId)}]`)).toContainText(
    "Choose a model here or in Studio after importing.",
  );
  await expect(review.getByRole("group", /Northwind QA/)).toContainText("Needs a model");
  await expect(review.getByRole("button", "Import", { exact: true })).toBeEnabled();
  await shot(app, browser, "import-needs-model");
});

test("Import rejects a file it cannot read and offers another file", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport(viewport);
  const rejected = (await northwindExport(app.baseUrl)).replace(/\.json$/, ".rejected.json");
  await writeFile(rejected, "{ not json");
  await openFlowsForImport(app, screen);

  // Act
  await screen.getByLabel("Choose a Factory export file").setInputFiles([rejected]);

  // Assert
  const refused = screen.getByRole("dialog", /^Import “/);
  await expect(refused.getByRole("alert")).toBeVisible();
  await expect(refused.getByRole("button", "Choose another file", { exact: true })).toBeVisible();
  await shot(app, browser, "import-rejected");
});

test("Remove on a Flow a Trigger uses lists that Trigger and does not remove the Flow", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  await fixture.github.trigger({ name: "Journey · Holds the Flow" });
  await app.open("/studio/flows");
  await screen.getByLabel("Search Flows", { exact: true }).fill("Demo · Focused change");
  await screen.getByRole("button", "Demo · Focused change actions", { exact: true }).tap();
  await screen.getByRole("menuitem", "Remove…", { exact: true }).tap();
  const dialog = screen.getByRole("dialog", /Can’t remove/);
  await expect(dialog.getByRole("list", "Triggers", { exact: true })).toContainText(
    "Journey · Holds the Flow",
  );
  await shot(app, browser, "remove-flow-blocked");
  await expect(screen.getByRole("button", "Remove Flow")).toHaveCount(0);
});

test("an Agent whose Project left T3 can be removed only after the Flow that places it is gone", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/studio/agents");
  await expect(screen.getByRole("region", "Agent editor")).toBeVisible();
  await revealGroup(browser, "Docs site");
  const docs = screen.getByRole("region", "Docs site", { exact: true });
  await expect(docs.getByText("Docs writer", { exact: true })).toBeVisible();
  await expect(docs.getByText("Not in T3", { exact: true })).toBeVisible();
  await shot(app, browser, "agents-not-in-t3");
  await docs.getByRole("button", "Docs writer actions", { exact: true }).tap();
  await screen.getByRole("menuitem", "Remove…", { exact: true }).tap();
  const blocked = screen.getByRole("dialog", /Can’t remove/);
  await expect(blocked.getByRole("list", "Flows", { exact: true })).toContainText("Docs refresh");
  await shot(app, browser, "agents-remove-blocked");
});

test("an Agents search with no match while the New Agent draft is open says No matching Agents", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  // A saved Agent stays listed while open, so the draft is open to leave nothing selected to keep.
  await app.open("/studio/agents");
  await screen.getByRole("button", "New Agent", { exact: true }).tap();
  const editor = screen.getByRole("region", "Agent editor");
  await expect(editor.getByRole("button", "Create Agent", { exact: true })).toBeVisible();

  // Act
  await screen.getByLabel("Search Agents", { exact: true }).fill("zzzz-no-such-agent");

  // Assert
  await expect(screen.getByText("No matching Agents", { exact: true })).toBeVisible();
  await shot(app, browser, "agents-search-no-match");
});

test("New Agent turns outline while the New Agent draft is open", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await app.open("/studio/agents");
  await expect(screen.getByRole("region", "Agent editor")).toBeVisible();
  const newAgent = screen.getByRole("button", "New Agent", { exact: true });
  await expect(newAgent).toHaveAttribute("data-variant", "default");

  // Act
  await newAgent.tap();

  // Assert
  await expect(newAgent).toHaveAttribute("data-variant", "outline");
  await shot(app, browser, "agents-new-draft");
});

test("a New Agent draft whose name is cleared keeps Create Agent neutral and disabled", async ({
  app,
  screen,
}) => {
  // Arrange
  await app.open("/studio/agents");
  await screen.getByRole("button", "New Agent", { exact: true }).tap();
  const editor = screen.getByRole("region", "Agent editor");
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("Draft name");
  const create = editor.getByRole("button", "Create Agent", { exact: true });
  await expect(create).toBeEnabled();

  // Act
  await name.fill("");

  // Assert
  await expect(create).toBeDisabled();
  await expect(create).toHaveAttribute("data-variant", "outline");
});

test("Triggers with none yet shows its empty state without an owner filter", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: no Trigger exists at the start of a journey.

  // Act
  await app.open("/studio/triggers");

  // Assert
  await expect(screen.getByRole("heading", "No Triggers yet", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Search Triggers", { exact: true })).toBeVisible();
  await expect(screen.getByRole("combobox", "Owner filter: All")).toHaveCount(0);
  await shot(app, browser, "triggers-empty");
});

const checkName = "Journey · Check feedback";

/** The Triggers list holding one Trigger named `name`. */
async function openTriggers(
  app: App,
  fixture: { github: { trigger(input: { name: string }): Promise<unknown> } },
  name: string,
) {
  await fixture.github.trigger({ name });
  await app.open("/studio/triggers");
}

/** Check now from the actions menu of the Trigger named `name`. */
async function checkNow(screen: Screen, name: string) {
  await screen.getByRole("button", `${name} actions`, { exact: true }).tap();
  await screen.getByRole("menuitem", "Check now", { exact: true }).tap();
}

test("a Trigger's menu offers Check now, Edit and Remove", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await openTriggers(app, fixture, checkName);

  // Act
  await screen.getByRole("button", `${checkName} actions`, { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("menuitem", "Check now", { exact: true })).toBeVisible();
  await expect(screen.getByRole("menuitem", "Edit", { exact: true })).toBeVisible();
  await expect(screen.getByRole("menuitem", "Remove", { exact: true })).toBeVisible();
  await shot(app, browser, "triggers-menu");
});

test("Check now shows Checking… while the check is running", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await openTriggers(app, fixture, checkName);

  await whileTriggerChecksHeld(browser, async () => {
    // Act
    await checkNow(screen, checkName);

    // Assert
    await expect(screen.getByText("Checking…", { exact: true })).toBeVisible();
    await shot(app, browser, "triggers-checking");
  });
});

test("Check now with no ready issue reports nothing ready to start", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await openTriggers(app, fixture, checkName);

  // Act
  await checkNow(screen, checkName);

  // Assert
  await expect(screen.getByText("Nothing ready to start", { exact: true })).toBeVisible();
  await shot(app, browser, "triggers-nothing-ready");
});

test("Check now that starts one Run links that Run from the row", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await fixture.github.issue({ number: 11, title: "Ship the toggle", labels: ["factory:ready"] });
  await openTriggers(app, fixture, checkName);

  // Act
  await checkNow(screen, checkName);

  // Assert
  await expect(screen.getByRole("link", "1 Run", { exact: true })).toHaveAttribute(
    "href",
    /^\/runs\/[^/]+$/,
  );
  await expect(screen.getByRole("link", new RegExp(checkName)).getByRole("button")).toHaveCount(0);
  await shot(app, browser, "triggers-started-one");
});

/**
 * A Trigger named `name` with three free slots and three ready issues numbered from `first`, open
 * in the Triggers list. Each journey uses its own issues, so no issue already has a Run.
 */
async function threeReady(
  app: App,
  fixture: {
    github: {
      trigger(input: { name: string }): Promise<unknown>;
      issue(input: { number: number; title: string; labels: string[] }): Promise<unknown>;
    };
  },
  name: string,
  first: number,
) {
  await fixture.github.trigger({ name });
  await allowRuns(app.baseUrl, name, 3);
  await fixture.github.issue({
    number: first,
    title: "Ship the footer",
    labels: ["factory:ready"],
  });
  await fixture.github.issue({
    number: first + 1,
    title: "Ship the header",
    labels: ["factory:ready"],
  });
  await fixture.github.issue({
    number: first + 2,
    title: "Ship the title",
    labels: ["factory:ready"],
  });
  await app.open("/studio/triggers");
}

test("Check now that starts several Runs reports their count on the row", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Three runs";
  await threeReady(app, fixture, name, 12);

  // Act
  await checkNow(screen, name);

  // Assert
  await expect(screen.getByRole("button", "3 Runs", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", new RegExp(name)).getByRole("button")).toHaveCount(0);
});

test("the count of Runs a check started lists each of them", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Three runs listed";
  await threeReady(app, fixture, name, 15);
  await checkNow(screen, name);
  await expect(screen.getByRole("button", "3 Runs", { exact: true })).toBeVisible();

  // Act
  await screen.getByRole("button", "3 Runs", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("menuitem")).toHaveCount(3);
  await shot(app, browser, "triggers-started-three");
});

test("a Trigger that cannot check shows Problem on the row and Error in the sidebar", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  const name = "Journey · Signed-out list";
  await fixture.github.trigger({ name });
  await fixture.github.host({ signedIn: false });
  await app.open("/studio/triggers");
  await screen.getByRole("button", `${name} actions`, { exact: true }).tap();
  await screen.getByRole("menuitem", "Check now", { exact: true }).tap();
  await screen.getByRole("menu").press("Escape");
  const row = screen.getByRole("link", new RegExp(name));
  await expect(row).toContainText("Problem");
  await expect(row).toContainText("Factory runs as.");
  await expect(
    screen.getByRole("navigation", "Studio navigation").getByText("1 Trigger in Error"),
  ).toBeAttached();
  await shot(app, browser, "triggers-problem");
});

test("empty Flows and Agents, and the composer’s Go to links return with the draft kept", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange — with Agents still present, the composer asks for the first Flow.
  await fixture.definitions.removeFlows();
  await app.open("/studio/flows");
  await expect(screen.getByRole("heading", "No Flows yet", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Search Flows", { exact: true })).toBeVisible();
  await shot(app, browser, "flows-empty");

  await app.open("/runs/new");
  await expect(screen.getByRole("link", "Go to Agents", { exact: true })).toHaveCount(0);
  const prompt = screen.getByRole("textbox", /Initial prompt/);
  await prompt.fill("Keep this draft");
  await shot(app, browser, "composer-first-flow");
  await screen.getByRole("link", "Go to Flows", { exact: true }).tap();
  await expect(screen.getByRole("heading", "No Flows yet", { exact: true })).toBeVisible();
  await shot(app, browser, "flows-empty-from-composer");
  await screen.getByRole("dialog", "Studio", { exact: true }).press("Escape");
  await expect(screen.getByRole("dialog", "Studio")).toHaveCount(0);
  await expect(prompt).toContainText("Keep this draft");

  // Dispose of the remaining definitions to exercise the first-Agent path.
  await fixture.definitions.removeAgents();
  await app.open("/studio/agents");
  await expect(screen.getByRole("heading", "No Agents yet", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Search Agents", { exact: true })).toBeVisible();
  await shot(app, browser, "agents-empty");
  await app.open("/runs/new");
  const kept = screen.getByRole("textbox", /Initial prompt/);
  await expect(kept).toContainText("Keep this draft");
  await expect(screen.getByRole("link", "Go to Agents", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Go to Flows", { exact: true })).toHaveCount(0);
  await shot(app, browser, "composer-first-agent");
  await screen.getByRole("link", "Go to Agents", { exact: true }).tap();
  await expect(screen.getByRole("heading", "No Agents yet", { exact: true })).toBeVisible();
  await shot(app, browser, "agents-empty-from-composer");
  await screen.getByRole("dialog", "Studio", { exact: true }).press("Escape");
  await expect(screen.getByRole("dialog", "Studio")).toHaveCount(0);
  await expect(kept).toContainText("Keep this draft");
});
