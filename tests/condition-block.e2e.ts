import assert from "node:assert/strict";
import { test } from "./support/test.ts";
import { expect } from "e2e";
import {
  readFlow,
  saveConditionAtSizeLimit,
  saveFlowElsewhere,
  saveSingleAgentFlow,
} from "./support/flows.ts";
import { findRun, readHistoryRun } from "./support/run-history.ts";
import { prepareScenarios } from "./support/scenarios.ts";

/** Saves a Flow whose Coder `finish` exit reaches Condition Escalate with `rules`, wired as listed. */
async function saveConditionFlow(
  baseUrl: string | undefined,
  name: string,
  rules: readonly { id: string; name: string; fromArrival: number | null }[],
  wired: readonly string[],
) {
  const id = await saveSingleAgentFlow(baseUrl, name, "Sample worker", {
    id: "coder",
    name: "Coder",
    x: 320,
    y: 60,
  });
  const flow = await readFlow(baseUrl, id);
  await saveFlowElsewhere(baseUrl, flow, {
    graph: {
      ...flow.graph,
      blocks: [
        ...flow.graph.blocks,
        {
          id: "escalate",
          kind: "condition",
          name: "Escalate",
          position: { x: 680, y: 60 },
          rules,
          otherwise: { id: "otherwise" },
        },
        { id: "review", kind: "human", name: "Review", position: { x: 1040, y: 60 } },
      ],
      connections: [
        { sourceBlockId: "coder", exitId: "finish", targetBlockId: "escalate" },
        ...wired.map((exitId) => ({ sourceBlockId: "escalate", exitId, targetBlockId: "review" })),
      ],
    },
  });
  return id;
}

test("a Condition added from the library is ready with only Otherwise, and a rule's readiness issue focuses that rule", async ({
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
  await screen.getByRole("button", "Add Condition").tap();
  await screen.getByLabel("Block name").fill("Escalate");
  await screen.getByLabel("X position").fill("680");
  await screen.getByLabel("Y position").fill("60");
  await screen.getByRole("button", "Agent Coder").tap();
  await screen
    .getByRole("button", "Connect exit finish of Coder")
    .dragTo(screen.getByRole("article", "Block Escalate"));
  await screen.getByRole("button", "Save Flow").tap();
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 2");
  await expect(screen.getByText("Graph ready")).toBeVisible();
  await screen.getByRole("button", "Condition Escalate").tap();
  await screen.getByRole("button", "Add rule").tap();
  await screen.getByLabel("Rule 1 output name").fill("Human");
  await screen.getByLabel("Rule 1 from arrival").fill("3");
  await screen.getByRole("button", "Add rule").tap();
  await screen.getByLabel("Rule 2 output name").fill("End branch");
  await screen.getByLabel("Rule 2 from arrival").fill("5");
  await screen.getByRole("button", "Save Flow").tap();
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 3");
  await expect(screen.getByRole("article", "Block Escalate")).toContainText(
    /from arrival 5 onward\s*End branch/,
  );
  await screen.getByRole("button", "Close block configuration").tap();

  // Act
  await screen.getByRole("button", /rule 2 "End branch" is never selected/).tap();

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
    ["human", "end"],
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
  await screen.getByRole("button", "Save Flow").tap();

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 3");
  await browser.reload();
  await screen.getByRole("button", "Condition Escalate").tap();
  await expect(screen.getByRole("listitem", "Rule 1 End branch")).toContainText("→ Review");
  await expect(screen.getByText("Graph ready")).toBeVisible();
  const saved = await readFlow(app.baseUrl, flowId);
  const condition = saved.graph.blocks.find((block) => block.id === "escalate");
  assert(condition?.kind === "condition");
  expect(condition.rules).toEqual([{ id: "end", name: "End branch", fromArrival: 5 }]);
  expect(saved.graph.connections.filter((wire) => wire.sourceBlockId === "escalate")).toEqual([
    { sourceBlockId: "escalate", exitId: "end", targetBlockId: "review" },
  ]);
});

test("an arrival number that is not a whole number from 1 stays shown as invalid and cannot be saved", async ({
  app,
  screen,
  browser,
}) => {
  // Arrange
  await browser.setViewport({ width: 1920, height: 1000 });
  const flowId = await saveConditionFlow(
    app.baseUrl,
    "Invalid Condition threshold",
    [{ id: "human", name: "Human", fromArrival: 3 }],
    ["human"],
  );
  await app.open(`/studio/flows/${flowId}`);
  await screen.getByRole("button", "Condition Escalate").tap();
  await screen.getByLabel("Rule 1 output name").fill("Ask a person");
  await expect(screen.getByRole("button", "Save Flow")).toBeEnabled();

  // Act
  await screen.getByLabel("Rule 1 from arrival").fill("2.5");

  // Assert
  await expect(screen.getByLabel("Rule 1 from arrival")).toHaveValue("2.5");
  await expect(screen.getByRole("listitem", "Rule 1 Ask a person")).toContainText(
    "Use a whole number from 1 to 9,007,199,254,740,991.",
  );
  await expect(screen.getByRole("button", "Save Flow")).toBeDisabled();
  await expect(screen.getByRole("button", "Check readiness")).toBeDisabled();
  await screen.getByLabel("Rule 1 from arrival").fill("");
  await expect(screen.getByRole("button", "Save Flow")).toBeEnabled();
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
    "Sample worker",
    "finish",
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
  await screen.getByRole("button", "Save Flow").tap();

  // Assert
  await expect(screen.getByRole("status", "Flow save status")).toContainText("Saved · Revision 2");
  const saved = await readFlow(app.baseUrl, flow.id);
  const condition = saved.graph.blocks.find((block) => block.id === "escalate");
  assert(condition?.kind === "condition");
  expect(condition.rules).toHaveLength(last);
  expect(condition.rules.at(-1)).toMatchObject({ name: `Route ${last} late`, fromArrival: 2 });
  await browser.reload();
  await screen.getByRole("button", "Condition Escalate").tap();
  await expect(screen.getByRole("heading", /^Outputs · /)).toHaveText(
    `Outputs · ${last.toLocaleString("en-US")} rules, then Otherwise`,
  );
  await expect(screen.getByRole("article", "Block Escalate")).toContainText(`Route ${last} late`);
  await app.screenshot("condition-size-limit-after-reload");
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

test("selecting a routed Condition lists each arrival's route, recipient dispositions and the arrival that ended there, with one Timeline row per arrival", async ({
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
  await expect(recipients).toContainText("acknowledged");
  await expect(
    details.getByRole("listitem", "Arrival 2, Later approvals, ends here"),
  ).toContainText("Matched rule Later approvals · selected Later approvals");
  await expect(screen.getByRole("region", "Run attention")).toHaveCount(0);
  await screen.getByRole("button", "Fit Flow", { exact: true }).tap();
  await app.screenshot("condition-run-arrivals");
  await screen.getByRole("button", "Show timeline", { exact: true }).tap();
  const timeline = screen.getByRole("region", "Timeline");
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
