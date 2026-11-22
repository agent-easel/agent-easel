import { expect } from "e2e";
import { test } from "./support/test.ts";
import { readFlow, saveFlowElsewhere, saveSingleAgentFlow } from "./support/flows.ts";
import { readHistoryRun } from "./support/run-history.ts";
import { expectFlowSaved, readinessSummary } from "./support/studio.ts";

async function saveParallelReviewFlow(baseUrl: string | undefined) {
  const flowId = await saveSingleAgentFlow(baseUrl, "Join two reviews", "Runtime worker", {
    id: "worker",
    name: "Coder",
    x: 320,
    y: 200,
  });
  const flow = await readFlow(baseUrl, flowId);
  const coder = flow.graph.blocks[0]!;
  const reviewer = (id: string, name: string, y: number) => ({
    ...coder,
    id,
    name,
    position: { x: 700, y },
  });
  await saveFlowElsewhere(baseUrl, flow, {
    graph: {
      ...flow.graph,
      blocks: [
        coder,
        reviewer("code", "Code review", -80),
        reviewer("security", "Security review", 640),
        { id: "decision", kind: "human", name: "Your decision", position: { x: 1460, y: 200 } },
      ],
      connections: [
        { sourceBlockId: "worker", exitId: "done", targetBlockId: "code" },
        { sourceBlockId: "worker", exitId: "done", targetBlockId: "security" },
      ],
    },
  });
  return flowId;
}

test("a Join wired in Studio waits on the Run canvas and inspector for its second source, then forwards one combined message", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveParallelReviewFlow(app.baseUrl);
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Add Join").tap();
  await screen.getByLabel("Name", { exact: true }).fill("Review results");
  await screen.getByRole("button", "Close block settings").tap();
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  const join = screen.getByRole("article", "Block Review results");
  await screen.getByRole("button", "Connect exit Done of Code review").dragTo(join);
  await screen.getByRole("button", "Connect exit Done of Security review").dragTo(join);
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expectFlowSaved(screen);
  await screen.getByRole("button", /^Not ready/).tap();
  await expect(screen.getByRole("list", "Readiness issues")).toContainText(
    "Review results: connect its output.",
  );
  await screen.getByRole("button", /^Not ready/).tap();
  await expect(join.getByRole("list", "Sources")).toContainText(
    /Code review\s*1 exit\s*Security review\s*1 exit/,
  );
  await screen.getByRole("button", "Join Review results").tap();
  await screen.getByRole("button", /^Targets of output/).tap();
  await screen.getByRole("menuitemcheckbox", "Your decision").tap();
  await browser.keyboard.press("Escape");
  await screen.getByRole("button", "Save", { exact: true }).tap();
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  await app.screenshot("join-authored-ready");
  const { id: runId } = await fixture.scenarios.ensure({
    key: "join-review",
    flow: { id: flowId },
  });
  await fixture.scenarios.transition({ id: runId, state: "result reported" });
  await fixture.scenarios.transition({ id: runId, state: "result released to two workers" });
  await fixture.scenarios.reportFrom({
    id: runId,
    blockId: "code",
    message: "The handler is **scoped** correctly.",
  });
  await app.open(`/runs/${runId}`);
  await expect(join).toContainText("Waiting · 1/2 sources");
  await expect(join.getByRole("list", "Sources")).toContainText(
    /Code review\s*Done\s*Security review\s*pending/,
  );
  await screen.getByRole("button", /^Join Review results, /).tap();
  const sources = screen.getByRole("region", "Join sources");
  await expect(sources.getByRole("listitem", "Code review, arrived Done")).toBeVisible();
  await expect(sources.getByRole("listitem", "Security review, pending")).toBeVisible();
  await app.screenshot("join-run-waiting");

  // Act
  await fixture.scenarios.reportFrom({
    id: runId,
    blockId: "security",
    message: "Focus returns to the trigger after Escape.",
  });

  // Assert
  await expect(join).toContainText(/Join · round 1 forwarded \d\d:\d\d/);
  await expect(join.getByRole("list", "Sources")).toContainText(
    /Code review\s*Done\s*Security review\s*Done/,
  );
  await expect(sources).toContainText("Round 1 forwarded");
  await screen.getByRole("button", "Show timeline", { exact: true }).tap();
  await expect(screen.getByRole("region", "Timeline")).toContainText(
    "round 1 forwarded · 2/2 sources → Your decision",
  );
  await screen.getByRole("button", "Back to Run overview").tap();
  const decision = screen
    .getByRole("complementary", "Run inspector")
    .getByRole("article", /^Needs input · Your decision/);
  await expect(decision.getByRole("heading", "Code review — Done", { exact: true })).toBeVisible();
  await expect(decision.getByText("scoped", { exact: false })).toBeVisible();
  await app.screenshot("join-run-forwarded");
  const run = await readHistoryRun(app.baseUrl, runId);
  expect(run.joins).toMatchObject([
    { round: 2, sources: 2, arrived: 0, queued: 0, latest: { round: 1, outcome: "forwarded" } },
  ]);
  expect(run.humanOccurrences[0]?.context).toMatch(/^Join round 1\n/);
});
