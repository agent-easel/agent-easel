import { expect, it } from "vite-plus/test";
import type { ConditionSummary, RunDetail, RunHeader } from "@t3-factory/contracts";
import { runScope } from "../src/live/run.ts";
import { block, event, runDetail } from "./support/run.ts";

/** The header a committed change carries for `run`. */
const headerOf = (run: RunDetail): RunHeader => ({
  id: run.id,
  origin: run.origin,
  number: run.number,
  title: run.title,
  titleProvenance: run.titleProvenance,
  titleGeneration: run.titleGeneration,
  lifecycle: run.lifecycle,
  task: run.task,
  flowId: run.flowId,
  flowName: run.flowName,
  currentFlowRevision: run.currentFlowRevision,
  repositories: run.repositories,
  startedAt: run.startedAt,
  input: run.input,
  segments: run.segments,
  images: run.images,
  workspace: run.workspace,
  coordinationActions: run.coordinationActions,
  runCoordinator: run.runCoordinator,
  gateOpen: run.gateOpen,
  settlement: run.settlement,
  result: run.result,
});

it("a committed Run update preserves entity order and untouched identities without duplicating history", () => {
  // Arrange
  const run = runDetail();
  const replacement = { ...block("worker"), workingMessage: "Updated" };
  const appended = block("new");
  const header: RunHeader = {
    ...headerOf(run),
    title: "Renamed",
    titleProvenance: "manual",
    titleGeneration: null,
    lifecycle: "settled",
  };

  // Act
  const next = runScope(run.id).apply(run, {
    _tag: "changed",
    header,
    entities: { blocks: { upserts: [appended, replacement], removals: ["removed"] } },
    events: [event(2), event(3), event(3), event(4)],
  });

  // Assert
  expect(next.title).toBe("Renamed");
  expect(next.lifecycle).toBe("settled");
  expect(next.blocks).toStrictEqual([replacement, run.blocks[1], appended]);
  expect(next.blocks[0]).toBe(replacement);
  expect(next.blocks[1]).toBe(run.blocks[1]);
  expect(next.executions).toBe(run.executions);
  expect(next.definitions).toBe(run.definitions);
  expect(next.events.map((entry) => entry.sequence)).toStrictEqual([1, 2, 3, 4]);
  expect(next.events[0]).toBe(run.events[0]);
  expect(run.blocks).toHaveLength(3);
  expect(run.events).toHaveLength(2);
});

it("observation metadata updates only matching Blocks, bindings and the historical Run coordinator", () => {
  // Arrange
  const run = runDetail();
  const coordinator: NonNullable<typeof run.runCoordinator> = {
    freshness: "fresh",
    observedAt: "earlier",
    pendingRequestCount: 0,
    queuedCount: 0,
    pendingOperationCount: 0,
    pendingStopCount: 0,
    selection: {
      environmentId: "env",
      providerInstanceId: "codex",
      modelId: "model",
      modelOptions: [],
    },
    state: "acknowledged",
    threadId: null,
    executionId: null,
    link: null,
    engineStatus: null,
    problem: null,
  };
  const otherTurn = { ...run.executions[0]!, executionId: "other-turn" };
  const before = {
    ...run,
    executions: [...run.executions, otherTurn],
    runCoordinator: coordinator,
  };

  // Act
  const next = runScope(run.id).apply(before, {
    _tag: "observed",
    blocks: [{ blockId: "worker", observedAt: "later" }],
    executions: [{ bindingId: "binding", executionId: "execution", observedAt: "later" }],
    runCoordinatorObservedAt: null,
  });

  // Assert
  expect(next.blocks[0]).toStrictEqual({ ...run.blocks[0], observedAt: "later" });
  expect(next.blocks[1]).toBe(run.blocks[1]);
  expect(next.executions[0]).toStrictEqual({ ...run.executions[0], observedAt: "later" });
  expect(next.executions[1]).toBe(run.executions[1]);
  expect(next.executions[2]).toBe(otherTurn);
  expect(next.runCoordinator).toStrictEqual({ ...coordinator, observedAt: null });
  expect(next.events).toBe(run.events);
  expect(next.reports).toBe(run.reports);
  expect(before.runCoordinator.observedAt).toBe("earlier");
});

const selection = (arrivalNumber: number): RunDetail["events"][number] => ({
  ...event(100 + arrivalNumber),
  kind: "condition-selected",
  blockId: "gate",
  condition: { arrivalNumber, outputId: "otherwise" },
});
const summary = (arrivals: number): ConditionSummary => ({
  blockId: "gate",
  arrivals,
  pending: 0,
  latest: { arrivalNumber: arrivals, outputId: "otherwise", acceptedAt: "2026-11-08T00:00:00Z" },
});
const arrivalRange = (from: number, through: number) =>
  Array.from({ length: through - from + 1 }, (_, offset) => from + offset);

it("a held Run whose Condition advances past its Timeline window keeps the window a fresh read lists", () => {
  // Arrange
  const run: RunDetail = {
    ...runDetail(),
    events: [event(1), ...arrivalRange(3, 52).map(selection)],
    conditions: [summary(52)],
  };

  // Act
  const next = runScope(run.id).apply(run, {
    _tag: "changed",
    header: headerOf(run),
    entities: { conditions: { upserts: [summary(103)], removals: [] } },
    events: arrivalRange(54, 103).map(selection),
  });

  // Assert
  expect(
    next.events.map((entry) => entry.condition?.arrivalNumber ?? entry.sequence),
  ).toStrictEqual([1, ...arrivalRange(54, 103)]);
});

const roundOutcome = (round: number): RunDetail["events"][number] => ({
  ...event(200 + round),
  kind: "join-round-forwarded",
  blockId: "merge",
  join: { round },
});

it("a held Run whose Join forwards more rounds keeps each Join's latest rounds a fresh read lists", () => {
  // Arrange
  const run: RunDetail = {
    ...runDetail(),
    events: [event(1), ...arrivalRange(1, 50).map(roundOutcome)],
  };

  // Act
  const next = runScope(run.id).apply(run, {
    _tag: "changed",
    header: headerOf(run),
    entities: {},
    events: arrivalRange(51, 53).map(roundOutcome),
  });

  // Assert
  expect(next.events.map((entry) => entry.join?.round ?? entry.sequence)).toStrictEqual([
    1,
    ...arrivalRange(4, 53),
  ]);
});
