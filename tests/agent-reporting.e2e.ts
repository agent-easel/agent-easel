import assert from "node:assert/strict";
import { test } from "./support/test.ts";
import { expect } from "e2e";
import { copyAgentDefinition, listAgentDefinitions } from "./support/agents.ts";
import { ownedFlow } from "./support/owners.ts";

test("reporting problems are visible before Start and clear after repairing the provider", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await app.open("/runs/new");
  const agents = await listAgentDefinitions(app.baseUrl);
  const worker = agents.find((agent) => agent.name === "Runtime worker");
  assert(worker?.execution);
  const northwind = (await ownedFlow(app.baseUrl, "Northwind release")).projectId;
  assert(northwind);
  const overridden = await copyAgentDefinition(
    app.baseUrl,
    "Runtime worker",
    `Overridden runtime ${Date.now()}`,
    { projectOverrides: [{ projectId: northwind, execution: worker.execution }] },
  );
  await expect(screen.getByRole("link", "Settings, Connected", { exact: true })).toBeVisible();
  await fixture.reporting.breakRequiredSkill();

  // Act
  await browser.reload();
  await expect(
    screen.getByRole("link", /^Settings, (Connected|Agent reporting needs attention)$/),
  ).toBeVisible();
  await app.screenshot("settings-reporting-needs-attention");
  await app.open(`/studio/agents/${worker.id}`);

  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue("Runtime worker");
  await expect
    .poll(() =>
      browser.evaluate(`getComputedStyle(document.querySelector('[data-studio]')).opacity`),
    )
    .toBe("1");
  await app.screenshot("agents-reporting-needs-repair");
  await expect(screen.getByRole("status", "Agent reporting status")).toContainText(
    "Reporting needs attention",
  );
  await expect(screen.getByRole("link", "Runtime worker", { exact: false })).toContainText(
    "Reporting needs attention",
  );
  // The attention line replaces the summary but keeps a global Agent's override count.
  const overriddenRow = screen.getByRole("link", overridden.name, { exact: false });
  await expect(overriddenRow).toContainText("Reporting needs attention");
  await expect(overriddenRow).toContainText("+1 Project override");
  await expect(screen.getByRole("status", "Agent reporting status")).toContainText(
    "Factory Block skill missing or outdated",
  );
  await screen.getByRole("button", "Back to Runs").tap();
  await expect(
    screen.getByRole("link", "Settings, Agent reporting needs attention", { exact: true }),
  ).toBeVisible();
  await app.open(`/studio/agents/${worker.id}`);
  const draftName = "Runtime worker · unsaved";
  await screen.getByLabel("Name", { exact: true }).fill(draftName);
  await screen.getByRole("link", "Open Agent reporting").tap();
  await expect(screen.getByRole("heading", "Agent reporting", { exact: true })).toBeVisible();
  await expect(screen.getByRole("group", "Codex", { exact: true }).getByRole("status")).toHaveText(
    "Needs attention",
  );
  await expect(
    screen.getByRole("link", "Agent reporting, Needs attention", { exact: true }),
  ).toBeVisible();
  await screen.getByRole("button", "Install all", { exact: true }).tap();
  await expect(screen.getByRole("group", "Codex", { exact: true }).getByRole("status")).toHaveText(
    "Installed",
  );
  await app.screenshot("settings-reporting-repaired");
  await browser.keyboard.press("Escape");

  // Assert: Settings returns to the same editable draft, with healthy reporting.
  await expect(screen.getByLabel("Name", { exact: true })).toHaveValue(draftName);
  await expect(screen.getByRole("link", "Runtime worker", { exact: false })).toContainText(
    "GPT 6.1 Sol",
  );
  await expect(screen.getByRole("link", "Runtime worker", { exact: false })).not.toContainText(
    "Reporting",
  );
  await expect(screen.getByRole("status", "Agent reporting status")).not.toBeVisible();
  await app.screenshot("agents-reporting-installed");
});

test("a failed reporting inspection warns instead of showing green Connected", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.route("**/api/reporting", (route) =>
    route.fulfill({
      status: 503,
      json: {
        ok: false,
        error: { code: "validation", message: "Reporting inspection unavailable", issues: [] },
      },
    }),
  );

  // Act
  await app.open("/runs/new");

  // Assert
  await expect(
    screen.getByRole("link", "Settings, Reporting status unavailable", { exact: true }),
  ).toBeVisible();
  await screen.getByRole("link", "Settings, Reporting status unavailable", { exact: true }).tap();
  await expect(screen.getByRole("heading", "Agent reporting", { exact: true })).toBeVisible();
  await expect(screen.getByRole("alert")).toContainText("Couldn’t check Agent reporting");
});

test("the Agent reporting attention dot clears once every harness is installed", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const codex = {
    id: "codex-home",
    provider: "codex",
    instances: ["codex-main"],
    path: "/home/factory/.codex/config.toml",
    message: "Configuration installed.",
    launchSkill: "current",
    runtimeEvidence: "UNVERIFIED",
  };
  let targets = [
    {
      ...codex,
      status: "not-installed",
      actions: { install: true, repair: false, reinstall: false },
    },
  ];
  await browser.route("**/api/reporting", (route) =>
    route.fulfill({ json: { ok: true, value: targets } }),
  );
  await app.open("/settings/agent-reporting");
  await expect(
    screen.getByRole("link", "Agent reporting, Needs attention", { exact: true }),
  ).toBeVisible();
  targets = [
    { ...codex, status: "installed", actions: { install: false, repair: false, reinstall: true } },
  ];

  // Act
  await screen.getByRole("button", "Check again", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("group", "Codex", { exact: true }).getByRole("status")).toHaveText(
    "Installed",
  );
  await expect(screen.getByRole("link", "Agent reporting", { exact: true })).toBeVisible();
});

test("installed reporting shows the file and manual remedy for a linked optional skill", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const { path } = await fixture.reporting.linkOptionalSkill();

  // Act
  await app.open("/settings/agent-reporting");

  // Assert
  const codex = screen.getByRole("group", "Codex", { exact: true });
  await expect(codex.getByRole("status")).toHaveText("Installed");
  await expect
    .poll(() =>
      browser.evaluate(`getComputedStyle(document.querySelector('[role="dialog"]')).opacity`),
    )
    .toBe("1");
  await app.screenshot("reporting-optional-skill-diagnostic");
  await expect(codex.getByText(path)).not.toBeVisible();
  await codex.getByRole("button", "Technical details").tap();
  await expect(codex).toContainText(path);
  await expect(codex).toContainText("Replace or remove it manually, then Reinstall.");
});

test("a disconnected T3 connection takes precedence over reporting warnings", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.route("**/api/reporting", (route) =>
    route.fulfill({ json: { ok: true, value: [] } }),
  );
  await fixture.remoteAccess.t3Unavailable();

  // Act
  await app.open("/runs/new");

  // Assert
  await expect(screen.getByRole("link", "Settings, Disconnected", { exact: true })).toBeVisible();
  await screen.getByRole("link", "Settings, Disconnected", { exact: true }).tap();
  await expect(screen.getByRole("heading", "T3 connection", { exact: true })).toBeVisible();
});

test("Install all continues after a failed home and leaves that home available to retry", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1440, height: 900 });
  await fixture.reporting.blockRequiredSkillWrite();
  await app.open("/settings/agent-reporting");
  const codex = screen.getByRole("group", "Codex", { exact: true });
  const cursor = screen.getByRole("group", "Cursor", { exact: true });
  await expect(codex.getByRole("status")).toHaveText("Needs attention");
  await expect(cursor.getByRole("status")).toHaveText("Not installed");

  // Act
  await screen.getByRole("button", "Install all", { exact: true }).tap();

  // Assert
  await expect(codex.getByRole("status")).toHaveText("Install failed");
  await expect(codex.getByRole("button", "Repair Codex")).toBeEnabled();
  await expect(cursor.getByRole("status")).toHaveText("Installed");
  await expect(screen.getByText("Couldn’t install for Codex", { exact: true })).toHaveCount(1);
  await expect(
    screen.getByText("Symlink, special or hard-linked", { exact: false }),
  ).not.toBeVisible();
  await app.screenshot("agent-reporting-partial-install");
});
