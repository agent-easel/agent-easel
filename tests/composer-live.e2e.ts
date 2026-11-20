import { afterEach, beforeEach, test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import { browserRequests, resetBrowserRequests } from "./support/live.ts";
import { elapse } from "./support/remote-access.ts";
import { removeFlowElsewhere, saveFlowCopy } from "./support/flows.ts";
import {
  projectSelection,
  restoreProjectSelection,
  selectComposerProject,
} from "./support/composer.ts";

/** Flows a journey saved, removed afterwards so later journeys do not list them. */
const savedFlows: string[] = [];
/** Factory's selected Project, which the Project picker changes for every client. */
let selection: string | null = null;

beforeEach(async ({ app }) => {
  selection = await projectSelection(app.baseUrl);
});

afterEach(async ({ app }) => {
  for (const id of savedFlows.splice(0)) await removeFlowElsewhere(app.baseUrl, id);
  await restoreProjectSelection(app.baseUrl, selection);
});

/** Updater checks have their own schedule and are reported separately. */
const launchChoiceRequests = async (app: { baseUrl: string | undefined }) =>
  (await browserRequests(app)).filter((request) => request !== "GET /api/server-update");

test("an idle Run composer sends no periodic launch-choice requests", async ({ app, screen }) => {
  // Arrange
  await app.open("/runs/new");
  await expect(screen.getByRole("combobox", /^Select Flow: /)).toBeVisible();
  await expect(screen.getByRole("button", /^Select project: /)).toBeVisible();
  // Either state means the initial reporting reads, Agents included, have answered.
  await expect(
    screen.getByRole("link", /^Settings, (Connected|Agent reporting needs attention)$/),
  ).toBeVisible();
  await resetBrowserRequests(app);

  // Act
  // Longer than two former polling periods of the Flow, policy and project reads.
  await elapse(11_000);

  // Assert
  expect(await launchChoiceRequests(app)).toEqual([]);
});

test("a ready Flow saved in another window appears in an open Run composer", async ({
  app,
  screen,
}) => {
  // Arrange
  await app.open("/runs/new");
  await screen.getByRole("combobox", /^Select Flow: /).tap();
  await expect(screen.getByRole("listbox", "Flow", { exact: true })).toBeVisible();

  // Act
  savedFlows.push(
    await saveFlowCopy(app.baseUrl, "Demo · Focused change", "Live composer Flow", {
      mode: "checkout",
    }),
  );

  // Assert
  await expect(screen.getByRole("option", "Live composer Flow", { exact: true })).toBeVisible();
});

const flowPicker = (screen: Screen) => screen.getByRole("combobox", /^Select Flow: /);
const promptField = (screen: Screen) => screen.getByLabel("Initial prompt", { exact: false });

/** A composer with Northwind, its Flow Northwind release and a prompt. */
async function composeForNorthwind(app: App, screen: Screen) {
  await app.open("/runs/new");
  await selectComposerProject(screen, "Northwind");
  await flowPicker(screen).tap();
  const projectFlow = screen.getByRole("option", "Northwind release", { exact: true });
  await expect(projectFlow).toBeVisible();
  await app.screenshot("composer-project-flow-picker");
  await projectFlow.tap();
  await promptField(screen).fill("UI Project switch");
}

test("switching Project silently clears another Project's Flow and keeps the prompt", async ({
  app,
  screen,
}) => {
  // Arrange
  await composeForNorthwind(app, screen);

  // Act
  await selectComposerProject(screen, "Atlas demo");

  // Assert
  await expect(flowPicker(screen)).toHaveAccessibleName("Select Flow: Choose a Flow");
  await expect(promptField(screen)).toHaveText("UI Project switch");
  await app.screenshot("composer-flow-cleared-after-project-switch");
});

test("a Flow cleared by switching Project stays cleared after a reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await composeForNorthwind(app, screen);
  await selectComposerProject(screen, "Atlas demo");
  await expect(flowPicker(screen)).toHaveAccessibleName("Select Flow: Choose a Flow");

  // Act
  await browser.reload();

  // Assert
  await expect(flowPicker(screen)).toHaveAccessibleName("Select Flow: Choose a Flow");
  await expect(promptField(screen)).toHaveText("UI Project switch");
});

test("without a selected Project the Flow picker is disabled", async ({ app, screen, browser }) => {
  // Arrange — the menu offers no row that clears the Project, so the selection is cleared here.
  await restoreProjectSelection(app.baseUrl, null);
  await app.open("/runs/new");
  await browser.evaluate(`(() => {
    localStorage.removeItem("factory-last-project:browser");
    localStorage.removeItem("factory-last-flow:browser");
    localStorage.removeItem("factory-run-drafts:browser");
  })()`);

  // Act
  await browser.reload();

  // Assert
  await expect(flowPicker(screen)).toBeDisabled();
  await app.screenshot("composer-flow-picker-without-project");
});
