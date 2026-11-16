import { assert, expect, it } from "@effect/vitest";
import { prepared } from "./support/prepared-runner.ts";
import { conditionDraft, readFlowAfterRestart } from "./support/domain-setup.ts";
import {
  agentBlock,
  conditionBlock,
  conditionRule,
  connection,
  continuationStep,
  flowInput,
  humanStep,
  OTHERWISE,
} from "./support/scenarios.ts";

it("a Condition with descending rules between an Agent and a Human step saves ready, with its outputs wired, and reads back after restart", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock(
    "gate",
    "Escalate",
    [conditionRule("end", "  End branch ", 5), conditionRule("ask", "Ask a person", 3)],
    { x: 400, y: 0 },
  );
  const saved = await draft.save({
    blocks: [draft.coder, gate, draft.review],
    connections: [
      connection("coder", "done", "gate"),
      connection("gate", "ask", "human"),
      connection("gate", OTHERWISE, "coder"),
    ],
  });
  assert(saved.ok);
  await draft.factory.close();

  // Act
  const recovered = await readFlowAfterRestart(draft.harness, draft.flowId);

  // Assert
  expect(saved.value.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(saved.value.graph.blocks[1]).toStrictEqual({
    id: "gate",
    kind: "condition",
    name: "Escalate",
    rules: [
      { id: "end", name: "End branch", fromArrival: 5 },
      { id: "ask", name: "Ask a person", fromArrival: 3 },
    ],
    otherwise: { id: "otherwise" },
    position: { x: 400, y: 0 },
  });
  expect(recovered).toStrictEqual(saved);
});

it("a Condition with only Otherwise is a ready pass-through", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, conditionBlock("gate", "Pass on", []), draft.review],
    connections: [connection("coder", "done", "gate"), connection("gate", OTHERWISE, "human")],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness).toStrictEqual({ ready: true, issues: [] });
});

it("a Condition with more rules than an Agent may have exits saves ready, bounded only by the graph and body budgets", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const rules = Array.from({ length: 101 }, (_, i) =>
    conditionRule(`rule-${i}`, `Route ${i}`, 102 - i),
  );

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, conditionBlock("gate", "Many routes", rules)],
    connections: [connection("coder", "done", "gate")],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(saved.value.graph.blocks[1]).toMatchObject({ rules });
});

it("an unfinished Condition saves, and readiness names each rule row that blocks Start", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Escalate", [
    conditionRule("blank", " ", 4),
    conditionRule("missing", "No arrival yet", null),
    conditionRule("early", "Early", 3),
    conditionRule("late", "Late", 5),
    conditionRule("named", "Otherwise", 2),
    conditionRule("first", "Everything", 1),
  ]);

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, gate],
    connections: [connection("coder", "done", "gate")],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.graph.blocks[1]).toMatchObject({
    rules: [{ name: "" }, { fromArrival: null }, {}, {}, {}, {}],
  });
  expect(saved.value.readiness.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["condition_rule_name_required", "graph.blocks.1.rules.0.name"],
    ["condition_threshold_required", "graph.blocks.1.rules.1.fromArrival"],
    ["condition_rule_shadowed", "graph.blocks.1.rules.3.fromArrival"],
    ["condition_rule_name_duplicate", "graph.blocks.1.rules.4.name"],
    ["condition_threshold_first_arrival", "graph.blocks.1.rules.5.fromArrival"],
  ]);
});

it.for([
  ["text", "3"],
  ["fraction", 2.5],
  ["zero", 0],
  ["negative", -2],
  ["beyond the largest exact integer", 2 ** 53],
] as const)(
  "a Condition threshold that is %s is rejected without rounding and appends no revision",
  async ([, fromArrival], c) => {
    // Arrange
    const draft = await conditionDraft(c);
    const rule = { id: "ask", name: "Ask", fromArrival } as unknown as ReturnType<
      typeof conditionRule
    >;

    // Act
    const result = await draft.save({
      blocks: [draft.coder, conditionBlock("gate", "Escalate", [rule])],
      connections: [],
    });

    // Assert
    assert(!result.ok);
    expect(result.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
      ["invalid_condition_threshold", "graph.blocks.1.rules.0.fromArrival"],
    ]);
    const flow = await draft.factory.getFlow(draft.flowId);
    assert(flow.ok);
    expect(flow.value.revision).toBe(1);
  },
);

it("a Condition threshold of the largest exact integer saves unchanged", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Escalate", [
    conditionRule("ask", "Ask", Number.MAX_SAFE_INTEGER),
  ]);

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, gate],
    connections: [connection("coder", "done", "gate")],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness.ready).toBe(true);
  expect(saved.value.graph.blocks[1]).toMatchObject({
    rules: [{ fromArrival: 9_007_199_254_740_991 }],
  });
});

it("Condition rule IDs repeated or equal to the Otherwise output's ID are rejected", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Escalate", [
    conditionRule("ask", "Ask", 4),
    conditionRule("ask", "Ask again", 3),
    conditionRule(OTHERWISE, "Fallback", 2),
  ]);

  // Act
  const result = await draft.save({ blocks: [draft.coder, gate], connections: [] });

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["invalid_condition_rule_id", "graph.blocks.1.rules.1.id"],
    ["invalid_condition_rule_id", "graph.blocks.1.rules.2.id"],
  ]);
});

it("a Condition without its fixed Otherwise output is rejected", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const { otherwise: _otherwise, ...gate } = conditionBlock("gate", "Escalate", []);

  // Act
  const result = await draft.save({
    blocks: [draft.coder, gate as ReturnType<typeof conditionBlock>],
    connections: [],
  });

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["invalid_condition_otherwise", "graph.blocks.1.otherwise"],
  ]);
});

it("a wire from an output the Condition does not have is rejected", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Escalate", [conditionRule("ask", "Ask", 3)]);

  // Act
  const result = await draft.save({
    blocks: [draft.coder, gate, draft.review],
    connections: [connection("coder", "done", "gate"), connection("gate", "removed", "human")],
  });

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["invalid_connection", "graph.connections.1"],
  ]);
});

it("a Flow input connected to a Condition is rejected", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);

  // Act
  const result = await draft.save(
    { blocks: [draft.coder, conditionBlock("gate", "Escalate", [])], connections: [] },
    ["coder", "gate"],
  );

  // Assert
  assert(!result.ok);
  expect(result.error.issues.map((issue) => [issue.code, issue.path])).toStrictEqual([
    ["invalid_flow_input_target", "graph.flowInput.targetBlockIds.1"],
  ]);
});

it("a loop through only Conditions and a Continuation saves but cannot run, naming the loop", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Escalate", [conditionRule("ask", "Ask", 3)]);
  const nudge = continuationStep("nudge", "Nudge", "Try once more.");

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, gate, nudge, draft.review],
    connections: [
      connection("coder", "done", "gate"),
      connection("gate", "ask", "human"),
      connection("gate", OTHERWISE, "nudge"),
      connection("nudge", "output", "gate"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness.issues).toStrictEqual([
    {
      code: "condition_cycle",
      path: "graph.blocks.1",
      message:
        "Escalate loops back to itself through only Conditions and Continuations (Escalate → Nudge → Escalate). Route the loop through an Agent, Human step or Wait.",
    },
  ]);
});

it("a Condition looping back through an Agent stays ready", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Escalate", [conditionRule("ask", "Ask", 3)]);

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, gate, draft.review],
    connections: [
      connection("coder", "done", "gate"),
      connection("gate", "ask", "human"),
      connection("gate", OTHERWISE, "coder"),
      connection("human", "request-changes", "gate"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness).toStrictEqual({ ready: true, issues: [] });
});

it("Start refuses a saved Flow whose Condition loops back to itself and creates no Run", async (c) => {
  // Arrange
  const { f, flow, agent, input, project } = await prepared(c);
  const saved = await f.updateFlow(flow.id, {
    name: flow.name,
    expectedRevision: flow.revision,
    workspace: flow.workspace,
    graph: {
      flowInput: flowInput("worker"),
      blocks: [
        agentBlock("worker", "Entry worker", agent.id),
        conditionBlock("gate", "Escalate", []),
      ],
      connections: [connection("worker", "done", "gate"), connection("gate", OTHERWISE, "gate")],
    },
  });
  assert(saved.ok);

  // Act
  const started = await f.startRun(input);

  // Assert
  assert(!started.ok);
  expect(started.error.issues.map((issue) => issue.code)).toStrictEqual(["condition_cycle"]);
  expect(await f.listRuns(project.id)).toStrictEqual({ ok: true, value: [] });
});

it("a Flow save after Start leaves the Run on the Condition rules it captured", async (c) => {
  // Arrange
  const { f, flow, agent, input } = await prepared(c);
  const graph = (fromArrival: number) => ({
    flowInput: flowInput("worker"),
    blocks: [
      agentBlock("worker", "Entry worker", agent.id),
      conditionBlock("gate", "Escalate", [conditionRule("ask", "Ask", fromArrival)]),
      humanStep("review", "Review"),
    ],
    connections: [connection("worker", "done", "gate"), connection("gate", "ask", "review")],
  });
  const first = await f.updateFlow(flow.id, {
    name: flow.name,
    expectedRevision: flow.revision,
    workspace: flow.workspace,
    graph: graph(3),
  });
  assert(first.ok);
  const started = await f.startRun(input);
  assert(started.ok);

  // Act
  const saved = await f.updateFlow(flow.id, {
    name: flow.name,
    expectedRevision: first.value.revision,
    workspace: flow.workspace,
    graph: graph(4),
  });

  // Assert
  assert(saved.ok);
  const run = await f.getRun(started.value.id);
  assert(run.ok);
  expect(run.value.definitions.flow.graph.blocks[1]).toMatchObject({
    kind: "condition",
    rules: [{ id: "ask", fromArrival: 3 }],
  });
  expect(run.value.blocks.find((block) => block.blockId === "gate")).toMatchObject({
    state: "not-started",
    threadId: null,
  });
});
