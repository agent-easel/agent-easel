import assert from "node:assert/strict";
import type { Browser } from "@e2e-dev/web";
import { test } from "./support/test.ts";
import { expect, type Screen } from "e2e";
import { copyAgentDefinition } from "./support/agents.ts";
import { saveFlowCopy } from "./support/flows.ts";
import { namedAgent, ownedFlow } from "./support/owners.ts";

/** Settles popover and menu transitions before a screenshot. */
const settled =
  "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished))";

async function expectStudioViewport(screen: Screen, browser: Browser) {
  await expect
    .poll(() => screen.getByRole("dialog", "Studio").boundingBox())
    .toMatchObject({ x: 16, y: 16, width: 1568, height: 968 });
  await expect
    .poll(() =>
      browser.evaluate(`getComputedStyle(document.querySelector('[data-studio]')).opacity`),
    )
    .toBe("1");
}

test("capture Studio and an authored Flow that survives reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await app.open("/studio/flows");
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  await expectStudioViewport(screen, browser);
  await expect
    .poll(() => browser.locator("[data-studio] aside").boundingBox())
    .toMatchObject({
      width: 192,
    });
  await app.screenshot("studio-flows");
  await app.open("/studio/agents");
  await expect(screen.getByRole("heading", "Agents", { exact: true })).toBeVisible();
  await expectStudioViewport(screen, browser);
  await app.screenshot("studio-agents");
  await app.open("/runs/new");
  await expect(screen.getByRole("heading", /What should we work on/)).toBeVisible();
  await app.screenshot("runs");
  await app.open("/settings/connection");
  await expect(screen.getByRole("heading", "T3 connection", { exact: true })).toBeVisible();
  await app.screenshot("settings-connection");
  await app.open("/settings/agent-reporting");
  await expect(screen.getByRole("heading", "Agent reporting", { exact: true })).toBeVisible();
  await app.screenshot("agent-reporting");
  await app.open("/studio/flows");
  await screen.getByRole("button", "New Flow").tap();
  await screen.getByLabel("Flow name").fill("Screenshot review Flow");
  await screen.getByRole("button", "Create Flow").tap();
  await screen.getByRole("button", "Add Sample worker").tap();
  await screen
    .getByRole("button", "Connect Flow input")
    .dragTo(screen.getByRole("article", "Block Sample worker"));
  await expectStudioViewport(screen, browser);
  await app.screenshot("flow-before-save");

  // Act
  await screen.getByRole("button", "Save").tap();

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 2");
  await browser.reload();
  await expect(screen.getByLabel("Flow name")).toHaveValue("Screenshot review Flow");
  await expect(screen.getByRole("article", /^Block /)).toHaveCount(1);
  await expectStudioViewport(screen, browser);
  await expect
    .poll(async () => (await screen.getByLabel("Flow name").boundingBox())?.y)
    .toBeLessThan(120);
  await app.screenshot("flow-saved-after-reload");
});

test("capture the Agent editor with its model picker and More actions, global and Project-owned", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: Figma SA01's 1440 × 900 frame, a global Agent with a Northwind override.
  await browser.setViewport({ width: 1440, height: 900 });
  const northwind = (await ownedFlow(app.baseUrl, "Northwind release")).projectId;
  assert(northwind);
  const sample = await namedAgent(app.baseUrl, "Sample worker");
  assert(sample.execution);
  const global = await copyAgentDefinition(app.baseUrl, "Sample worker", "Coder", {
    projectOverrides: [
      {
        projectId: northwind,
        execution: { ...sample.execution, modelOptions: [{ id: "reasoning", value: "low" }] },
      },
    ],
  });
  await app.open(`/studio/agents/${global.id}`);
  const picker = screen.getByRole("button", /^Worker: /);
  await expect(picker).toBeVisible();
  await app.screenshot("studio-agent-global");
  await picker.tap();
  await expect(
    screen.getByRole("list", "Project overrides").getByText("Northwind", { exact: true }),
  ).toBeVisible();
  await browser.evaluate(settled);
  await app.screenshot("studio-agent-picker-open-global");
  await screen.getByRole("dialog", "Worker").press("Escape");
  await screen.getByRole("button", "More actions", { exact: true }).tap();
  await browser.evaluate(settled);
  await app.screenshot("studio-agent-more-actions");
  await screen.getByRole("menu").press("Escape");
  const qa = await namedAgent(app.baseUrl, "Northwind QA");
  await app.open(`/studio/agents/${qa.id}`);
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue("Northwind QA");
  await app.screenshot("studio-agent-project");

  // Act
  await picker.tap();

  // Assert: a Project Agent's picker has the Worker settings and no Project overrides.
  await expect(screen.getByRole("dialog", "Worker")).toBeVisible();
  await expect(screen.getByRole("list", "Project overrides")).toHaveCount(0);
  await browser.evaluate(settled);
  await app.screenshot("studio-agent-picker-open-project");
});

test("capture the Flow editor's library and toolbar at 1280 px", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange: the narrowest desktop width the toolbar must fit without overflowing.
  await browser.setViewport({ width: 1280, height: 800 });
  const id = await saveFlowCopy(
    app.baseUrl,
    "Demo · Grill, spec and tickets",
    "Screenshot library Flow",
    { mode: "checkout" },
  );
  await app.open(`/studio/flows/${id}`);
  const library = screen.getByRole("region", "Block library");
  await expect(library.getByRole("textbox", "Search steps and Agents")).toBeVisible();
  await app.screenshot("flow-editor-library-toolbar");
  await library.getByRole("button", "Add Sample worker", { exact: true }).hover();
  await app.screenshot("flow-editor-library-row-hover");

  // Act
  await screen.getByRole("button", "More Flow actions", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("menuitem", "Export JSON", { exact: true })).toBeVisible();
  await browser.evaluate(settled);
  await app.screenshot("flow-editor-more-flow-actions");
});
