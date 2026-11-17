import { test } from "./support/test.ts";
import { expect } from "e2e";
import { browserRequests, resetBrowserRequests } from "./support/live.ts";
import { elapse } from "./support/remote-access.ts";
import { removeFlowElsewhere, saveFlowCopy } from "./support/flows.ts";
import {
  projectSelection,
  restoreProjectSelection,
  selectComposerProject,
} from "./support/composer.ts";

/** Updater checks have their own schedule and are reported separately. */
const launchChoiceRequests = async (app: { baseUrl: string | undefined }) =>
  (await browserRequests(app)).filter((request) => request !== "GET /api/server-update");

test("an idle Run composer sends no periodic launch-choice requests", async ({ app, screen }) => {
  // Arrange
  await app.open("/runs/new");
  await expect(screen.getByRole("button", /^Select Flow: /)).toBeVisible();
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
  await screen.getByRole("button", /^Select Flow: /).tap();
  await expect(screen.getByRole("group", "Flows")).toBeVisible();

  // Act
  const flow = await saveFlowCopy(app.baseUrl, "Demo · Focused change", "Live composer Flow", {
    mode: "checkout",
  });

  // Assert
  await expect(
    screen.getByRole("menuitemradio", "Live composer Flow", { exact: true }),
  ).toBeVisible();
  await removeFlowElsewhere(app.baseUrl, flow);
});

test("switching Project silently clears another Project's Flow and no Project disables the Flow picker", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const selection = await projectSelection(app.baseUrl);
  const flowPicker = screen.getByRole("button", /^Select Flow: /);
  const prompt = screen.getByLabel("Initial prompt", { exact: false });
  await app.open("/runs/new");
  await selectComposerProject(screen, "Northwind");
  await flowPicker.tap();
  const projectFlow = screen.getByRole("menuitemradio", "Northwind release", { exact: true });
  await expect(projectFlow).toBeVisible();
  await app.screenshot("composer-project-flow-picker");
  await projectFlow.tap();
  await prompt.fill("UI Project switch");

  // Act
  await selectComposerProject(screen, "Atlas demo");

  // Assert
  await expect(flowPicker).toHaveAccessibleName("Select Flow: Choose a Flow");
  await expect(prompt).toHaveText("UI Project switch");
  await app.screenshot("composer-flow-cleared-after-project-switch");
  await browser.reload();
  await expect(flowPicker).toHaveAccessibleName("Select Flow: Choose a Flow");
  await expect(prompt).toHaveText("UI Project switch");
  await selectComposerProject(screen, null);
  await expect(flowPicker).toBeDisabled();
  await app.screenshot("composer-flow-picker-without-project");
  await restoreProjectSelection(app.baseUrl, selection);
});
