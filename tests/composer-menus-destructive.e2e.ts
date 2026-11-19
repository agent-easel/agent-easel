import assert from "node:assert/strict";
import type { FlowDraft } from "../packages/contracts/src/index.ts";
import { expect } from "e2e";
import { beforeEach, test } from "./support/test.ts";
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

test("a deleted Flow clears, and a menu of only not-ready Flows adds no status line", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange — choose a ready Flow, then delete it.
  await selectComposerProject(screen, "Northwind");
  await chooseComposerFlow(screen, "Northwind release");
  const flows = await readFactoryJson<FlowDraft[]>(app.baseUrl, "/api/flows");
  const selected = flows.find((flow) => flow.name === "Northwind release");
  assert(selected);

  // Act
  await fixture.definitions.removeFlow({ id: selected.id });

  // Assert
  await expect(
    screen.getByRole("combobox", "Select Flow: Choose a Flow", { exact: true }),
  ).toBeVisible();
  await expect(screen.getByText("Selected Flow unavailable", { exact: true })).toHaveCount(0);
  await openFlowMenu(screen);
  await expect(screen.getByRole("option", "Northwind release", { exact: true })).toHaveCount(0);
  await app.screenshot("after-flow-deleted");
  await browser.keyboard.press("Escape");

  // Arrange — leave only the not-ready draft.
  const draft = flows.find((flow) => flow.name === "Demo · Release checklist (draft)");
  assert(draft);
  await fixture.definitions.removeFlows({ keepId: draft.id });
  await browser.reload();
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
  await browser.keyboard.press("ArrowDown");
  expect(
    pageString(
      await browser.evaluate(`document.activeElement?.getAttribute("aria-disabled") ?? ""`),
    ),
  ).not.toBe("true");
  await app.screenshot("after-flow-all-disabled");
  await browser.keyboard.press("Escape");
  await app.screenshot("after-no-ready-flows");

  // Arrange — remove the last Flow.
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
