import assert from "node:assert/strict";
import { test } from "./support/test.ts";
import { expect, type Screen } from "e2e";
import {
  expectFlowBlocked,
  readFlow,
  saveConditionAtSizeLimit,
  saveSingleAgentFlow,
} from "./support/flows.ts";
import { archiveJourneyRun, findRun, readHistoryRun } from "./support/run-history.ts";
import { prepareScenarios } from "./support/scenarios.ts";
import { openOneRuleCondition, saveConditionFlow } from "./support/conditions.ts";
import { chooseFlowAction, readinessSummary, saveFlowWithReadiness } from "./support/studio.ts";

/** Adds a block from the library row `row` at its default place and names it in its settings. */
async function addBlock(screen: Screen, row: string, name: string) {
  await screen.getByRole("button", `Add ${row}`).tap();
  await screen.getByLabel("Name", { exact: true }).fill(name);
}

/** Captures the fitted Run canvas beside the inspector as `canvasShot`, then opens the Timeline. */
async function openTimeline(
  app: { screenshot(name: string): Promise<unknown> },
  screen: Screen,
  canvasShot: string,
) {
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await app.screenshot(canvasShot);
  await screen.getByRole("button", "Show timeline", { exact: true }).tap();
  return screen.getByRole("region", "Timeline");
}

test("a Condition added from the library is ready once its Otherwise is connected, and a rule's readiness issue focuses that rule", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(app.baseUrl, "Escalate by arrival", "Sample worker", {
    id: "coder",
    name: "Coder",
    x: 320,
    y: 60,
  });
  await app.open(`/studio/flows/${flowId}`);
  await addBlock(screen, "Condition", "Escalate");
  // Fit the blocks beside the open panel so each drop target stays in view.
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await screen
    .getByRole("button", "Connect exit finish of Coder")
    .dragTo(screen.getByRole("article", "Block Escalate"));
  await saveFlowWithReadiness(screen, /^Not ready/);
  await expectFlowBlocked(
    screen,
    /Escalate: connect output "Otherwise"\. A Condition output cannot end a branch\./,
  );
  await screen.getByRole("button", /^Not ready/).tap();
  await screen
    .getByRole("button", "Connect output Otherwise of Escalate")
    .dragTo(screen.getByRole("article", "Block Coder"));
  await saveFlowWithReadiness(screen, "Ready", 3);
  await screen.getByRole("button", "Condition Escalate").tap();
  await screen.getByRole("button", "Add rule").tap();
  await screen.getByLabel("Rule 1 output name").fill("Human");
  await screen.getByLabel("Rule 1 from arrival").fill("3");
  await screen.getByRole("button", "Add rule").tap();
  await screen.getByLabel("Rule 2 output name").fill("End branch");
  await screen.getByLabel("Rule 2 from arrival").fill("5");
  await screen.getByRole("button", "Save").tap();
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 4");
  await expect(screen.getByRole("article", "Block Escalate")).toContainText(
    /from arrival 5 onward\s*End branch/,
  );
  await screen.getByRole("button", "Close block settings").tap();
  await screen.getByRole("button", /^Not ready/).tap();

  // Act
  await screen
    .getByRole("list", "Readiness issues")
    .getByRole("button", /rule 2 "End branch" is never selected/)
    .tap();

  // Assert
  await expect(screen.getByLabel("Rule 2 from arrival")).toBeFocused();
  await expect(screen.getByLabel("Rule 2 from arrival")).toHaveValue("5");
  await app.screenshot("condition-shadowed-rule-focused");
  const saved = await readFlow(app.baseUrl, flowId);
  expect(saved.graph.blocks[1]).toMatchObject({
    kind: "condition",
    rules: [
      { name: "Human", fromArrival: 3 },
      { name: "End branch", fromArrival: 5 },
    ],
  });
});

test("reordering a rule by keyboard keeps its wire, and removing a rule removes its wire, after reload", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveConditionFlow(
    app.baseUrl,
    "Reorder Condition rules",
    [
      { id: "human", name: "Human", fromArrival: 3 },
      { id: "end", name: "End branch", fromArrival: 5 },
    ],
    [
      ["human", "review"],
      ["end", "review"],
      ["otherwise", "worker"],
    ],
  );
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Condition Escalate").tap();
  const moveUp = screen
    .getByRole("listitem", "Rule 2 End branch")
    .getByRole("button", "Move rule up");
  await moveUp.focus();
  await moveUp.press("Enter");
  await expect(screen.getByLabel("Rule 1 output name")).toBeFocused();
  await expect(screen.getByLabel("Rule 1 output name")).toHaveValue("End branch");

  // Act
  await screen.getByRole("listitem", "Rule 2 Human").getByRole("button", "Remove rule").tap();
  await screen.getByRole("button", "Save").tap();

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 3");
  await browser.reload();
  await screen.getByRole("button", "Condition Escalate").tap();
  await expect(
    screen
      .getByRole("listitem", "Rule 1 End branch")
      .getByRole("button", "Targets of output End branch: Review"),
  ).toBeVisible();
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  const saved = await readFlow(app.baseUrl, flowId);
  const condition = saved.graph.blocks.find((block) => block.id === "escalate");
  assert(condition?.kind === "condition");
  expect(condition.rules).toEqual([{ id: "end", name: "End branch", fromArrival: 5 }]);
  expect(saved.graph.connections.filter((wire) => wire.sourceBlockId === "escalate")).toEqual([
    { sourceBlockId: "escalate", exitId: "end", targetBlockId: "review" },
    { sourceBlockId: "escalate", exitId: "otherwise", targetBlockId: "worker" },
  ]);
});

test("an arrival number that is not a whole number from 1 stays shown as invalid and cannot be saved", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await openOneRuleCondition({ app, screen, browser }, "Invalid Condition threshold");
  await screen.getByLabel("Rule 1 output name").fill("Ask a person");
  await expect(screen.getByRole("button", "Save")).toBeEnabled();

  // Act
  await screen.getByLabel("Rule 1 from arrival").fill("2.5");

  // Assert
  await expect(screen.getByLabel("Rule 1 from arrival")).toHaveValue("2.5");
  await expect(screen.getByRole("listitem", "Rule 1 Ask a person").getByRole("alert")).toHaveText(
    "1 to 9,007,199,254,740,991",
  );
  await expect(screen.getByRole("button", "Save")).toBeDisabled();
  await screen.getByLabel("Rule 1 from arrival").fill("");
  await expect(screen.getByRole("button", "Save")).toBeEnabled();
});

test("leaving a Flow with only an invalid arrival number asks first, and Keep editing keeps the text", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const flowId = await openOneRuleCondition({ app, screen, browser }, "Invalid threshold on leave");
  await screen.getByLabel("Rule 1 from arrival").fill("2.5");
  await screen.getByRole("navigation", "Studio navigation").getByRole("link", "Agents").tap();

  // Act
  await screen
    .getByRole("dialog", "Discard unsaved changes?")
    .getByRole("button", "Keep editing", { exact: true })
    .tap();

  // Assert
  await expect(browser).toHaveURL(`/studio/flows/${flowId}`);
  await expect(screen.getByLabel("Rule 1 from arrival")).toHaveValue("2.5");
});

test("removing a Flow with only an invalid arrival number opens the Flow list without a discard prompt", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  const flowId = await openOneRuleCondition({ app, screen, browser }, "Invalid threshold removed");
  await screen.getByLabel("Rule 1 from arrival").fill("2.5");
  await chooseFlowAction(screen, "Remove");

  // Act
  await screen
    .getByRole("dialog", "Remove “Invalid threshold removed”?")
    .getByRole("button", "Remove Flow", { exact: true })
    .tap();

  // Assert
  await expect(browser).toHaveURL("/studio/flows");
  await expect(screen.getByRole("dialog", /Discard/)).toHaveCount(0);
  await expect(screen.getByRole("link", /^Invalid threshold removed /)).toHaveCount(0);
  expect((await fetch(new URL(`/api/flows/${flowId}`, app.baseUrl))).ok).toBe(false);
});

test("a Condition authored and wired in Studio routes a started Run's arrivals by number to Otherwise and its rules, shown on the canvas, inspector and Timeline", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveSingleAgentFlow(
    app.baseUrl,
    "Route reviews by arrival",
    "Runtime worker",
    {
      id: "worker",
      name: "Coder",
      x: 320,
      y: 60,
    },
  );
  await app.open(`/studio/flows/${flowId}`);
  await addBlock(screen, "Human step", "Review");
  await addBlock(screen, "Condition", "Escalate");
  await screen.getByRole("button", "Add rule").tap();
  await screen.getByLabel("Rule 1 output name").fill("Ask a person");
  await screen.getByLabel("Rule 1 from arrival").fill("3");
  await screen.getByRole("button", "Add rule").tap();
  await screen.getByLabel("Rule 2 output name").fill("Stop");
  await screen.getByLabel("Rule 2 from arrival").fill("5");
  // Fit the new blocks beside the open panel so a drop target cannot scroll the canvas mid-drag.
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  const coder = screen.getByRole("article", "Block Coder");
  const review = screen.getByRole("article", "Block Review");
  const escalate = screen.getByRole("article", "Block Escalate");
  await screen.getByRole("button", "Connect exit Done of Coder").dragTo(escalate);
  await expect(screen.getByRole("button", "Connection Done from Coder to Escalate")).toBeVisible();
  await screen.getByRole("button", "Connect output Ask a person of Escalate").dragTo(review);
  await screen.getByRole("button", "Connect output Ask a person of Escalate").dragTo(coder);
  await screen.getByRole("button", "Connect output Otherwise of Escalate").dragTo(coder);
  await screen.getByRole("button", "Connect output Stop of Escalate").dragTo(coder);
  await screen.getByRole("button", "Save").tap();
  const saveStatus = screen.getByRole("status", "Flow save status");
  await expect(saveStatus).toContainText("Saved · Revision 2");
  await expectFlowBlocked(screen, /rule 2 "Stop" is never selected/);
  await app.screenshot("condition-authored-readiness-row");
  await screen.getByRole("button", "Condition Escalate").tap();
  await screen.getByRole("listitem", "Rule 2 Stop").getByRole("button", "Move rule up").tap();
  await screen.getByLabel("Rule 2 output name").fill("Ask a reviewer");
  await screen.getByRole("button", "Save").tap();
  await expect(saveStatus).toContainText("Saved · Revision 3");
  await expect(readinessSummary(screen, "Ready")).toBeVisible();
  await browser.reload();
  await screen.getByRole("button", "Condition Escalate").tap();
  await expect(screen.getByRole("button", "Targets of output Stop: Coder")).toBeVisible();
  await expect(
    screen.getByRole("button", "Targets of output Ask a reviewer: Coder, Review"),
  ).toBeVisible();
  await expect(
    screen
      .getByRole("group", "Output Otherwise")
      .getByRole("button", "Targets of output Otherwise: Coder"),
  ).toBeVisible();
  await app.screenshot("condition-authored-after-reload");
  const saved = await readFlow(app.baseUrl, flowId);
  const condition = saved.graph.blocks.find((block) => block.kind === "condition");
  assert(condition?.kind === "condition");
  const [stop, ask] = condition.rules;
  const humanStep = saved.graph.blocks.find((block) => block.kind === "human");
  assert(stop && ask && humanStep);
  expect(condition.rules).toMatchObject([
    { name: "Stop", fromArrival: 5 },
    { name: "Ask a reviewer", fromArrival: 3 },
  ]);
  expect(saved.graph.connections.filter((wire) => wire.sourceBlockId === condition.id)).toEqual([
    { sourceBlockId: condition.id, exitId: ask.id, targetBlockId: humanStep.id },
    { sourceBlockId: condition.id, exitId: ask.id, targetBlockId: "worker" },
    { sourceBlockId: condition.id, exitId: "otherwise", targetBlockId: "worker" },
    { sourceBlockId: condition.id, exitId: stop.id, targetBlockId: "worker" },
  ]);
  const { id: runId } = await fixture.scenarios.ensure({
    key: "condition-authored",
    flow: { id: flowId },
  });
  await fixture.scenarios.arriveAtCondition({ id: runId, through: 5 });
  await app.open(`/runs/${runId}`);
  await expect(screen.getByRole("article", "Block Escalate")).toContainText(
    "5 arrivals · latest → Stop",
  );

  // Act
  await screen.getByRole("button", /^Condition Escalate, /).tap();

  // Assert
  const details = screen.getByRole("region", "Condition arrivals");
  await expect(details).toContainText("Latest selection: arrival 5 → Stop");
  await expect(details.getByRole("listitem", "Arrival 1, Otherwise")).toContainText(
    "No rule matched · selected Otherwise",
  );
  await expect(details.getByRole("list", "Arrival 1 recipients")).toContainText("→ Coder");
  await expect(details.getByRole("listitem", "Arrival 3, Ask a reviewer")).toContainText(
    "Matched rule Ask a reviewer · selected Ask a reviewer",
  );
  const asked = details.getByRole("list", "Arrival 3 recipients");
  await expect(asked).toContainText("→ Review");
  await expect(asked).toContainText("→ Coder");
  await expect(asked).toContainText("Acknowledged");
  await expect(details.getByRole("list", "Arrival 5 recipients")).toContainText("→ Coder");
  const timeline = await openTimeline(app, screen, "condition-authored-run-arrivals");
  await expect(timeline).toContainText("arrival 1 → Otherwise");
  await expect(timeline).toContainText("arrival 3 → Ask a reviewer");
  await expect(timeline).toContainText("arrival 5 → Stop");
  await timeline.getByText("arrival 5 → Stop").scrollIntoView();
  await app.screenshot("condition-authored-run-timeline");
  const run = await readHistoryRun(app.baseUrl, runId);
  expect(run.conditions).toMatchObject([
    {
      blockId: condition.id,
      arrivals: 5,
      pending: 0,
      latest: { arrivalNumber: 5, outputId: stop.id },
    },
  ]);
});

test("a Condition near the definition size limit opens, scrolls to its last rule, saves a rename and reloads", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const flow = await saveConditionAtSizeLimit(
    app.baseUrl,
    "Condition at size limit",
    "Runtime worker",
    "done",
    "last",
  );
  const last = flow.rules.length;
  await app.open(`/studio/flows/${flow.id}`);
  await screen.getByRole("button", "Condition Escalate").tap();
  // Rows are rendered only near the visible part of the panel; scroll it to its end.
  await browser.evaluate(() => {
    const rules = document.querySelector('[aria-label="Rules"]');
    const panel = rules?.closest<HTMLElement>(".overflow-y-auto");
    panel?.scrollTo({ top: panel.scrollHeight });
    return null;
  });
  const lastName = screen.getByLabel(`Rule ${last} output name`);

  // Act
  await lastName.fill(`Route ${last} late`);
  await screen.getByRole("button", "Save").tap();

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 2");
  const saved = await readFlow(app.baseUrl, flow.id);
  const condition = saved.graph.blocks.find((block) => block.id === "escalate");
  assert(condition?.kind === "condition");
  expect(condition.rules).toHaveLength(last);
  expect(condition.rules.at(-1)).toMatchObject({ name: `Route ${last} late`, fromArrival: 2 });
  await browser.reload();
  await screen.getByRole("button", "Condition Escalate").tap();
  const escalate = screen.getByRole("article", "Block Escalate");
  await expect(escalate).toContainText(
    `by arrival · ${last.toLocaleString("en-US")} rules, then Otherwise`,
  );
  await expect(escalate).toContainText(`Route ${last} late`);
  await app.screenshot("condition-size-limit-after-reload");
});

test("a Run of a Condition at the definition size limit shows its first arrival's selection on the canvas and in the inspector", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const flow = await saveConditionAtSizeLimit(
    app.baseUrl,
    "Run a Condition at size limit",
    "Runtime worker",
    "done",
    "every",
  );
  const { id: runId } = await fixture.scenarios.ensure({
    key: "condition-size-limit",
    flow: { id: flow.id },
  });
  await fixture.scenarios.arriveAtCondition({ id: runId, through: 1 });
  await app.open(`/runs/${runId}`);
  await expect(screen.getByRole("article", "Block Escalate")).toContainText(
    "1 arrival · latest → Otherwise",
  );

  // Act
  await screen.getByRole("button", /^Condition Escalate, /).tap();

  // Assert
  const details = screen.getByRole("region", "Condition arrivals");
  await expect(details.getByRole("listitem", "Arrival 1, Otherwise")).toContainText(
    "No rule matched · selected Otherwise",
  );
  await expect(details.getByRole("list", "Arrival 1 recipients")).toContainText("→ Review");
  await app.screenshot("condition-size-limit-run");
  const run = await readHistoryRun(app.baseUrl, runId);
  const captured = run.definitions.flow.graph.blocks.find((block) => block.id === "escalate");
  assert(captured?.kind === "condition");
  expect(captured.rules).toHaveLength(flow.rules.length);
  expect(run.conditions).toMatchObject([
    { blockId: "escalate", arrivals: 1, latest: { arrivalNumber: 1, outputId: "otherwise" } },
  ]);
  // An Active Run of this size makes every later reconciliation in the shard read its revision.
  await archiveJourneyRun(app.baseUrl, runId);
});

test("a Condition's Run block reads Not visited before its first arrival and each rule output by its threshold", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await prepareScenarios(app);
  const unvisited = await findRun(
    app.baseUrl,
    "UI worker · Condition · First review before the rounds gate",
  );

  // Act
  await app.open(`/runs/${unvisited.id}`);

  // Assert
  const block = screen.getByRole("article", "Block Review rounds");
  await expect(block).toContainText("Not visited");
  await expect(block).toContainText("from arrival 3 onward");
  await expect(block).toContainText("when no rule matches");
  await screen.getByRole("button", /^Condition Review rounds, /).tap();
  await expect(screen.getByRole("region", "Condition arrivals")).toContainText(
    "Not visited · no arrival numbered yet.",
  );
  await app.screenshot("condition-run-unvisited");
});

test("selecting a routed Condition lists each arrival's route and recipient dispositions, with one Timeline row per arrival", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  await prepareScenarios(app);
  const found = await findRun(
    app.baseUrl,
    "UI worker · Condition · Second approval ended at the gate",
  );
  await app.open(`/runs/${found.id}`);
  const block = screen.getByRole("article", "Block First approval");
  await expect(block).toContainText("2 arrivals · latest → Later approvals");

  // Act
  await screen.getByRole("button", /^Condition First approval, /).tap();

  // Assert
  const details = screen.getByRole("region", "Condition arrivals");
  await expect(details).toContainText("Latest selection: arrival 2 → Later approvals");
  await expect(details).toContainText("not all downstream work");
  await expect(details.getByRole("listitem", "Arrival 1, Otherwise")).toContainText(
    "No rule matched · selected Otherwise",
  );
  const recipients = details.getByRole("list", "Arrival 1 recipients");
  await expect(recipients).toContainText("Your decision");
  await expect(recipients).toContainText("Acknowledged");
  await expect(details.getByRole("listitem", "Arrival 2, Later approvals")).toContainText(
    "Matched rule Later approvals · selected Later approvals",
  );
  await expect(details.getByRole("list", "Arrival 2 recipients")).toContainText(
    "Note the extra approval",
  );
  await expect(screen.getByRole("region", "Run attention")).toHaveCount(0);
  const timeline = await openTimeline(app, screen, "condition-run-arrivals");
  await expect(timeline).toContainText("arrival 1 → Otherwise");
  await expect(timeline).toContainText("arrival 2 → Later approvals");
  await timeline.getByText("arrival 2 → Later approvals").scrollIntoView();
  await app.screenshot("condition-run-timeline");
  const run = await readHistoryRun(app.baseUrl, found.id);
  expect(run.conditions).toMatchObject([
    {
      blockId: "first",
      arrivals: 2,
      pending: 0,
      latest: { arrivalNumber: 2, outputId: "later" },
    },
  ]);
});

test("a Condition's arrival list offers arrivals numbered while it is open for refresh, then loads the page after its first 50", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const flowId = await saveConditionFlow(
    app.baseUrl,
    "Count many review rounds",
    [
      { id: "stop", name: "Stop", fromArrival: 56 },
      { id: "again", name: "Keep going", fromArrival: 3 },
    ],
    [
      ["stop", "review"],
      ["again", "worker"],
      ["otherwise", "worker"],
    ],
  );
  const { id: runId } = await fixture.scenarios.ensure({
    key: "condition-pages",
    flow: { id: flowId },
  });
  await fixture.scenarios.arriveAtCondition({ id: runId, through: 50 });
  await app.open(`/runs/${runId}`);
  await screen.getByRole("button", /^Condition Escalate, /).tap();
  const details = screen.getByRole("region", "Condition arrivals");
  await expect(details.getByRole("listitem", "Arrival 50, Keep going")).toBeVisible();
  await expect(details.getByRole("button", "Load more")).toHaveCount(0);
  await fixture.scenarios.arriveAtCondition({ id: runId, through: 56 });
  await expect(details).toContainText("6 newer arrivals since this list was read");
  await expect(details.getByRole("listitem", "Arrival 51, Keep going")).toHaveCount(0);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await app.screenshot("condition-run-newer-arrivals");
  await details.getByRole("button", "Refresh").tap();
  await expect(details).toContainText("50 of 56 shown");
  await expect(details).not.toContainText("newer arrivals");

  // Act
  await details.getByRole("button", "Load more").tap();

  // Assert
  await expect(details.getByRole("listitem", "Arrival 51, Keep going")).toBeVisible();
  await expect(details.getByRole("listitem", "Arrival 56, Stop")).toBeVisible();
  await expect(details.getByRole("listitem", /^Arrival \d+, /)).toHaveCount(56);
  await expect(details.getByRole("button", "Load more")).toHaveCount(0);
  await details.getByRole("listitem", "Arrival 56, Stop").scrollIntoView();
  await app.screenshot("condition-run-arrivals-loaded-past-50");
});

test("the Timeline lists only a Condition's latest 50 arrivals and notes that the earlier ones are in its arrivals details", async ({
  app,
  screen,
  browser,
  fixture,
}) => {
  // Arrange
  await browser.setViewport({ width: 1600, height: 1000 });
  const flowId = await saveConditionFlow(
    app.baseUrl,
    "Count rounds past the Timeline window",
    [
      { id: "stop", name: "Stop", fromArrival: 60 },
      { id: "again", name: "Keep going", fromArrival: 3 },
    ],
    [
      ["stop", "review"],
      ["again", "worker"],
      ["otherwise", "worker"],
    ],
  );
  const { id: runId } = await fixture.scenarios.ensure({
    key: "condition-timeline-window",
    flow: { id: flowId },
  });
  await fixture.scenarios.arriveAtCondition({ id: runId, through: 52 });
  await app.open(`/runs/${runId}`);

  // Act
  const timeline = await openTimeline(app, screen, "condition-timeline-window-run");

  // Assert
  await expect(timeline).toContainText(
    "Escalate · Timeline lists its latest 50 arrivals · arrivals 1–2 are in its arrivals details",
  );
  await expect(timeline).toContainText("arrival 3 → Keep going");
  await expect(timeline).toContainText("arrival 52 → Keep going");
  await expect(timeline).not.toContainText("→ Otherwise");
  await app.screenshot("condition-timeline-window");
});
