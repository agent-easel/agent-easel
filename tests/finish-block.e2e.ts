import { test } from "./support/test.ts";
import { expect, type Screen } from "e2e";
import { FINISH_BLOCK_ID } from "../packages/contracts/src/index.ts";
import { readFlow, saveFlowElsewhere, saveSingleAgentFlow } from "./support/flows.ts";
import { archiveJourneyRun, readHistoryRun } from "./support/run-history.ts";
import { applyRunState, prepareScenario } from "./support/scenarios.ts";
import { expectFlowSaved, readinessSummary, saveFlowWithReadiness } from "./support/studio.ts";

const finishBlock = (screen: Screen) => screen.getByRole("article", "Finish block");
const ending = (screen: Screen, name: string) => screen.getByRole("region", `Ending ${name}`);
const runResult = (screen: Screen) => screen.getByRole("region", "Run result");

async function addEnding(screen: Screen, name: string) {
  await screen.getByRole("button", "Add ending", { exact: true }).tap();
  await ending(screen, "Unnamed ending").getByLabel("Name", { exact: true }).fill(name);
}

async function saveDeliveredFlow(baseUrl: string | undefined, name: string) {
  const id = await saveSingleAgentFlow(baseUrl, name, "Runtime worker", {
    id: "worker",
    name: "Ship the fix",
    x: 320,
    y: 60,
  });
  const flow = await readFlow(baseUrl, id);
  await saveFlowElsewhere(baseUrl, flow, {
    graph: {
      ...flow.graph,
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
        ],
      },
      connections: [
        {
          sourceBlockId: "worker",
          exitId: "done",
          targetBlockId: FINISH_BLOCK_ID,
          targetEndingId: "delivered",
        },
      ],
    },
  });
  return id;
}

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
  await browser.keyboard.press("Meta+z");
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
