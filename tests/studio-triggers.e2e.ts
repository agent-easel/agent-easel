import assert from "node:assert/strict";
import { expect, type Screen } from "e2e";
import type { Result, RunNavigationEntry } from "../packages/contracts/src/index.ts";
import { archiveJourneyRun } from "./support/run-history.ts";
import { afterEach, beforeEach, test } from "./support/test.ts";

/** Runs a journey's Trigger started, archived afterwards so later journeys do not list them. */
const startedRuns: string[] = [];

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 1000 });
});

afterEach(async ({ app }) => {
  for (const runId of startedRuns.splice(0)) await archiveJourneyRun(app.baseUrl, runId);
});

const studioNavigation = (screen: Screen) => screen.getByRole("navigation", "Studio navigation");

async function runFromMenu(screen: Screen, trigger: string) {
  await screen.getByRole("button", `${trigger} actions`, { exact: true }).tap();
  await screen.getByRole("menuitem", "Run", { exact: true }).tap();
}

/** Opens the named Trigger from the list; answers its status strip once it shows Error. */
async function openedInError(screen: Screen, trigger: string) {
  await screen.getByRole("link", trigger, { exact: true }).tap();
  const status = screen.getByRole("region", "Trigger status");
  await expect(status.getByText("Error", { exact: true })).toBeVisible();
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
  await screen.getByRole("link", /^GitHub Issues/).tap();
  await screen.getByLabel("Name", { exact: true }).fill(name);
  await screen.getByLabel("Project", { exact: true }).selectOption("Atlas demo");
  await expect(screen.getByText("factory-demo/atlas", { exact: true })).toBeVisible();
  await screen.getByRole("combobox", "Flow", { exact: true }).selectOption("Demo · Focused change");
  await screen.getByRole("button", "Review and enable", { exact: true }).tap();
  const review = screen.getByRole("dialog");
  await expect(review.getByRole("heading", "No issues ready", { exact: true })).toBeVisible();
  await app.screenshot("trigger-review");
  await review.getByRole("button", "Enable and check", { exact: true }).tap();
  const status = screen.getByRole("region", "Trigger status");
  await expect(status.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(status.getByText(/ · started 0 · next check /)).toBeVisible();
  await fixture.github.issue({
    number: 7,
    title: "Add a dark mode toggle to settings",
    labels: ["factory:ready"],
  });
  await studioNavigation(screen).getByRole("link", "Triggers", { exact: true }).tap();
  await runFromMenu(screen, name);
  await screen.getByRole("link", name, { exact: true }).tap();
  await expect(status.getByText(/ · started 1 · next check /)).toBeVisible();
  await screen.getByRole("button", "Back to Runs", { exact: true }).tap();
  await screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link")
    .filter({ hasText: "factory-demo/atlas#7: Add a dark mode toggle to settings" })
    .tap();
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

test("an opened Trigger returns to the Trigger list from its back link", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const name = "Journey · Back to the list";
  await fixture.github.trigger({ name });
  await app.open("/studio/triggers");
  await screen.getByRole("link", name, { exact: true }).tap();
  await expect(screen.getByRole("heading", name, { exact: true })).toBeVisible();

  // Act
  await screen.getByRole("link", "All Triggers", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("button", `${name} actions`, { exact: true })).toBeVisible();
});

test("a Trigger whose host gh is signed out shows Error with the host step that repairs it", async ({
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
  await expect(
    screen.getByText(`GitHub can't be read: ${guidance} Factory runs as.`),
  ).toBeVisible();
  await expect(studioNavigation(screen).getByText("1 Trigger in Error")).toBeAttached();
  const status = await openedInError(screen, name);
  await expect(status).toContainText(`${guidance} Factory runs as. Nothing starts until`);
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
  const status = await openedInError(screen, name);
  await expect(status).toContainText("choose Confirm this repository under Repository");
  await expect(screen.getByText("Detected now", { exact: true })).toBeVisible();
  await expect(screen.getByText("factory-demo/atlas-next", { exact: true })).toBeVisible();
  await app.screenshot("trigger-repository-reconfirm");
  await screen.getByRole("button", "Confirm this repository", { exact: true }).tap();
  await screen.getByRole("button", "Save", { exact: true }).tap();
  const review = screen.getByRole("dialog");
  await expect(review.getByText(/factory-demo\/atlas-next/)).toBeVisible();
  await expect(review.getByRole("heading", "No issues ready", { exact: true })).toBeVisible();
  await app.screenshot("trigger-repository-review");

  // Act
  await review.getByRole("button", "Apply and check", { exact: true }).tap();

  // Assert
  await expect(status.getByText("Healthy", { exact: true })).toBeVisible();
  await expect(screen.getByText(/ · factory-demo\/atlas-next · /, { exact: false })).toBeVisible();
  await expect(studioNavigation(screen).getByText("1 Trigger in Error")).not.toBeAttached();
});
