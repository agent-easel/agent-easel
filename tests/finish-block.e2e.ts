import { test } from "./support/test.ts";
import { expect, type Screen } from "e2e";
import { FINISH_BLOCK_ID, type FlowConnection } from "../packages/contracts/src/index.ts";
import { readFlow, saveFlowElsewhere, saveSingleAgentFlow } from "./support/flows.ts";
import { chooseDecision } from "./support/human-answers.ts";
import { archiveJourneyRun, readHistoryRun } from "./support/run-history.ts";
import { applyRunState, prepareScenario } from "./support/scenarios.ts";
import { expectFlowSaved, readinessSummary, saveFlowWithReadiness } from "./support/studio.ts";

const finishBlock = (screen: Screen) => screen.getByRole("article", "Finish block");
const ending = (screen: Screen, name: string) => screen.getByRole("region", `Ending ${name}`);
const runResult = (screen: Screen) => screen.getByRole("region", "Run result");

function endingWire(sourceBlockId: string, exitId: string, targetEndingId: string): FlowConnection {
  return { sourceBlockId, exitId, targetBlockId: FINISH_BLOCK_ID, targetEndingId };
}

async function addEnding(screen: Screen, name: string) {
  await screen.getByRole("button", "Add ending", { exact: true }).tap();
  await ending(screen, "Unnamed ending").getByLabel("Name", { exact: true }).fill(name);
}

async function saveDeliveredFlow(
  baseUrl: string | undefined,
  name: string,
  legacyAgentEntry?: "input" | "handoff",
) {
  const id = await saveSingleAgentFlow(baseUrl, name, "Runtime worker", {
    id: "worker",
    name: "Ship the fix",
    x: 320,
    y: 60,
  });
  const flow = await readFlow(baseUrl, id);
  const worker = flow.graph.blocks[0]!;
  const legacyAgent = {
    ...worker,
    id: FINISH_BLOCK_ID,
    name: "Legacy Agent",
    position: { x: 320, y: 340 },
  };
  await saveFlowElsewhere(baseUrl, flow, {
    graph: {
      ...flow.graph,
      ...(legacyAgentEntry && { blocks: [...flow.graph.blocks, legacyAgent] }),
      ...(legacyAgentEntry === "input" && {
        flowInput: { ...flow.graph.flowInput, targetBlockIds: [worker.id, legacyAgent.id] },
      }),
      finish: {
        ...flow.graph.finish,
        endings: [
          {
            id: "delivered",
            name: "Delivered",
            description: "The fix is in review.",
            output: "required",
            outputDescription: "URL of the pull request",
          },
          {
            id: "deferred",
            name: "Deferred",
            description: "",
            output: "none",
            outputDescription: "",
          },
        ],
      },
      connections: [
        ...(legacyAgentEntry === "handoff"
          ? [{ sourceBlockId: worker.id, exitId: "done", targetBlockId: legacyAgent.id }]
          : []),
        endingWire("worker", "done", "delivered"),
        endingWire("worker", "done", "deferred"),
      ],
    },
  });
  return id;
}

test("the Flow input offers its legacy Agent entry and excludes every ending", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const flowId = await saveDeliveredFlow(app.baseUrl, "Legacy Agent entry", "input");
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Flow input", { exact: true }).tap();

  // Act
  await screen.getByRole("button", /^Targets of the Flow input:/).tap();

  // Assert
  await expect(
    screen.getByRole("menuitemcheckbox", "Legacy Agent", { exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(screen.getByRole("menuitemcheckbox", /^Finish → /)).toHaveCount(0);
  await app.screenshot("finish-flow-input-targets");
});

test("the legacy Agent inspector keeps the accepted ending out of its Received results", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const flowId = await saveDeliveredFlow(app.baseUrl, "Legacy Agent with an ending", "handoff");
  const { id: runId } = await fixture.scenarios.ensure({
    key: "finish-legacy-recipient",
    flow: { id: flowId },
  });
  await app.open(`/runs/${runId}`);
  await applyRunState(app, runId, "result reported", "https://github.com/example/atlas/pull/46");
  await expect(runResult(screen)).toContainText("Delivered");
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();

  // Act
  await screen.getByRole("button", /^Agent Legacy Agent, /).tap();

  // Assert
  const received = screen.getByRole("region", "Received results", { exact: true });
  await expect(received.getByRole("article", /Ship the fix/)).toHaveCount(1);
  await app.screenshot("finish-legacy-agent-inspector");
});

test("a Block with the stored ID finish keeps its own settings next to Finish", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const flowId = await saveSingleAgentFlow(
    app.baseUrl,
    "Finish with legacy review",
    "Sample worker",
    {
      id: "coder",
      name: "Coder",
      x: 320,
      y: 60,
    },
  );
  const flow = await readFlow(app.baseUrl, flowId);
  await saveFlowElsewhere(app.baseUrl, flow, {
    graph: {
      ...flow.graph,
      blocks: [
        ...flow.graph.blocks,
        {
          id: FINISH_BLOCK_ID,
          name: "Legacy review",
          kind: "human",
          position: { x: 640, y: 60 },
        },
      ],
      connections: [
        { sourceBlockId: "coder", exitId: "ok", targetBlockId: FINISH_BLOCK_ID },
        {
          sourceBlockId: FINISH_BLOCK_ID,
          exitId: "approve",
          targetBlockId: FINISH_BLOCK_ID,
          targetEndingId: "done",
        },
      ],
      finish: {
        position: { x: 960, y: 60 },
        endings: [
          {
            id: "done",
            name: "Delivered",
            description: "",
            output: "required",
            outputDescription: "PR URL",
          },
        ],
      },
    },
  });
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();

  // Act
  await screen.getByRole("button", "Human step Legacy review", { exact: true }).tap();

  // Assert
  await expect(screen.getByRole("heading", "Human step", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Finish", { exact: true }).tap();
  const delivered = ending(screen, "Delivered");
  await expect(delivered).toContainText("Legacy review → Approve");
  await expect(delivered.getByText("Message required", { exact: true })).toHaveCount(0);
  await app.screenshot("finish-legacy-review-approve");
});

test("endings wired in Studio keep a renamed ending's wire and drop a removed ending's wire after Save and reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(app.baseUrl, "Ship or drop by hand", "Sample worker", {
    id: "coder",
    name: "Coder",
    x: 320,
    y: 60,
  });
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Finish", { exact: true }).tap();
  await expect(screen.getByText("No endings yet", { exact: true })).toBeVisible();
  await addEnding(screen, "Shipped");
  await ending(screen, "Shipped").getByRole("radio", "Required").tap();
  await ending(screen, "Shipped").getByLabel("Output description").fill("URL of the pull request");
  await addEnding(screen, "Dropped");
  await addEnding(screen, "Needs a person");
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await screen
    .getByRole("button", "Connect exit ok of Coder")
    .dragTo(finishBlock(screen).getByText("Shipped", { exact: true }));
  await screen
    .getByRole("button", "Connect exit fail of Coder")
    .dragTo(finishBlock(screen).getByText("Dropped", { exact: true }));
  await expect(ending(screen, "Shipped")).toContainText("Coder → ok");
  await expect(ending(screen, "Needs a person")).toContainText("No exit leads to this ending yet.");
  await saveFlowWithReadiness(screen, /^Not ready/);
  await app.screenshot("finish-ending-not-connected");
  await ending(screen, "Shipped").getByLabel("Name", { exact: true }).fill("Delivered");
  await screen.getByRole("button", "Remove ending Dropped", { exact: true }).tap();
  const undo = await browser.evaluate(
    '/Mac|iPhone|iPod|iPad/i.test(navigator.platform) ? "Meta+z" : "Control+z"',
  );
  await browser.keyboard.press(undo as string);
  await expect(ending(screen, "Dropped")).toContainText("Coder → fail");
  await screen.getByRole("button", "Remove ending Dropped", { exact: true }).tap();
  await screen.getByRole("button", "Remove ending Needs a person", { exact: true }).tap();

  // Act
  await screen.getByRole("button", "Save", { exact: true }).tap();

  // Assert
  await expectFlowSaved(screen);
  await browser.reload();
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  await expect(finishBlock(screen)).toContainText("Delivered");
  await screen.getByRole("button", "Finish", { exact: true }).tap();
  await expect(ending(screen, "Delivered")).toContainText("Coder → ok");
  await expect(ending(screen, "Dropped")).toHaveCount(0);
  await app.screenshot("finish-renamed-ending-after-reload");
  const saved = await readFlow(app.baseUrl, flowId);
  const [delivered] = saved.graph.finish.endings;
  expect(saved.graph.finish.endings).toEqual([
    {
      id: delivered?.id,
      name: "Delivered",
      description: "",
      output: "required",
      outputDescription: "URL of the pull request",
    },
  ]);
  expect(saved.graph.connections).toEqual([
    {
      sourceBlockId: "coder",
      exitId: "ok",
      targetBlockId: FINISH_BLOCK_ID,
      targetEndingId: delivered?.id,
    },
  ]);
});

test("a started Run has no result yet, then shows the reached ending on the canvas, inspector, overview and Timeline", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveDeliveredFlow(app.baseUrl, "Deliver the ranking fix");
  const { id: runId } = await fixture.scenarios.ensure({
    key: "finish-delivered",
    flow: { id: flowId },
  });
  await app.open(`/runs/${runId}`);
  await expect(runResult(screen)).toContainText("No result yet");
  await expect(screen.getByRole("button", "Finish", { exact: true })).toBeVisible();
  await app.screenshot("finish-run-no-result-yet");

  // Act
  await applyRunState(app, runId, "result reported", "https://github.com/example/atlas/pull/46");

  // Assert
  await expect(runResult(screen)).toContainText("Delivered");
  await expect(runResult(screen)).toContainText("https://github.com/example/atlas/pull/46");
  await expect(runResult(screen)).toContainText("Ship the fix → Done");
  const finish = screen.getByRole("button", "Finish, reached Delivered", { exact: true });
  await expect(finish).toBeVisible();
  await expect(finishBlock(screen)).toContainText(/Reached · \d\d:\d\d/);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await app.screenshot("finish-run-reached-overview");
  await screen
    .getByRole("article", "Ship the fix · Visit 1 · result", { exact: true })
    .getByRole("button", "Read result", { exact: true })
    .tap();
  const report = screen.getByRole("dialog", "Ship the fix · result", { exact: true });
  await report.getByRole("button", "Technical details", { exact: true }).tap();
  await expect(report).toContainText("Delivered → Finish · Delivered");
  await expect(report).toContainText("Cancelled → Finish · Deferred");
  await app.screenshot("finish-report-deliveries");
  await report.getByRole("button", "Close result", { exact: true }).tap();
  await finish.tap();
  await expect(screen.getByText("Result · ending Delivered", { exact: false })).toBeVisible();
  await app.screenshot("finish-run-reached-inspector");
  await screen.getByRole("button", "Show timeline", { exact: true }).tap();
  await expect(screen.getByRole("region", "Timeline")).toContainText(
    "Run reached ending Delivered",
  );
  await app.screenshot("finish-run-reached-timeline");
  const run = await readHistoryRun(app.baseUrl, runId);
  expect(run.result).toMatchObject({
    endingId: "delivered",
    endingName: "Delivered",
    output: "https://github.com/example/atlas/pull/46",
    outputMissing: false,
    sourceBlockId: "worker",
    exitId: "done",
  });
});

test("a Human answer routed to two endings keeps its author and worker and shows which delivery won", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(
    app.baseUrl,
    "Route a release review",
    "Runtime worker",
    {
      id: "worker",
      name: "Prepare release",
      x: 320,
      y: 60,
    },
    "done",
  );
  const flow = await readFlow(app.baseUrl, flowId);
  await saveFlowElsewhere(app.baseUrl, flow, {
    graph: {
      ...flow.graph,
      blocks: [
        ...flow.graph.blocks,
        {
          id: "route",
          kind: "condition",
          name: "Route approval",
          position: { x: 1020, y: 60 },
          rules: [],
          otherwise: { id: "otherwise" },
        },
      ],
      finish: {
        position: { x: 1370, y: 60 },
        endings: [
          {
            id: "shipped",
            name: "Shipped",
            description: "",
            output: "optional",
            outputDescription: "",
          },
          { id: "held", name: "Held", description: "", output: "none", outputDescription: "" },
        ],
      },
      connections: [
        ...flow.graph.connections,
        { sourceBlockId: "review", exitId: "approve", targetBlockId: "route" },
        endingWire("route", "otherwise", "shipped"),
        endingWire("route", "otherwise", "held"),
      ],
    },
  });
  const { id: runId } = await fixture.scenarios.ensure({
    key: "finish-human",
    flow: { id: flowId },
  });
  await applyRunState(app, runId, "result reported", "Release candidate is ready.");
  await app.open(`/runs/${runId}`);
  const review = screen.getByRole("form", "Answer Review", { exact: true });
  await chooseDecision(screen, review, "Approve → Route approval");
  await review.getByRole("textbox", "Response", { exact: true }).fill("Approved for release.");

  // Act
  await review.getByRole("button", "Submit answer", { exact: true }).tap();

  // Assert
  const finished = screen.getByRole("button", "Finish, reached Shipped", { exact: true });
  await expect(finished).toBeVisible();
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await finished.tap();
  await expect(runResult(screen)).toContainText("Route approval → Otherwise");
  await expect(runResult(screen)).toContainText("Review · Human step");
  await expect(runResult(screen)).toContainText("Approved for release.");
  await expect(runResult(screen)).toContainText("Prepare release");
  const run = await readHistoryRun(app.baseUrl, runId);
  const worker = run.threadBindings.find((binding) => binding.blockId === "worker");
  expect(worker?.link).toBeTruthy();
  await expect(runResult(screen).getByRole("link", "Open in T3")).toHaveAttribute(
    "href",
    worker!.link!,
  );
  await app.screenshot("finish-forwarded-human-author");
  await screen.getByRole("button", /^Condition Route approval, /).tap();
  const recipients = screen.getByRole("list", "Arrival 1 recipients", { exact: true });
  await expect(
    recipients.getByRole("listitem").filter({ hasText: "Finish · Shipped" }),
  ).toContainText("Acknowledged");
  await expect(recipients.getByRole("listitem").filter({ hasText: "Finish · Held" })).toContainText(
    "Cancelled",
  );
  await app.screenshot("finish-condition-deliveries");
});

test("a prompted Continuation that reaches an ending identifies its own response and the Agent worker it ran on", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(app.baseUrl, "Write release notes", "Runtime worker", {
    id: "worker",
    name: "Implement the fix",
    x: 320,
    y: 60,
  });
  const flow = await readFlow(app.baseUrl, flowId);
  await saveFlowElsewhere(app.baseUrl, flow, {
    graph: {
      ...flow.graph,
      blocks: [
        ...flow.graph.blocks,
        {
          id: "spec",
          kind: "continuation",
          name: "Summarize the release",
          prompt: "Write the release notes.",
          position: { x: 680, y: 60 },
        },
      ],
      finish: {
        position: { x: 1040, y: 60 },
        endings: [
          {
            id: "notes",
            name: "Notes ready",
            description: "",
            output: "optional",
            outputDescription: "",
          },
        ],
      },
      connections: [
        { sourceBlockId: "worker", exitId: "done", targetBlockId: "spec" },
        endingWire("spec", "output", "notes"),
      ],
    },
  });
  const { id: runId } = await fixture.scenarios.ensure({
    key: "finish-continuation",
    flow: { id: flowId },
  });
  await applyRunState(app, runId, "result reported", "The fix is ready.");
  await app.open(`/runs/${runId}`);

  // Act
  await applyRunState(
    app,
    runId,
    "Continuation response reported",
    "Release notes are in **CHANGELOG.md**.",
  );

  // Assert
  await screen.getByRole("button", "Finish, reached Notes ready", { exact: true }).tap();
  await expect(runResult(screen)).toContainText("By Summarize the release");
  await expect(runResult(screen)).toContainText("Worker Implement the fix");
  await expect(runResult(screen).getByText("CHANGELOG.md", { exact: true })).toBeVisible();
  await expect(runResult(screen).getByRole("link", "Open in T3")).toBeVisible();
  await app.screenshot("finish-continuation-author");
});

test("an archived Run whose Flow has endings shows No result and no reached ending", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveDeliveredFlow(app.baseUrl, "Deliver or archive");
  const { id: runId } = await fixture.scenarios.ensure({
    key: "finish-archived",
    flow: { id: flowId },
  });

  // Act
  await archiveJourneyRun(app.baseUrl, runId);

  // Assert
  await app.open(`/runs/${runId}`);
  await expect(runResult(screen)).toContainText("No result");
  await expect(runResult(screen)).toContainText("The Run ended without reaching an ending.");
  await expect(finishBlock(screen)).toContainText("No ending reached");
  await app.screenshot("finish-run-no-result");
  expect((await readHistoryRun(app.baseUrl, runId)).result).toBeNull();
});

test("a reached ending stays the Run's result while the other branch stops, and that branch shows Stopped once settled", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const { id: runId } = await prepareScenario(app, "ending-stopping");
  await app.open(`/runs/${runId}`);
  await expect(runResult(screen)).toContainText("Stopping");
  await expect(runResult(screen)).toContainText("Shipped");
  await expect(
    screen.getByRole("button", "Finish, reached Shipped", { exact: true }),
  ).toBeVisible();
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await app.screenshot("finish-run-stopping");
  await screen.getByRole("button", "Finish, reached Shipped", { exact: true }).tap();
  await expect(
    screen.getByText("Reaching Shipped is stopping Explore an alternative.", { exact: false }),
  ).toBeVisible();
  await app.screenshot("finish-run-stopping-inspector");
  await screen.getByRole("button", "Back to Run overview", { exact: true }).tap();

  // Act
  await applyRunState(app, runId, "stopped turns ended");

  // Assert
  await expect(runResult(screen)).not.toContainText("Stopping");
  await expect(runResult(screen)).toContainText("Shipped");
  await expect(screen.getByRole("article", "Block Explore an alternative")).toContainText(
    "Stopped",
  );
  await screen.getByRole("button", "Show timeline", { exact: true }).tap();
  await expect(screen.getByRole("region", "Timeline")).toContainText(
    "settled · reached ending Shipped",
  );
  await app.screenshot("finish-run-settled-branch-stopped");
  const run = await readHistoryRun(app.baseUrl, runId);
  expect(run.lifecycle).toBe("settled");
  expect(run.result).toMatchObject({ endingId: "shipped", sourceBlockId: "worker" });
  expect(run.blocks.find((block) => block.blockId === "reviewer")?.state).toBe("stopped");
});

test("an unresolved Stop after reaching an ending names the blocked worker without calling it Stopping", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const { id: runId } = await prepareScenario(app, "ending-unresolved");
  await app.open(`/runs/${runId}`);
  await expect(runResult(screen)).toContainText("Shipped");
  await expect(runResult(screen)).not.toContainText("Stopping");
  await expect(screen.getByText(/Stop unresolved$/)).toBeVisible();
  await expect(screen.getByText("Settle couldn’t stop Explore an alternative")).toBeVisible();

  // Act
  await screen.getByRole("button", "Finish, reached Shipped", { exact: true }).tap();

  // Assert
  await expect(
    screen.getByText(/Factory couldn’t confirm the stop for Explore an alternative/),
  ).toBeVisible();
  await expect(screen.getByText(/Reaching Shipped is stopping/)).toHaveCount(0);
  await app.screenshot("finish-run-unresolved-stop");
});
