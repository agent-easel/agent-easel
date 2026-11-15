import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { createStudioFlow, removeFlowElsewhere } from "./support/flows.ts";
import { removeAgentElsewhere } from "./support/agents.ts";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1920, height: 1000 });
});

test("Back to a created Flow removed after its first live appearance shows not found", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const name = "Creation recovery · Flow";
  await createStudioFlow(app, screen, browser, name);
  await expect(screen.getByRole("button", "Save Flow", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(name);
  const path = new URL(await browser.url()).pathname;
  const id = path.split("/").at(-1)!;
  await screen.getByRole("link", "All Flows", { exact: true }).tap();
  await expect(screen.getByRole("link", /^Creation recovery · Flow /)).toBeVisible();
  await screen.getByRole("link", /^Launch ready Flow /).tap();
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue("Launch ready Flow");
  await browser.back();
  await expect(screen.getByRole("heading", "Flows", { exact: true })).toBeVisible();
  await removeFlowElsewhere(app.baseUrl, id);
  await expect(screen.getByRole("link", /^Creation recovery · Flow /)).toHaveCount(0);

  // Act
  await browser.back();

  // Assert
  await expect(browser).toHaveURL(path);
  await expect(screen.getByText("Flow not found", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Save Flow", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Start Run", { exact: true })).toHaveCount(0);
  await app.screenshot("created-flow-removed-before-back");
});

test("Back to a created Agent removed after its first live appearance shows not found", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  const name = "Creation recovery · Agent";
  await app.open("/studio/agents/new");
  await screen.getByLabel("Name", { exact: true }).fill(name);
  await screen.getByLabel("Prompt", { exact: true }).fill("Review the requested change.");
  await screen.getByRole("button", "Create Agent", { exact: true }).tap();
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", name, { exact: true })).toBeVisible();
  const path = new URL(await browser.url()).pathname;
  const id = path.split("/").at(-1)!;
  await screen.getByRole("link", "Sample worker", { exact: true }).tap();
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue("Sample worker");
  await removeAgentElsewhere(app.baseUrl, id);
  await expect(screen.getByRole("link", name, { exact: true })).toHaveCount(0);

  // Act
  await browser.back();

  // Assert
  await expect(browser).toHaveURL(path);
  await expect(screen.getByText("Agent not found", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Save", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "Duplicate…", { exact: true })).toHaveCount(0);
  await app.screenshot("created-agent-removed-before-back");
});
