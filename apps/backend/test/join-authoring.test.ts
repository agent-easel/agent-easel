import { assert, expect, it } from "@effect/vitest";
import { joinSlots } from "@agent-easel/domain-validation";
import { conditionDraft, readFlowAfterRestart } from "./support/domain-setup.ts";
import {
  agentBlock,
  conditionBlock,
  connection,
  continuationStep,
  flowInput,
  humanStep,
  joinBlock,
  JOIN_OUTPUT,
  OTHERWISE,
  waitBlock,
} from "./support/scenarios.ts";
import { composition, ending, savedFlow, subflowBlock, toEnding } from "./support/subflow.ts";

const merge = joinBlock("merge", "Merge reviews", { x: 600, y: 0 });

const issueRows = (issues: readonly { code: string; path: string }[]) =>
  issues.map((issue) => [issue.code, issue.path]);

it("a Join fed by an Agent and a Human step saves ready with one output and reads back after restart", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("human", "request-changes", "merge"),
      connection("merge", JOIN_OUTPUT, "coder"),
    ],
  });
  assert(saved.ok);
  await draft.factory.close();

  // Act
  const recovered = await readFlowAfterRestart(draft.harness, draft.flowId);

  // Assert
  expect(saved.value.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(saved.value.graph.blocks[2]).toStrictEqual({
    id: "merge",
    kind: "join",
    name: "Merge reviews",
    position: { x: 600, y: 0 },
  });
  expect(recovered).toStrictEqual(saved);
});

it("a Join with one source block is not ready, even when two of that block's exits are wired into it", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge],
    connections: [
      connection("coder", "done", "human"),
      connection("human", "approve", "merge"),
      connection("human", "request-changes", "merge"),
      connection("merge", JOIN_OUTPUT, "coder"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(issueRows(saved.value.readiness.issues)).toStrictEqual([
    ["join_sources_required", "graph.blocks.2"],
  ]);
});

it("a Join with no wire from its output is not ready", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(issueRows(saved.value.readiness.issues)).toStrictEqual([
    ["join_output_unconnected", "graph.blocks.2"],
  ]);
});

it("a Join wired back into itself is a loop with no worker in it", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "merge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness.issues).toStrictEqual([
    {
      code: "join_cycle",
      path: "graph.blocks.2",
      message:
        "Merge reviews loops back to itself through only Joins, Conditions and Continuations (Merge reviews → Merge reviews). Route the loop through an Agent, Human step or Wait.",
    },
  ]);
});

it("a loop between a Join and a Condition is reported at the Join, not as a Condition loop", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Gate", [], { x: 800, y: 0 });

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge, gate],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "gate"),
      connection("gate", OTHERWISE, "merge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(issueRows(saved.value.readiness.issues)).toStrictEqual([["join_cycle", "graph.blocks.2"]]);
});

it("a Join loop that passes through an Agent stays ready", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const fixer = agentBlock("fixer", "Fixer", draft.agent.id, { x: 800, y: 0 });

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge, fixer],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "fixer"),
      connection("fixer", "done", "merge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness).toStrictEqual({ ready: true, issues: [] });
});

it("a save that connects the Flow input to a Join is refused", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);

  // Act
  const saved = await draft.save(
    {
      blocks: [draft.coder, draft.review, merge],
      connections: [connection("coder", "done", "merge")],
    },
    ["coder", "merge"],
  );

  // Assert
  assert(!saved.ok);
  expect(saved.error.issues).toStrictEqual([
    {
      code: "flow_input_join",
      path: "graph.flowInput.targetBlockIds.1",
      message:
        "The Flow input cannot connect to a Join: a Join has no worker and nothing to wait for before any work happens.",
    },
  ]);
});

it("a Join wired from a source that is wired more than once keeps one slot per source block, in block order", () => {
  // Arrange
  const graph = {
    blocks: [humanStep("review", "Review"), joinBlock("merge", "Merge"), humanStep("late", "Late")],
    connections: [
      connection("late", "approve", "merge"),
      connection("review", "request-changes", "merge"),
      connection("review", "approve", "merge"),
      connection("review", "approve", "merge"),
    ],
  };

  // Act
  const slots = joinSlots(graph, "merge");

  // Assert
  expect(slots).toStrictEqual([
    { sourceBlockId: "review", label: "Review", exitIds: ["request-changes", "approve"] },
    { sourceBlockId: "late", label: "Late", exitIds: ["approve"] },
  ]);
});

it("a Continuation wired straight from a Join is not ready, as a Join output has no worker thread", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const nudge = continuationStep("nudge", "Nudge", "Try once more.", { x: 800, y: 0 });

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge, nudge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "nudge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(issueRows(saved.value.readiness.issues)).toStrictEqual([
    ["continuation_worker_required", "graph.blocks.3"],
  ]);
});

it("a Continuation behind a Join and an Agent is ready, because the Agent's result is bound to its thread", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const fixer = agentBlock("fixer", "Fixer", draft.agent.id, { x: 800, y: 0 });
  const nudge = continuationStep("nudge", "Nudge", "Try once more.", { x: 1000, y: 0 });

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge, fixer, nudge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "fixer"),
      connection("fixer", "done", "nudge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(saved.value.readiness).toStrictEqual({ ready: true, issues: [] });
});

it("a Condition between a Join and a Continuation passes the missing worker thread on", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const gate = conditionBlock("gate", "Gate", [], { x: 800, y: 0 });
  const nudge = continuationStep("nudge", "Nudge", "Try once more.", { x: 1000, y: 0 });

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge, gate, nudge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "gate"),
      connection("gate", OTHERWISE, "nudge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(issueRows(saved.value.readiness.issues)).toStrictEqual([
    ["continuation_worker_required", "graph.blocks.4"],
  ]);
});

it("a Wait between a Join and a Continuation passes the missing worker thread on", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const pause = waitBlock("pause", "Pause", { amount: 5, unit: "minutes" }, { x: 800, y: 0 });
  const nudge = continuationStep("nudge", "Nudge", "Try once more.", { x: 1000, y: 0 });

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge, pause, nudge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "pause"),
      connection("pause", "output", "nudge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(issueRows(saved.value.readiness.issues)).toStrictEqual([
    ["continuation_worker_required", "graph.blocks.4"],
  ]);
});

it("a Human step between a Join and a Continuation passes the missing worker thread on", async (c) => {
  // Arrange
  const draft = await conditionDraft(c);
  const decide = humanStep("decide", "Decide", { x: 800, y: 0 });
  const nudge = continuationStep("nudge", "Nudge", "Try once more.", { x: 1000, y: 0 });

  // Act
  const saved = await draft.save({
    blocks: [draft.coder, draft.review, merge, decide, nudge],
    connections: [
      connection("coder", "done", "human"),
      connection("coder", "done", "merge"),
      connection("human", "approve", "merge"),
      connection("merge", JOIN_OUTPUT, "decide"),
      connection("decide", "approve", "nudge"),
    ],
  });

  // Assert
  assert(saved.ok);
  expect(issueRows(saved.value.readiness.issues)).toStrictEqual([
    ["continuation_worker_required", "graph.blocks.4"],
  ]);
});

it("through a Subflow each child ending is followed separately: only the ending a Join reaches leaves a Continuation without a worker thread", async (c) => {
  // Arrange
  const { factory, coder, reviewer, endingFlow } = await composition(c);
  const child = await endingFlow("Review panel with Join", null, {
    flowInput: flowInput("security", "style"),
    blocks: [
      agentBlock("security", "Security reviewer", reviewer.id, { x: 200, y: 0 }),
      agentBlock("style", "Style reviewer", reviewer.id, { x: 200, y: 200 }),
      joinBlock("panel", "Panel", { x: 400, y: 100 }),
    ],
    connections: [
      connection("security", "done", "panel"),
      connection("style", "done", "panel"),
      toEnding("security", "done", "single"),
      toEnding("panel", JOIN_OUTPUT, "merged"),
    ],
    finish: {
      position: { x: 700, y: 0 },
      endings: [ending("single", "Single"), ending("merged", "Merged")],
    },
  });

  // Act
  const parent = await savedFlow(factory, {
    name: "Parent",
    graph: {
      flowInput: flowInput("lead"),
      blocks: [
        agentBlock("lead", "Lead", coder.id),
        subflowBlock("review", "Review", child.id, { x: 300, y: 0 }),
        continuationStep("after-single", "After single", "Summarize.", { x: 600, y: 0 }),
        continuationStep("after-merged", "After merged", "Summarize.", { x: 600, y: 200 }),
      ],
      connections: [
        connection("lead", "done", "review"),
        connection("review", "single", "after-single"),
        connection("review", "merged", "after-merged"),
      ],
    },
  });

  // Assert
  expect(child.readiness).toStrictEqual({ ready: true, issues: [] });
  expect(issueRows(parent.readiness.issues)).toStrictEqual([
    ["continuation_worker_required", "graph.blocks.3"],
  ]);
});
