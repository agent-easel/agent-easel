import assert from "node:assert/strict";
import type { FlowDraft } from "../packages/contracts/src/index.ts";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import { beforeEach, test } from "./support/test.ts";
import type { Fixture } from "./support/fixture/handle.ts";
import { selectComposerProject } from "./support/composer.ts";
import {
  chooseComposerFlow,
  flowList,
  openComposerMenus,
  openFlowMenu,
  pageString,
  readFactoryJson,
} from "./support/composer-menus.ts";

beforeEach(async ({ app, browser, screen }) => {
  await openComposerMenus(app, browser, screen);
});

type Journey = { app: App; browser: Browser; fixture: Fixture };

/** Northwind release chosen in the composer, and its saved Flow. */
async function chooseNorthwindRelease(app: App, screen: Screen) {
  await selectComposerProject(screen, "Northwind");
  await chooseComposerFlow(screen, "Northwind release");
  const flows = await readFactoryJson<FlowDraft[]>(app.baseUrl, "/api/flows");
  const selected = flows.find((flow) => flow.name === "Northwind release");
  assert(selected);
  return selected;
}

/** That chosen Flow deleted, and the field cleared. */
async function deletedChosenFlow(app: App, screen: Screen, fixture: Fixture) {
  const selected = await chooseNorthwindRelease(app, screen);
  await fixture.definitions.removeFlow({ id: selected.id });
  await expect(screen.getByLabel("Flow", { exact: true })).toHaveAccessibleName(
    "Select Flow: Choose a Flow",
  );
}

/** Only the not-ready seeded draft remains, in a reloaded composer. */
async function keepOnlyNotReadyDraft({ app, browser, fixture }: Journey) {
  const flows = await readFactoryJson<FlowDraft[]>(app.baseUrl, "/api/flows");
  const draft = flows.find((flow) => flow.name === "Demo · Release checklist (draft)");
  assert(draft);
  await fixture.definitions.removeFlows({ keepId: draft.id });
  await browser.reload();
}

/** That composer with Northwind chosen and its Flow menu open. */
async function notReadyOnlyMenu(journey: Journey & { screen: Screen }) {
  await keepOnlyNotReadyDraft(journey);
  await selectComposerProject(journey.screen, "Northwind");
  await openFlowMenu(journey.screen);
}

test("a deleted chosen Flow clears the field without a notice", async ({
  app,
  screen,
  fixture,
}) => {
  // Arrange
  const selected = await chooseNorthwindRelease(app, screen);

  // Act
  await fixture.definitions.removeFlow({ id: selected.id });

  // Assert
  await expect(
    screen.getByRole("combobox", "Select Flow: Choose a Flow", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("Selected Flow unavailable", { exact: true })).toHaveCount(0);
});

test("a deleted Flow is no longer listed", async ({ app, screen, fixture }) => {
  // Arrange
  await deletedChosenFlow(app, screen, fixture);

  // Act
  await openFlowMenu(screen);

  // Assert
  await expect(screen.getByRole("option", "Northwind release", { exact: true })).toHaveCount(0);
  await app.screenshot("after-flow-deleted");
});

test("with only not-ready Flows the composer shows the No ready Flows card", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await keepOnlyNotReadyDraft({ app, browser, fixture });

  // Act
  await selectComposerProject(screen, "Northwind");

  // Assert
  await expect(screen.getByText("No ready Flows for Northwind", { exact: true })).toBeVisible();
  await app.screenshot("after-no-ready-flows");
});

test("a menu of only not-ready Flows lists them disabled and adds no status line", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await keepOnlyNotReadyDraft({ app, browser, fixture });
  await selectComposerProject(screen, "Northwind");

  // Act
  await openFlowMenu(screen);

  // Assert
  await expect(screen.getByRole("option", { disabled: false })).toHaveCount(0);
  await expect(screen.getByRole("searchbox", "Search Flows", { exact: true })).toHaveCount(0);
  await expect(
    screen.getByRole("option", "Demo · Release checklist (draft) Not ready", { exact: true }),
  ).toBeDisabled();
  await expect(flowList(screen).getByText("No Flows yet", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("No matching Flows", { exact: true })).toHaveCount(0);
  await expect(screen.getByText("No ready Flows for Northwind", { exact: true })).toBeVisible();
  await app.screenshot("after-flow-all-disabled");
});

test("ArrowDown in a menu of only not-ready Flows focuses no disabled row", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await notReadyOnlyMenu({ app, screen, browser, fixture });

  // Act
  await browser.keyboard.press("ArrowDown");

  // Assert
  expect(
    pageString(
      await browser.evaluate(`document.activeElement?.getAttribute("aria-disabled") ?? ""`),
    ),
  ).not.toBe("true");
});

test("with no Flows the menu says No Flows yet and the card offers to create one", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await fixture.definitions.removeFlows();
  await browser.reload();
  await selectComposerProject(screen, "Northwind");

  // Act
  await openFlowMenu(screen);

  // Assert
  await expect(flowList(screen).getByText("No Flows yet", { exact: true })).toBeVisible();
  await expect(screen.getByRole("option")).toHaveCount(0);
  await expect(screen.getByText("Create your first Flow", { exact: true })).toBeVisible();
  await app.screenshot("after-flow-none");
});
