import { beforeEach, test } from "./support/test.ts";
import { expect } from "e2e";
import { createStudioFlow, removeFlowElsewhere } from "./support/flows.ts";
import {
  listAgentDefinitions,
  removeAgentElsewhere,
  saveAgentElsewhere,
} from "./support/agents.ts";
import { openApproved, openRemoteBrowser } from "./support/remote-access.ts";
import { flowsBreadcrumb } from "./support/studio.ts";

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
  await expect(screen.getByRole("button", "Save", { exact: true })).toBeVisible();
  await expect(screen.getByLabel("Flow name", { exact: true })).toHaveValue(name);
  const path = new URL(await browser.url()).pathname;
  const id = path.split("/").at(-1)!;
  await flowsBreadcrumb(screen).tap();
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
  await expect(screen.getByRole("button", "Save", { exact: true })).toHaveCount(0);
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
  await expect(screen.getByRole("link", name, { exact: false })).toBeVisible();
  const path = new URL(await browser.url()).pathname;
  const id = path.split("/").at(-1)!;
  await screen.getByRole("link", "Sample worker", { exact: false }).tap();
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue("Sample worker");
  await removeAgentElsewhere(app.baseUrl, id);
  await expect(screen.getByRole("link", name, { exact: false })).toHaveCount(0);

  // Act
  await browser.back();

  // Assert
  await expect(browser).toHaveURL(path);
  await expect(screen.getByText("Agent not found", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Save", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", "More actions", { exact: true })).toHaveCount(0);
  await app.screenshot("created-agent-removed-before-back");
});

test("a skewed browser clock does not prevent Create or recovery of its lost reply", async ({
  app,
  browser,
  screen,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  const original = "Creation recovery · Lost reply";
  const revised = "Creation recovery · Revised after Create";
  await openRemoteBrowser(app);
  await openApproved(app, "/studio/agents/new");
  await screen.getByLabel("Name", { exact: true }).fill(original);
  await screen.getByLabel("Prompt", { exact: true }).fill("Review the change.");
  await browser.evaluate(
    "Date.now = (() => { const now = Date.now; return () => now() - 60_000; })()",
  );
  await browser.route("**/api/agents", async (route) => {
    if (route.request.method !== "POST") return route.continue();
    const reply = await route.fetch();
    if (reply.status !== 201)
      return route.fulfill({ status: reply.status, body: await reply.text() });
    const agent = (await listAgentDefinitions(app.baseUrl)).find(
      (entry) => entry.name === original,
    );
    if (!agent) throw new Error("The Create did not reach Factory.");
    await saveAgentElsewhere(app.baseUrl, agent, { name: revised });
    await route.abort();
  });

  // Act
  await screen.getByRole("button", "Create Agent", { exact: true }).tap();

  // Assert
  const open = screen.getByRole("button", "Open Agent", { exact: true });
  await expect(open).toBeVisible();
  await expect(screen.getByRole("button", "Create again", { exact: true })).toHaveCount(0);
  await app.screenshot("after-agent-create-recovered");
  await open.tap();
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(revised);
});
