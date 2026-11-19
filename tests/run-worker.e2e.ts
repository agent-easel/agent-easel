import { confirmSettlement } from "./support/run-history.ts";
import assert from "node:assert/strict";
import type { Browser } from "@e2e-dev/web";
import { beforeEach, test } from "./support/test.ts";
import { expect, type App, type Screen } from "e2e";
import {
  archiveJourneyRun,
  findRun,
  readHistoryRun,
  runsTitled,
  settleStoppingWorkers,
} from "./support/run-history.ts";
import { listAgentDefinitions, readAgentDefinition } from "./support/agents.ts";
import { prepareScenarios, applyRunState } from "./support/scenarios.ts";
import { liveRun } from "./support/live.ts";
import { openComposerWithFlow, startLosingResponse } from "./support/composer.ts";
import {
  fillHumanReviewChanges,
  installDesktopBridge,
  shortcutMod,
} from "./support/keyboard-shortcuts.ts";

beforeEach(async ({ app }) => {
  await prepareScenarios(app);
});

beforeEach(async ({ browser }) => {
  await browser.setViewport({ width: 1440, height: 1100 });
});

test("saved worker settings persist after reload", async ({ app, screen, browser }) => {
  // Arrange
  const agents = await listAgentDefinitions(app.baseUrl);
  const agent = agents.find((a) => a.name === "Demo · Product engineer");
  assert(agent);
  await app.open(`/studio/agents/${agent.id}`);
  await screen
    .getByLabel("Prompt", { exact: true })
    .fill("Implement focused changes and report the result directly.");

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expect
    .poll(() => readAgentDefinition(app.baseUrl, agent.id))
    .toMatchObject({
      revision: agent.revision + 1,
      prompt: "Implement focused changes and report the result directly.",
    });
  await screen.getByRole("button", "More actions", { exact: true }).tap();
  await expect(screen.getByRole("menuitem", "Duplicate", { exact: true })).toBeEnabled();
  await screen.getByRole("menu").press("Escape");
  await browser.reload();
  await expect(screen.getByLabel("Prompt", { exact: true })).toHaveValue(
    "Implement focused changes and report the result directly.",
  );
  await app.screenshot("worker-only-save-reloaded");
});

test("Start launches a top-level Block worker and no Run conversation", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openComposerWithFlow(app, screen, "Demo · Focused change");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("UI direct worker launch");
  await expect(screen.getByRole("button", "Start", { exact: true })).toBeEnabled();
  await app.screenshot("direct-start-ready");

  // Act
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert
  await expect(
    screen.getByRole("heading", "UI direct worker launch", { exact: true }),
  ).toBeVisible();
  const created = await findRun(app.baseUrl, "UI direct worker launch");
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, created.id)).threadBindings.length)
    .toBe(1);
  const run = await readHistoryRun(app.baseUrl, created.id);
  expect(run.runCoordinator).toBeNull();
  expect(run.number).toBeGreaterThan(0);
  expect(run.threadBindings.map((b) => b.role)).toEqual(["worker"]);
  expect(run.activations).toHaveLength(1);
  expect(run.blocks[0]?.threadId).toBe(run.threadBindings[0]?.threadId);
  await browser.reload();
  await expect(
    screen
      .getByRole("region", "Block activations")
      .getByRole("link", "Open in T3", { exact: true }),
  ).toHaveAttribute("href", run.threadBindings[0]!.link!);
  await app.screenshot("direct-root-worker-after-reload");
});

test("a worktree Run shows the worktree its workers share and creates no worker for a Block not yet reached", async ({
  app,
  screen,
}) => {
  // Arrange
  await openComposerWithFlow(app, screen, "Demo · Build and review in a worktree");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("UI worktree Run");

  // Act
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("heading", "UI worktree Run", { exact: true })).toBeVisible();
  const created = await findRun(app.baseUrl, "UI worktree Run");
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, created.id)).workspace)
    .toMatchObject({ state: "bound" });
  const run = await readHistoryRun(app.baseUrl, created.id);
  assert(run.workspace.mode === "worktree");
  await expect(screen.getByRole("region", "Run branch")).toContainText(
    `${run.workspace.branch} Own worktree from ${run.workspace.baseRef}`,
  );
  await screen.getByRole("button", "Workspace & observation", { exact: false }).tap();
  await expect(screen.getByRole("region", "Run workspace")).toContainText(
    `Worktree · ${run.workspace.branch} · ${run.workspace.path}`,
  );
  await app.screenshot("worktree-run-workspace");
  expect(run.threadBindings).toHaveLength(1);
  await screen.getByRole("button", "Agent Review implementation", { exact: false }).tap();
  const inspector = screen.getByRole("complementary", "Run inspector");
  await inspector.getByRole("button", "Technical details", { exact: false }).tap();
  await expect(inspector).toContainText(/Thread\s*unresolved/);
  await app.screenshot("worktree-run-unvisited-block");
});

test("an unfinished prompt reopens as a Draft after reload and Starts exactly one Run in its place", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const prompt = "UI saved draft\n  Keep the second line exactly.";
  const openRuns = screen.getByRole("navigation", "Open Runs");
  const draftRow = openRuns.getByRole("link", /^UI saved draft\s*Draft$/);
  const journeyRows = openRuns.getByRole("link", /UI (saved|newer) draft/);
  const workingRun = openRuns.getByRole("link", /Demo · Working · Improve the project picker/);
  const projectChoice = screen.getByLabel(/^Select project: /);
  await openComposerWithFlow(app, screen, "Demo · Focused change");
  await screen.getByLabel("Initial prompt", { exact: false }).fill(prompt);
  const project = await projectChoice.getAttribute("aria-label");
  await expect(draftRow).toHaveCount(0);
  await workingRun.tap();
  await expect(draftRow).toBeVisible();
  await screen.getByRole("button", "New Run (+)").tap();
  await screen.getByLabel("Initial prompt", { exact: false }).fill("UI newer draft");
  await workingRun.tap();
  await expect(journeyRows).toHaveText([/^UI newer draft/, /^UI saved draft/]);
  await browser.reload();
  await draftRow.tap();
  await expect(screen.getByLabel("Initial prompt", { exact: false })).toHaveText(prompt);
  await expect(projectChoice).toHaveAttribute("aria-label", project!);
  await expect(screen.getByLabel("Select Flow: Demo · Focused change")).toBeVisible();
  await app.screenshot("draft-reopened-after-reload");

  // Act
  await screen.getByRole("button", "Start", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("heading", "UI saved draft", { exact: true })).toBeVisible();
  const started = await runsTitled(app.baseUrl, "UI saved draft");
  expect(started).toHaveLength(1);
  expect((await readHistoryRun(app.baseUrl, started[0]!.id)).input).toBe(prompt);
  await expect(draftRow).toHaveCount(0);
  await expect(journeyRows).toHaveText([/^UI newer draft\s*Draft$/, /UI saved draft/]);
  await app.screenshot("draft-started-once");
  await archiveJourneyRun(app.baseUrl, started[0]!.id);
});

test("a reopened Draft continues typing at the end of its prompt", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const openRuns = screen.getByRole("navigation", "Open Runs");
  const prompt = screen.getByLabel("Initial prompt", { exact: false });
  await app.open("/runs/new");
  await prompt.fill("UI caret draft");
  await openRuns.getByRole("link", /Demo · Working · Improve the project picker/).tap();
  await openRuns.getByRole("link", /^UI caret draft\s*Draft$/).tap();

  // Act
  await browser.keyboard.type(" continued");

  // Assert
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveText("UI caret draft continued");
});

test("a Draft opened by keyboard from a focused prompt with the same text continues typing at its end", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const text = "UI keyboard caret draft";
  const prompt = screen.getByLabel("Initial prompt", { exact: false });
  const listedDrafts = screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link", new RegExp(`^${text}\\s*Draft$`));
  await installDesktopBridge(browser);
  await app.open("/runs/new");
  await prompt.fill(text);
  await app.open("/studio/flows");
  await app.open("/runs/new");
  await screen.getByRole("button", "New Run (+)").tap();
  await prompt.fill(text);
  // Runs that need you lead the open list, so the search leaves only the two Drafts as rows.
  await screen.getByRole("textbox", "Search Run titles").fill(text);
  await prompt.tap();
  await browser.keyboard.press("Home");
  await browser.keyboard.press(`${shortcutMod}+1`);
  await expect(listedDrafts).toHaveCount(2);
  await expect(prompt).toHaveText(text);

  // Act
  await browser.keyboard.type(" continued");

  // Assert
  await expect(prompt).toHaveText(`${text} continued`);
});

test("a Start whose response was lost is recovered after reload without a duplicate Run", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openComposerWithFlow(app, screen, "Demo · Focused change");
  await screen.getByLabel("Initial prompt", { exact: false }).fill("UI recovered lost Start");
  await startLosingResponse(screen, browser);
  await browser.reload();
  await expect(screen.getByLabel("Initial prompt", { exact: false })).toHaveText(
    "UI recovered lost Start",
  );
  await app.screenshot("lost-start-pending-after-reload");

  // Act
  await screen.getByRole("button", "Check same request", { exact: true }).tap();

  // Assert
  await expect(
    screen.getByRole("heading", "UI recovered lost Start", { exact: true }),
  ).toBeVisible();
  const recovered = await runsTitled(app.baseUrl, "UI recovered lost Start");
  expect(recovered).toHaveLength(1);
  await browser.reload();
  await expect(
    screen.getByRole("heading", "UI recovered lost Start", { exact: true }),
  ).toBeVisible();
  await app.screenshot("lost-start-recovered");
  await archiveJourneyRun(app.baseUrl, recovered[0]!.id);
});

test("a worker idle in its working report asks for review in T3 as Needs input after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await findRun(
    app.baseUrl,
    "UI worker · Discussing · Agent asked about empty-state wording",
  );
  const run = await readHistoryRun(app.baseUrl, found.id);
  await app.open(`/runs/${run.id}`);

  // Act
  await browser.reload();

  // Assert
  const block = screen.getByRole("article", "Block Implement change");
  await expect(block).toContainText("I drafted three options for the empty state");
  await expect(block).toContainText("Needs input");
  const review = screen
    .getByRole("region", "Needs input")
    .getByRole("article", "Review Implement change in T3");
  const report = review.getByRole("region", "Working report", { exact: true });
  await expect(report.getByRole("heading", "Options", { exact: true })).toBeVisible();
  await expect(report).toContainText("Neutral — “No results. Try fewer filters.”");
  await expect(report).not.toContainText("**Neutral**");
  await expect(review.getByRole("button", "Read full report", { exact: true })).toBeVisible();
  await expect(review.getByRole("link", "Open in T3", { exact: true })).toBeVisible();
  await expect(screen.getByRole("region", "Problem")).toHaveCount(0);
  const after = await readHistoryRun(app.baseUrl, run.id);
  expect(after.activations).toEqual(run.activations);
  expect(after.attention).toEqual(run.attention);
  await app.screenshot("worker-conversation-after-reload");
  await screen.getByRole("button", "Workspace & observation", { exact: false }).tap();
  await screen.getByRole("heading", "Work periods", { exact: true }).scrollIntoView();
  await expect(screen.getByText(/Report: accepted working/)).toBeVisible();
  await app.screenshot("worker-conversation-work-period");
});

async function openWorkingReportReader(app: App, screen: Screen) {
  const found = await findRun(
    app.baseUrl,
    "UI worker · Discussing · Agent asked about empty-state wording",
  );
  await app.open(`/runs/${found.id}`);
  const review = screen
    .getByRole("region", "Needs input")
    .getByRole("article", "Review Implement change in T3");
  await expect(review.getByRole("button", "Read full report", { exact: true })).toBeVisible();
  return {
    review,
    reader: screen.getByRole("dialog", "Implement change · Working report", { exact: true }),
  };
}

test("Read full report opens the Agent's whole Working report with its visit and Open in T3", async ({
  app,
  screen,
}) => {
  // Arrange
  const { review, reader } = await openWorkingReportReader(app, screen);

  // Act
  await review.getByRole("button", "Read full report", { exact: true }).tap();

  // Assert
  await expect(reader).toContainText(/Visit 1 · waiting for your reply · since \d\d:\d\d/);
  await expect(reader.getByRole("heading", "Open questions", { exact: true })).toBeVisible();
  await expect(reader.getByRole("listitem")).toHaveCount(5);
  await expect(
    reader.getByText("Reply in T3 with the option number and any wording changes.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(reader.getByRole("button", "Copy Markdown", { exact: true })).toBeVisible();
  await expect(reader.getByRole("link", "Open in T3", { exact: true })).toBeVisible();
  await app.screenshot("worker-conversation-working-report-reader");
});

test("Esc closes the Working report reader and returns focus to Read full report", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { review, reader } = await openWorkingReportReader(app, screen);
  await review.getByRole("button", "Read full report", { exact: true }).tap();
  await expect(reader).toBeVisible();

  // Act
  await browser.keyboard.press("Escape");

  // Assert
  await expect(reader).toHaveCount(0);
  await expect(review.getByRole("button", "Read full report", { exact: true })).toBeFocused();
  await expect(review.getByRole("link", "Open in T3", { exact: true })).toBeVisible();
});

test("a worker idle in working shows its message on the canvas and in its Run preview", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await findRun(
    app.baseUrl,
    "UI worker · Monitoring · Agent is watching CI for the search fix",
  );

  // Act
  await app.open(`/runs/${found.id}`);
  await screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link", /UI worker · Monitoring · Agent is watching CI/)
    .hover();

  // Assert
  await expect(screen.getByRole("article", "Block Implement change")).toContainText(
    "CI checks are still running",
  );
  await expect(browser.locator('[data-slot="tooltip-content"]')).toContainText(
    "CI checks are still running",
  );
  await expect(screen.getByRole("region", "Problem")).toHaveCount(0);
  await app.screenshot("worker-working-message");
});

test("Request report asks a worker idle in working to assess its existing work", async ({
  app,
  screen,
}) => {
  // Arrange
  const found = await findRun(
    app.baseUrl,
    "UI worker · Monitoring · Agent is watching CI for the search fix",
  );
  await app.open(`/runs/${found.id}`);
  await screen.getByRole("button", "Agent Implement change", { exact: false }).tap();
  const details = screen.getByRole("complementary", "Run inspector");
  await expect(details).toContainText("Opened pull request #42");
  await expect(details.getByText("Needs input", { exact: true })).toBeVisible();
  await app.screenshot("worker-working-visit");

  // Act
  await details.getByRole("button", "Request report", { exact: true }).tap();

  // Assert
  await expect(details.getByText("Report requested at", { exact: false })).toBeVisible();
  const saved = await readHistoryRun(app.baseUrl, found.id);
  expect(saved.recoveries).toMatchObject([{ blockId: "worker", attentionId: null }]);
  expect(saved.attention.filter((a) => a.kind === "missing-report")).toEqual([]);
  await app.screenshot("worker-working-report-requested");
});

test("a native worker reply completes the same activation without another working report", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await findRun(
    app.baseUrl,
    "UI worker · Discussing · Agent asked about empty-state wording",
  );
  const before = await readHistoryRun(app.baseUrl, found.id);
  await app.open(`/runs/${found.id}`);

  // Act — simulate the ordinary reply in the exact native worker conversation.
  await applyRunState(app, found.id, "reply turn observed");
  await applyRunState(
    app,
    found.id,
    "result reported",
    "Used the requested concise wording and Clear filters label.",
  );
  await applyRunState(app, found.id, "settled");

  // Assert
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).lifecycle)
    .toBe("settled");
  await browser.reload();
  const saved = await readHistoryRun(app.baseUrl, found.id);
  expect(saved.activations.map((a) => a.id)).toEqual(before.activations.map((a) => a.id));
  expect(saved.threadBindings).toEqual(before.threadBindings);
  expect(saved.executions.map((e) => e.executionId)).toContain("ui-worker-reply");
  expect(saved.reports[0]?.resultMessage).toContain("Clear filters");
  expect(saved.reports[0]?.completionEligibleAt).not.toBe(null);
  await expect(screen.getByRole("region", "Block activations")).toContainText("Clear filters");
  await app.screenshot("worker-answer-completed-same-visit");
});

test("a worker's replaced report releases only its newest result to review work", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await findRun(app.baseUrl, "UI worker · UI worker report release");
  await app.open(`/runs/${found.id}`);

  // Act — the external worker reports a draft, then replaces it, through Factory's public runtime boundary.
  await applyRunState(app, found.id, "result held", "A first draft of the project picker change.");
  await applyRunState(
    app,
    found.id,
    "result reported",
    "The project picker change is ready for review.",
  );
  await applyRunState(app, found.id, "result released to a second worker");

  // Assert
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).threadBindings.length)
    .toBe(2);
  await browser.reload();
  const saved = await readHistoryRun(app.baseUrl, found.id);
  expect(saved.threadBindings.map((b) => b.role)).toEqual(["worker", "worker"]);
  expect(saved.reports.map((r) => r.resultMessage)).toEqual([
    "A first draft of the project picker change.",
    "The project picker change is ready for review.",
  ]);
  expect(saved.reports[1]?.completionEligibleAt).not.toBe(null);
  expect(saved.activations.map((a) => a.blockId)).toEqual(["worker", "reviewer"]);
  expect(saved.activations[1]?.cause).toContain(saved.reports[1]!.id);
  await expect(screen.getByRole("region", "Block activations")).toContainText(
    "Delivered → Review implementation",
  );
  await screen.getByRole("button", "Show timeline", { exact: true }).tap();
  await expect(screen.getByRole("region", "Timeline")).toContainText(
    "result version 2 replaces the earlier result",
  );
  await expect(screen.getByRole("region", "Timeline")).toContainText(
    "Cancelled → Review implementation",
  );
  await expect(
    screen
      .getByRole("region", "Block activations")
      .getByRole("link", "Open in T3", { exact: true }),
  ).toHaveCount(2);
  await app.screenshot("worker-report-released-to-reviewer");
});

test("a Human correction answered from the selected Human step revisits the same worker conversation with a distinct activation", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await findRun(app.baseUrl, "UI worker · Waiting for your review");
  const before = await readHistoryRun(app.baseUrl, found.id);
  const worker = before.blocks.find((b) => b.blockId === "worker")!;
  await app.open(`/runs/${found.id}`);
  await screen.getByRole("button", "Human step Your review", { exact: false }).tap();
  await expect(
    screen
      .getByRole("complementary", "Run inspector")
      .getByRole("heading", { name: "Your review", level: 2 }),
  ).toBeVisible();
  const answer = await fillHumanReviewChanges(screen, "Keep keyboard focus in the search field.");
  await app.screenshot("human-correction-ready");

  // Act
  await answer.getByRole("button", "Submit answer", { exact: true }).tap();

  // Assert
  await expect
    .poll(
      async () =>
        (await readHistoryRun(app.baseUrl, found.id)).activations.filter(
          (a) => a.blockId === "worker",
        ).length,
    )
    .toBe(2);
  await expect
    .poll(
      async () =>
        (await readHistoryRun(app.baseUrl, found.id)).blocks.find((b) => b.blockId === "worker")
          ?.executionId,
    )
    .not.toBe(worker.executionId);
  await browser.reload();
  const saved = await readHistoryRun(app.baseUrl, found.id);
  expect(saved.blocks.find((b) => b.blockId === "worker")?.threadId).toBe(worker.threadId);
  expect(saved.reports).toEqual(before.reports);
  expect(saved.threadBindings.map((b) => b.role)).toEqual(["worker", "worker"]);
  expect(saved.humanOccurrences[0]?.state).toBe("answered");
  await expect(screen.getByRole("region", "Block activations")).toContainText(
    "Implement change · Visit 2",
  );
  await app.screenshot("same-worker-second-visit");
});

const longContextRun = "UI worker · Decision · Long review summary for the reset action";

/** The Overview's answer form for the long-context Human step, before anything is chosen. */
async function openLongContextAnswer(app: App, screen: Screen) {
  const found = await findRun(app.baseUrl, longContextRun);
  await app.open(`/runs/${found.id}`);
  const answer = screen
    .getByRole("complementary", "Run inspector")
    .getByRole("form", "Answer Your review", { exact: true });
  await expect(answer).toBeVisible();
  return {
    found,
    answer,
    reader: screen.getByRole("dialog", "Your review · context", { exact: true }),
  };
}

test("a long Human context previews as Markdown on its card and opens in full in the reader without decision controls", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { answer, reader } = await openLongContextAnswer(app, screen);
  await expect(answer.getByRole("heading", "Review summary", { exact: true })).toBeVisible();
  await expect(answer.getByRole("listitem")).toHaveCount(3);
  await expect(answer.getByText('No results for "{query}"', { exact: true })).toBeVisible();
  await app.screenshot("human-context-preview");

  // Act
  await answer.getByRole("button", "Read full context", { exact: true }).tap();

  // Assert
  await expect(reader).toContainText(/From Review implementation · Visit 1 · \d\d:\d\d/);
  await expect(reader.getByRole("heading", "Decide", { exact: true })).toBeVisible();
  await expect(reader.getByText("→ GET /search?q=atlas", { exact: false })).toBeVisible();
  await expect(reader).toContainText('<button class="reset">Reset filters</button>');
  expect(
    await browser.evaluate(
      `!document.querySelector('[role="dialog"] [data-result-body] button') && document.querySelector('[role="dialog"] [data-result-body]').innerText.includes("clear enough.\\nRequest changes")`,
    ),
  ).toBe(true);
  await expect(reader.getByRole("combobox")).toHaveCount(0);
  await expect(reader.getByRole("button", "Submit answer", { exact: true })).toHaveCount(0);
  await app.screenshot("human-context-reader");
});

test("Tab skips the context links the clamped preview hides and reaches Read full context", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const { answer } = await openLongContextAnswer(app, screen);
  await expect(answer.getByRole("link", "reset filters layout", { exact: true })).toHaveCount(1);
  await answer.getByRole("link", "empty-state notes", { exact: true }).focus();

  // Act
  await browser.keyboard.press("Tab");

  // Assert
  await expect(answer.getByRole("button", "Read full context", { exact: true })).toBeFocused();
});

test("an answer submits from the Human card while its context is long", async ({ app, screen }) => {
  // Arrange
  const { found, answer } = await openLongContextAnswer(app, screen);
  await answer
    .getByRole("combobox", "Decision")
    .selectOption({ label: "Approve — ends this branch" });

  // Act
  await answer.getByRole("button", "Submit answer", { exact: true }).tap();

  // Assert
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).humanOccurrences[0]?.state)
    .toBe("answered");
});

test("parallel Human occurrences each open their own context in the reader", async ({
  app,
  screen,
}) => {
  // Arrange
  const found = await findRun(app.baseUrl, "UI worker · Two reviews wait for your decision");
  await app.open(`/runs/${found.id}`);
  const attention = screen.getByRole("complementary", "Run inspector");
  const accessibility = attention.getByRole(
    "article",
    "Needs input · Your decision · From Accessibility review · Visit 1",
    { exact: true },
  );
  await expect(
    attention
      .getByRole("article", "Needs input · Your decision · From Code review · Visit 1", {
        exact: true,
      })
      .getByRole("button", "Read full context", { exact: true }),
  ).toBeVisible();
  await app.screenshot("parallel-human-context");

  // Act
  await accessibility.getByRole("button", "Read full context", { exact: true }).tap();

  // Assert
  const reader = screen.getByRole("dialog", "Your decision · context", { exact: true });
  await expect(reader).toContainText(/From Accessibility review · Visit 1 · \d\d:\d\d/);
  await expect(reader.getByRole("heading", "Accessibility review", { exact: true })).toBeVisible();
  await expect(reader).not.toContainText("Code review");
});

test("Settle confirmation cancels without changes, then stops workers and settles from the row menu", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const title = "UI worker · Working · Improve the project picker";
  const found = await findRun(app.baseUrl, title);
  await app.open(`/runs/${found.id}`);
  const row = screen.getByRole("navigation", "Open Runs").getByRole("link", new RegExp(title));
  const before = await readHistoryRun(app.baseUrl, found.id);
  await row.secondaryTap();

  // Act
  await screen.getByRole("menuitem", "Settle", { exact: true }).tap();
  const dialog = screen.getByRole("alertdialog", `Settle “${title}”?`);
  await expect(dialog).toContainText("Factory asks T3 to stop the working Agent");
  await expect(dialog.getByRole("button", "Cancel", { exact: true })).toBeFocused();
  await browser.evaluate(
    "Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished))",
  );
  await app.screenshot("settle-confirmation");
  await dialog.getByRole("button", "Cancel", { exact: true }).tap();
  const cancelled = await readHistoryRun(app.baseUrl, found.id);
  expect(cancelled.lifecycle).toBe("active");
  expect(cancelled.settlement).toBeNull();
  expect(cancelled.gateOpen).toBe(before.gateOpen);
  expect(cancelled.events).toEqual(before.events);
  await row.secondaryTap();
  await screen.getByRole("menuitem", "Settle", { exact: true }).tap();
  await confirmSettlement(screen);

  // Assert
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).lifecycle)
    .toBe("settled");
  await browser.reload();
  await expect(
    screen.getByRole("navigation", "Settled Runs").getByRole("link", new RegExp(title)),
  ).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toContainText("Settled");
  await app.screenshot("run-settled-from-row-menu");
});

test("a late report cannot revive a manually Settled Run", async ({ app, screen }) => {
  // Arrange
  const found = await findRun(app.baseUrl, "UI worker · Working · Improve the project picker");
  await settleStoppingWorkers(app.baseUrl, found.id);
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).lifecycle)
    .toBe("settled");
  await app.open(`/runs/${found.id}`);
  const before = await readHistoryRun(app.baseUrl, found.id);

  // Act
  const report = await applyRunState(
    app,
    found.id,
    "late working report",
    "Two subagents are still checking the empty state.",
  );

  // Assert
  expect(report).toMatchObject({ outcome: "RUN_SETTLED" });
  const after = await readHistoryRun(app.baseUrl, found.id);
  expect(after.lifecycle).toBe("settled");
  expect(after.reports).toEqual(before.reports);
  expect(after.activations).toEqual(before.activations);
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toContainText("Settled");
});

test("an unresolved settlement is one Run card whose Retry settlement asks T3 to stop again", async ({
  app,
  screen,
}) => {
  // Arrange
  const found = await findRun(
    app.baseUrl,
    "UI worker · Settlement unresolved · Stop support unavailable",
  );
  await app.open(`/runs/${found.id}`);
  const card = screen.getByRole("article", "Problem · Run");
  await expect(card).toContainText("Settle couldn’t stop Implement change");
  await expect(card).toContainText("This T3 version can’t stop worker threads.");
  await expect(card.getByRole("link", "Open in T3", { exact: false })).toBeVisible();
  await expect(screen.getByText("Settle requested", { exact: false })).toBeVisible();
  const row = screen
    .getByRole("navigation", "Open Runs")
    .getByRole("link", new RegExp(found.title));
  await expect(row).not.toContainText("Settle unresolved");
  await expect(row).toContainText("Problem");
  const before = await readHistoryRun(app.baseUrl, found.id);
  assert(before.settlement?.workers[0]?.problem);
  await card.getByRole("button", "Technical details").tap();
  await expect(card).toContainText(before.settlement.workers[0].problem);
  await app.screenshot("settlement-unresolved");
  await applyRunState(app, found.id, "Stop taken while the turn continues");

  // Act
  await card.getByRole("button", "Retry settlement", { exact: true }).tap();

  // Assert
  await expect
    .poll(async () => (await readHistoryRun(app.baseUrl, found.id)).settlement?.state)
    .toBe("stopping");
  await expect(screen.getByRole("region", "Run settlement")).toHaveCount(0);
  await app.screenshot("settlement-retry-stopping");
});

test("a held Stop that ends settles the Run and its meta line stops saying Settle requested", async ({
  app,
  screen,
}) => {
  // Arrange
  const id = await liveRun(app, "settle-held-stop");
  await applyRunState(app, id, "Stop taken while the turn continues");
  await settleStoppingWorkers(app.baseUrl, id);
  await app.open(`/runs/${id}`);
  const requested = screen.getByText("Settle requested", { exact: false });
  await expect(requested).toBeVisible();

  // Act
  await applyRunState(app, id, "stopped turns ended");

  // Assert
  await expect.poll(async () => (await readHistoryRun(app.baseUrl, id)).lifecycle).toBe("settled");
  await expect(requested).toHaveCount(0);
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toContainText("Settled");
  await app.screenshot("settlement-stop-finished");
});

/** T3 ends the turns Settle asked to stop, and the Run settles. */
async function finishStopping(baseUrl: string | undefined, id: string) {
  await applyRunState({ baseUrl }, id, "stopped turns ended");
  await expect.poll(async () => (await readHistoryRun(baseUrl, id)).lifecycle).toBe("settled");
}

/** Confirms Settle from the row menu with the keyboard while T3 keeps the stopped turn running. */
async function confirmSettleStillStopping(
  { app, screen, browser }: { app: App; screen: Screen; browser: Browser },
  title: string,
) {
  const found = await findRun(app.baseUrl, title);
  await applyRunState(app, found.id, "Stop taken while the turn continues");
  await app.open(`/runs/${found.id}`);
  const row = screen.getByRole("navigation", "Open Runs").getByRole("link", new RegExp(title));
  await row.secondaryTap();
  await screen.getByRole("menuitem", "Settle", { exact: true }).tap();
  const confirmation = screen.getByRole("alertdialog", `Settle “${title}”?`);
  await expect(confirmation.getByRole("button", "Cancel", { exact: true })).toBeFocused();
  await browser.keyboard.press("Tab");
  await browser.keyboard.press("Enter");
  await expect(row).toContainText("Stopping");
  await expect(row).toBeFocused();
  return found;
}

test("a keyboard-confirmed Settle that finishes stopping later focuses the Settled group", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await confirmSettleStillStopping(
    { app, screen, browser },
    "UI worker · Corrections back in review",
  );

  // Act
  await finishStopping(app.baseUrl, found.id);

  // Assert
  await expect(screen.getByRole("button", /^Settled/)).toBeFocused();
});

test("a Settle that finishes stopping later leaves focus where the user moved it", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const found = await confirmSettleStillStopping(
    { app, screen, browser },
    "UI worker · Working · Hotfix notes reviewed without waiting for CI",
  );
  const search = screen.getByRole("textbox", "Search Run titles", { exact: true });
  await search.focus();

  // Act
  await finishStopping(app.baseUrl, found.id);

  // Assert
  await expect(screen.getByRole("button", /^Settled/)).toBeVisible();
  await expect(search).toBeFocused();
});

test("a Settle that finishes stopping later leaves focus on the page after the user left the row", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const id = await liveRun(app, "settle-left-row");
  const { title } = await readHistoryRun(app.baseUrl, id);
  await confirmSettleStillStopping({ app, screen, browser }, title);
  const search = screen.getByRole("textbox", "Search Run titles", { exact: true });
  await search.focus();
  await expect(search).toBeFocused();
  // Focus falls to the page, as when the user clicks content outside any focusable container.
  await browser.evaluate("document.activeElement.blur()");
  expect(await browser.evaluate("document.activeElement === document.body")).toBe(true);

  // Act
  await finishStopping(app.baseUrl, id);

  // Assert
  await expect(
    screen.getByRole("navigation", "Open Runs").getByRole("link", new RegExp(title)),
  ).toHaveCount(0);
  await expect(screen.getByRole("button", /^Settled/)).not.toBeFocused();
  expect(await browser.evaluate("document.activeElement === document.body")).toBe(true);
});

test("Archive from the Run page's ··· menu asks for confirmation and archives both worker branches at once", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const title = "UI worker · Parallel review from one prompt";
  const found = await findRun(app.baseUrl, title);
  const before = await readHistoryRun(app.baseUrl, found.id);
  await app.open(`/runs/${found.id}`);
  await expect(screen.getByRole("button", "Archive Run", { exact: true })).toHaveCount(0);
  await screen.getByRole("button", "Run actions", { exact: true }).tap();
  await screen.getByRole("menuitem", "Archive…", { exact: true }).tap();
  const confirmation = screen.getByRole("dialog", `Archive “${title}”?`);
  await expect(confirmation).toContainText("command palette");
  await app.screenshot("run-page-archive-confirmation");

  // Act
  await confirmation.getByRole("button", "Archive Run", { exact: true }).tap();

  // Assert
  await expect(screen.getByLabel("Initial prompt", { exact: false })).toBeVisible();
  const saved = await readHistoryRun(app.baseUrl, found.id);
  expect(saved.lifecycle).toBe("archived");
  expect(saved.gateOpen).toBe(false);
  expect(saved.threadBindings).toEqual(before.threadBindings);
  expect(saved.blocks.map((block) => block.state)).toEqual(["stopped", "stopped"]);
  expect(await runsTitled(app.baseUrl, title)).toHaveLength(0);
  await app.open(`/runs/${found.id}`);
  await browser.reload();
  await expect(screen.getByLabel("Run lifecycle", { exact: true })).toContainText("Archived");
  await expect(screen.getByRole("button", "Run actions", { exact: true })).toHaveCount(0);
  await app.screenshot("archived-run-history-by-link");
});

test("the row menu opened with Shift+F10 archives a Run after confirmation", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const title = "UI worker · Two reviewers working in parallel";
  const found = await findRun(app.baseUrl, title);
  await app.open("/runs/new");
  const row = screen.getByRole("navigation", "Open Runs").getByRole("link", new RegExp(title));
  await row.press("Shift+F10");
  await screen.getByRole("menuitem", "Archive…", { exact: true }).tap();
  const confirmation = screen.getByRole("dialog", `Archive “${title}”?`);

  // Act
  await confirmation.getByRole("button", "Archive Run", { exact: true }).tap();

  // Assert
  await expect(row).toHaveCount(0);
  expect((await readHistoryRun(app.baseUrl, found.id)).lifecycle).toBe("archived");
  await browser.reload();
  await expect(screen.getByRole("navigation", "Open Runs")).not.toContainText(title);
  await app.screenshot("run-archived-from-row-menu");
});
