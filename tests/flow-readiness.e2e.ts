import { applyRunState } from "./support/scenarios.ts";
import { removeAgentElsewhere, repairCodexReporting } from "./support/agents.ts";
import { beforeEach, test } from "./support/test.ts";
import { expect } from "e2e";
import { blockOnModelLessLaterReview, openComposerWithFlow } from "./support/composer.ts";
import { removeFlowElsewhere, saveFlowCopy } from "./support/flows.ts";
import { archiveJourneyRun, findRun, readHistoryRun, runsTitled } from "./support/run-history.ts";

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 1100 });
});

test("Start names every blocked Agent including later branches and succeeds after repair", async ({
  fixture,
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openComposerWithFlow(app, screen, "Demo · Parallel review");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("UI whole Flow readiness");
  await fixture.reporting.breakRequiredSkill();

  // Act
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("alert")).toContainText("No Run was created");
  await app.screenshot("whole-flow-blocked");
  await expect(screen.getByRole("list", "Start blockers")).toContainText(
    "Demo · Product engineer:",
  );
  await expect(screen.getByRole("list", "Start blockers")).toContainText("Demo · Code reviewer:");
  await expect(screen.getByRole("list", "Start blockers")).toContainText(
    "Demo · Accessibility reviewer:",
  );
  expect(await runsTitled(app.baseUrl, "UI whole Flow readiness")).toHaveLength(0);
  await expect(screen.getByLabel("Initial prompt", { exact: false })).toHaveText(
    "UI whole Flow readiness",
  );

  // Act — repair Agent reporting and retry the same draft.
  await screen.getByRole("link", "Open Settings → Agent reporting", { exact: true }).first().tap();
  await repairCodexReporting(screen);
  await expect(screen.getByRole("link", "Settings, Connected", { exact: true })).toBeVisible();
  await app.screenshot("whole-flow-configuration-repaired");
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert — the repaired Run starts and its worker can report a result.
  await expect(
    screen.getByRole("heading", "UI whole Flow readiness", { exact: true }),
  ).toBeVisible();
  const created = await findRun(app.baseUrl, "UI whole Flow readiness");
  await expect
    .poll(
      async () => {
        const run = await readHistoryRun(app.baseUrl, created.id);
        return run.blocks.some(
          (block) =>
            block.blockId === "worker" && block.threadId !== null && block.executionId !== null,
        );
      },
      { message: "The Implement change worker has launched" },
    )
    .toBe(true);
  await app.screenshot("whole-flow-start-accepted");
  await applyRunState(app, created.id, "result reported", "Ready for parallel review.");
  await applyRunState(app, created.id, "result released to two workers");
  await browser.reload();
  await expect(screen.getByRole("region", "Block activations")).toContainText(
    "Ready for parallel review.",
  );
  const run = await readHistoryRun(app.baseUrl, created.id);
  expect(run.reports[0]?.completionEligibleAt).not.toBe(null);
  expect(run.activations).toHaveLength(3);
  await app.screenshot("whole-flow-result-accepted");
  await archiveJourneyRun(app.baseUrl, created.id);
});

test("a chosen Flow whose later-branch Agent comes to Need a model is Not ready and Start stays blocked", async ({
  app,
  screen,
}) => {
  // Act
  const { agent, flow } = await blockOnModelLessLaterReview(app, screen);

  // Assert
  await app.screenshot("model-less-agent-not-ready");
  expect(await runsTitled(app.baseUrl, "UI model-less later Agent")).toHaveLength(0);
  await screen.getByRole("link", "Open Model-less later review in Flows", { exact: true }).tap();
  await expect(screen.getByRole("article", "Block Accessibility review")).toContainText(
    "Needs a model",
  );
  await app.screenshot("model-less-agent-canvas-tag");
  await removeFlowElsewhere(app.baseUrl, flow);
  await removeAgentElsewhere(app.baseUrl, agent.id);
});

test("Agent-scoped runtime contract blockers point to the connection without blaming Agents", async ({
  fixture,
  app,
  screen,
}) => {
  // Arrange
  await openComposerWithFlow(app, screen, "Demo · Parallel review");
  await screen
    .getByLabel("Initial prompt", { exact: false })
    .fill("UI incomplete runtime contract");
  await fixture.reporting.incompleteRuntime();

  // Act
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("list", "Start blockers")).toContainText(
    "t3_thread_send lacks required runtime fields",
  );
  await expect(
    screen.getByRole("link", "Open T3 Code connection settings", { exact: true }).first(),
  ).toBeVisible();
  await app.screenshot("connection-only-blocker");
  await expect(screen.getByRole("link", "Open Studio → Agents", { exact: true })).toHaveCount(0);
  expect(await runsTitled(app.baseUrl, "UI incomplete runtime contract")).toHaveLength(0);
});

test("a worktree Flow whose custom base ref is missing blocks Start with a Studio Flow repair link", async ({
  app,
  screen,
}) => {
  // Arrange
  const flow = await saveFlowCopy(app.baseUrl, "Demo · Focused change", "Missing base worktree", {
    mode: "worktree",
    base: { kind: "ref", ref: "release/missing" },
  });
  await openComposerWithFlow(app, screen, "Missing base worktree");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("UI missing worktree base");

  // Act
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("list", "Start blockers")).toContainText(
    "release/missing is not a commit",
  );
  await expect(screen.getByRole("link", "Open Studio → Flows", { exact: true })).toBeVisible();
  await app.screenshot("workspace-base-blocker");
  await expect(screen.getByRole("link", "Open Studio → Agents", { exact: true })).toHaveCount(0);
  expect(await runsTitled(app.baseUrl, "UI missing worktree base")).toHaveLength(0);
  await removeFlowElsewhere(app.baseUrl, flow);
});
