import type { ControlledT3Threads } from "./support/controlled-t3-threads.ts";
import { assert, expect, it } from "@effect/vitest";
import {
  changeAuthorizationAfterNextRead,
  failInspectionAfterNextRead,
  failNextInspection,
  nextSettlement,
  pauseWorkerReads,
  reopenDuringSettlement,
  settleDuringNextLaunch,
} from "./support/run-worker.ts";
import {
  allTurnsEnd,
  archived,
  continuationFlow,
  fanOutFlow,
  finishedReport,
  handoffFlow,
  humanReviewFlow,
  missingReport,
  report,
  resultHeld,
  resultReleasedToHumanReview,
  resultReleasedToSameWorker,
  resultReleasedToSecondWorker,
  resultReplacedBeforeRelease,
  resultReported,
  sentTurnBegins,
  settled,
  settleUnresolved,
  snoozed,
  turnBegins,
  twoWorkersStarted,
  workerAtWork,
  workerFinal,
  workerWorking,
  workingReport,
} from "./support/scenarios.ts";
import { prepared } from "./support/prepared-runner.ts";
import { promptSent, responseForwarded } from "./support/continuation.ts";

it("a finished terminal Block settles its worker thread in T3 Code without waiting for Run settlement", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
});

it("a replaced finished report in the same T3 Code run is not settled again", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const replaced = await resultReplacedBeforeRelease(setup.world, atWork);
  await resultReleasedToSecondWorker(setup.world, replaced);
  const f = { ...setup, ...replaced, worker: replaced };

  assert((await report(f.world, f.worker, finishedReport("Another pass."))) === "ACCEPTED");
  allTurnsEnd(f.world, f.worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
});

it("a revisited Block settles its thread again after a new T3 Code run finishes", async (c) => {
  // Arrange
  const setup = await prepared(c, { revisit: true });
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const released = await resultReleasedToSameWorker(setup.world, reported);
  const worker = sentTurnBegins(setup.world, released);
  const f = { ...setup, ...worker };
  await f.f.reconcileRuns();
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
  assert((await report(f.world, worker, finishedReport("Second pass."))) === "ACCEPTED");
  // The report's background dispatch shares the Run's drive lane: this pass waits for it, while
  // the second turn still runs, so it cannot release the result after the turn ends below.
  assert((await f.f.reconcileRuns()).ok);
  const runBeforeFinish = await f.f.getRun(f.runId);
  assert(runBeforeFinish.ok);
  const producingExecution = runBeforeFinish.value.reports.at(-1)?.executionId;
  assert(producingExecution);
  expect(producingExecution).toBe(worker.executionId);
  allTurnsEnd(f.world, worker);
  f.t3.threads.answerDelegatedWait("thread-1", worker.executionId, "settled", "completed");

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements.map((entry) => entry.threadId)).toStrictEqual([
    "thread-1",
    "thread-1",
  ]);
});

it("a worker thread settles again once its Continuation's response moves the Run on", async (c) => {
  // Arrange
  const setup = await prepared(c, continuationFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  await resultReported(setup.world, worker);
  const prompt = await promptSent(setup.world, worker);
  await responseForwarded(setup.world, worker, prompt);

  // Act
  await setup.f.reconcileRuns();

  // Assert
  expect(setup.t3.threads.settlements).toStrictEqual([
    { threadId: "thread-1" },
    { threadId: "thread-1" },
  ]);
});

it("a finished Block on a snoozed Run still settles its worker thread", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await snoozed(setup.world, reported)) };

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
});

it("an open missing-report Problem leaves the worker thread unsettled", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await missingReport(setup.world, atWork)) };

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("a Block whose latest report is working leaves its worker thread unsettled", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...worker };
  assert((await report(f.world, worker, workingReport())) === "ACCEPTED");
  allTurnsEnd(f.world, worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("Run settlement does not request a thread the per-Block pass already settled", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };

  assert((await f.f.reconcileRuns()).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
});

it("an archived Run receives no per-Block thread settlement", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await archived(setup.world, reported)) };
  f.t3.threads.settlements.length = 0;

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("per-Block settlement is a no-op when T3 Code lacks native settle support", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };
  f.t3.contract.support.settle = false;

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("a failed per-Block T3 Code thread settlement leaves the Run unchanged", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };
  f.t3.threads.settleThread = () => Promise.reject(Error("T3 Code could not settle the thread"));

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("active");
});

it("a finished handoff Block settles its worker thread in T3 Code while the Run stays Active", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("active");
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
});

it("a Run settles automatically once its reported worker's thread is finished", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.events.at(-1)).toMatchObject({ kind: "run-settled", causeId: "automatic" });
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
  const navigation = await f.f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value.map((entry) => entry.lifecycle)).toStrictEqual(["settled"]);
});

it("an automatically settled Run's navigation row carries its Settled cycle and the reason automatic without an ending", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };
  await f.f.reconcileRuns();
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  const settledEvent = run.value.events.findLast((event) => event.kind === "run-settled");

  // Act
  const navigation = await f.f.listRunNavigation();

  // Assert
  assert(navigation.ok);
  expect(navigation.value[0]).toMatchObject({
    settledCycle: settledEvent?.sequence,
    settledReason: "automatic",
    endingName: null,
  });
});

it("a manually settled Run's navigation row carries its Settled cycle and the reason manual without an ending", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };
  const result = await f.f.settleRun(f.runId, {});
  assert(result.ok);
  const settledEvent = result.value.run.events.findLast((event) => event.kind === "run-settled");

  // Act
  const navigation = await f.f.listRunNavigation();

  // Assert
  assert(navigation.ok);
  expect(navigation.value[0]).toMatchObject({
    settledCycle: settledEvent?.sequence,
    settledReason: "manual",
    endingName: null,
  });
});

it("a Run that returned to Active and settled again exposes a new Settled cycle", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await settled(setup.world, reported)) };
  const first = await f.f.listRunNavigation();
  assert(first.ok);
  expect((await f.f.runtime.submit(workerFinal(f.blockId))).code).toBe("ACCEPTED");

  // Act
  await f.f.reconcileRuns();

  // Assert
  const second = await f.f.listRunNavigation();
  assert(second.ok);
  expect(second.value[0]?.lifecycle).toBe("settled");
  expect(second.value[0]?.settledCycle).toBeGreaterThan(first.value[0]?.settledCycle ?? 0);
});

it("a Run stays Active while T3 Code has not answered that its worker's delegated work settled", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };
  f.t3.threads.delegatedSettlements.delete(JSON.stringify(["thread-1", "execution-1"]));

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("active");
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("a failed T3 Code thread settlement leaves the Run Settled", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };
  f.t3.threads.settleThread = () => Promise.reject(Error("T3 Code could not settle the thread"));

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.attention.filter((a) => !a.settledAt)).toStrictEqual([]);
  expect(run.value.events.at(-1)?.kind).toBe("run-settled");
});

it("settling a Run whose worker is still running asks for confirmation and changes nothing", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  const before = await f.f.getRun(f.runId);
  assert(before.ok);

  // Act
  const result = await f.f.settleRun(f.runId, {});

  // Assert
  assert(result.ok);
  assert(result.value.outcome === "confirmation-required");
  expect(result.value.workers).toMatchObject([
    {
      blockId: "worker",
      threadId: "thread-1",
      state: "executing",
      problem: "T3 Code shows a run in progress.",
    },
  ]);
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "active",
    gateOpen: true,
    settlement: null,
    generation: before.value.generation,
  });
  expect(run.value.events).toStrictEqual(before.value.events);
  expect(f.t3.threads.threadStops).toStrictEqual([]);
});

it("a worker T3 Code cannot show is unresolved, not running, when Settle asks for confirmation", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  pauseWorkerReads(f.t3, f.threadId);

  // Act
  const result = await f.f.settleRun(f.runId, {});

  // Assert
  assert(result.ok);
  assert(result.value.outcome === "confirmation-required");
  expect(result.value.workers).toMatchObject([
    {
      blockId: "worker",
      state: "unresolved",
      problem: "T3 Code could not show this worker thread in the Run's project and workspace.",
    },
  ]);
});

it.for([
  ["an array", [{ stopWorkers: true }]],
  ["a misspelled authorization flag", { stop_workers: true }],
] as const)("Settle sent %s is a validation error and changes nothing", async ([, input], c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  const before = await f.f.getRun(f.runId);
  assert(before.ok);

  // Act
  const result = await f.f.settleRun(f.runId, input);

  // Assert
  expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.events).toStrictEqual(before.value.events);
});

it("settling a Run whose worker finished cancels its held handoff without stopping anything", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork)) };

  // Act
  const result = await f.f.settleRun(f.runId, {});

  // Assert
  assert(result.ok);
  expect(result.value.outcome).toBe("settled");
  expect(result.value.run).toMatchObject({
    lifecycle: "settled",
    gateOpen: false,
    settlement: null,
  });
  expect(result.value.run.intents.filter((intent) => intent.kind === "handoff")).toMatchObject([
    { blockId: "parallel-block", state: "cancelled", problem: "cancelled-on-Settle" },
  ]);
  expect(result.value.run.blocks.map((block) => block.state)).toStrictEqual([
    "finished",
    "not-started",
  ]);
  expect(result.value.run.reports.map((report) => report.completionEligibleAt)).toStrictEqual([
    expect.any(String),
  ]);
  expect(result.value.run.events.at(-1)).toMatchObject({ kind: "run-settled", causeId: "manual" });
  expect(f.t3.threads.threadStops).toStrictEqual([]);
});

it("settling a Run with a pending Human review cancels it without an answer and settles its attention", async (c) => {
  // Arrange
  const setup = await prepared(c, humanReviewFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await resultReleasedToHumanReview(setup.world, reported)) };

  // Act
  const result = await f.f.settleRun(f.runId, {});

  // Assert
  assert(result.ok);
  expect(result.value.run.lifecycle).toBe("settled");
  expect(result.value.run.humanOccurrences).toMatchObject([
    { id: f.occurrence.id, state: "cancelled", exitId: null },
  ]);
  expect(result.value.run.attention).toMatchObject([
    { kind: "human", settlementReason: "manual-settlement" },
  ]);
});

it("an unresolved manual settlement refuses Human answers without asking for input or cancelling the occurrence", async (c) => {
  // Arrange
  const setup = await prepared(c, humanReviewFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await resultReleasedToHumanReview(setup.world, reported)) };
  turnBegins(f.world, f, "review-follow-up");
  f.t3.contract.support.stop = false;
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  assert((await f.f.reconcileRuns()).ok);

  // Act
  const result = await f.f.answerHumanOccurrence(f.occurrence.id, { exitId: "approve" });

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "conflict",
    message: "AgentEasel is settling this Run and stopping its workers, so it accepts no answers.",
  });
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "active",
    gateOpen: false,
    settlement: { state: "unresolved" },
    humanOccurrences: [{ id: f.occurrence.id, state: "pending", exitId: null }],
  });
  const navigation = await f.f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]).toMatchObject({
    settlement: "unresolved",
    attention: { needsInput: false },
  });
});

it("confirming Settle stops every worker and records manual settlement once fresh reads show them finished", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const [first, second] = await twoWorkersStarted(setup.world, setup.input);
  const f = { ...setup, runId: first.runId };
  f.t3.threads.stopsEndThreads();
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({ lifecycle: "settled", gateOpen: false, settlement: null });
  expect(f.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([
    first.threadId,
    second.threadId,
  ]);
  expect(run.value.blocks.map((block) => block.state)).toStrictEqual([
    "stopped",
    "stopped",
    "not-started",
  ]);
  expect(
    run.value.events
      .filter((event) => event.kind.includes("settle") || event.kind.includes("stop"))
      .map((event) => [event.kind, event.blockId]),
  ).toStrictEqual([
    ["settlement-requested", null],
    ["worker-stop-requested", "worker"],
    ["worker-stop-requested", "second"],
    ["worker-stopped", "worker"],
    ["worker-stopped", "second"],
    ["run-settled", null],
  ]);
  expect(run.value.events.find((event) => event.kind === "run-settled")?.causeId).toBe("manual");
  expect(run.value.attention).toStrictEqual([]);
});

it("a Run confirmed Settle settled records how T3 Code showed its stopped work end", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  f.t3.threads.stopsEndThreads();
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.executions).toStrictEqual([
    expect.objectContaining({
      executionId: f.executionId,
      engineStatus: "interrupted",
      problem: null,
      observedEndedAt: expect.any(String),
    }),
  ]);
  expect(run.value.attention).toStrictEqual([]);
});

it("a Run confirmed Settle settled records its stopped run's end though a newer run became the latest", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  assert((await setup.f.settleRun(worker.runId, { stopWorkers: true })).ok);
  assert((await setup.f.reconcileRuns()).ok);
  setup.t3.threads.endThreadRun(worker.threadId, worker.executionId, "interrupted");
  setup.t3.threads.beginThreadRun(worker.threadId, "user-run");
  setup.t3.threads.endThreadRun(worker.threadId, "user-run", "completed");

  // Act
  await setup.f.reconcileRuns();

  // Assert
  const run = await setup.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.executions).toStrictEqual([
    expect.objectContaining({
      executionId: worker.executionId,
      engineStatus: "interrupted",
      observedEndedAt: expect.any(String),
    }),
    expect.objectContaining({
      executionId: "user-run",
      engineStatus: "completed",
      observedEndedAt: expect.any(String),
    }),
  ]);
});

it("a Run confirmed Settle settled records the end of a Continuation's stopped prompt run on the Continuation", async (c) => {
  // Arrange
  const setup = await prepared(c, continuationFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  await resultReported(setup.world, worker);
  await promptSent(setup.world, worker);
  const prompt = sentTurnBegins(setup.world, worker);
  assert((await setup.f.reconcileRuns()).ok);
  setup.t3.threads.stopsEndThreads();
  assert((await setup.f.settleRun(worker.runId, { stopWorkers: true })).ok);

  // Act
  await setup.f.reconcileRuns();

  // Assert
  const run = await setup.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(
    run.value.executions.find((execution) => execution.executionId === prompt.executionId),
  ).toMatchObject({
    blockId: "spec",
    engineStatus: "interrupted",
    problem: null,
    observedEndedAt: expect.any(String),
  });
});

it("Settle keeps the execution-failed Problem of a worker run that failed before it", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  allTurnsEnd(f.world, f, "failed");
  assert((await f.f.reconcileRuns()).ok);

  // Act
  const result = await f.f.settleRun(f.runId, {});

  // Assert
  assert(result.ok);
  expect(result.value.run.lifecycle).toBe("settled");
  expect(result.value.run.executions).toStrictEqual([
    expect.objectContaining({
      executionId: f.executionId,
      engineStatus: "failed",
      problem: "execution-failed",
    }),
  ]);
});

it("a manually settled Run leaves a send with a lost T3 Code reply uncertain and drops its payload", async (c) => {
  // Arrange
  const setup = await prepared(c, { revisit: true });
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  setup.t3.threads.loseSendReply = true;
  const f = { ...setup, ...(await resultReleasedToSameWorker(setup.world, reported)) };
  const before = await f.f.getRun(f.runId);
  assert(before.ok);
  expect(before.value.intents.filter((intent) => intent.kind === "send")).toMatchObject([
    { state: "uncertain", payloadRetained: true },
  ]);
  f.t3.threads.stopsEndThreads();
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.intents.filter((intent) => intent.kind === "send")).toMatchObject([
    {
      state: "uncertain",
      payloadRetained: false,
      problem:
        "The Run was settled before AgentEasel confirmed whether T3 Code received this message; AgentEasel will not resend it.",
    },
  ]);
  expect(f.t3.threads.sends.size).toBe(1);
});

it("an acknowledged Stop does not settle the Run while T3 Code still shows the worker running", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "active",
    gateOpen: false,
    settlement: {
      state: "stopping",
      attempt: 1,
      workers: [
        { blockId: "worker", state: "stopping", problem: "T3 Code shows a run in progress." },
      ],
    },
    attention: [],
  });
  expect(f.t3.threads.threadStops).toHaveLength(1);
});

it("a Stop T3 Code does not support leaves the settlement unresolved and holds the Run's other work", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const [first] = await twoWorkersStarted(setup.world, setup.input);
  const f = { ...setup, runId: first.runId };
  await resultReported(f.world, first);
  f.t3.contract.support.stop = false;
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("active");
  expect(run.value.settlement).toMatchObject({
    state: "unresolved",
    workers: [
      { blockId: "worker", state: "finished", problem: null },
      {
        blockId: "second",
        state: "unresolved",
        problem: "T3 Code cannot stop worker threads: Controlled Stop support",
      },
    ],
  });
  expect(run.value.intents.filter((intent) => intent.kind === "handoff")).toMatchObject([
    { blockId: "follow-up", state: "pending" },
  ]);
  expect(f.t3.threads.launches.size).toBe(2);
  expect(f.t3.threads.threadStops).toStrictEqual([]);
});

it("retrying an unresolved settlement requests Stop again and settles the Run", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  f.t3.threads.stopsEndThreads();
  f.t3.contract.support.stop = false;
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  await f.f.reconcileRuns();
  f.t3.contract.support.stop = true;
  const settlement = nextSettlement(f.t3);

  // Act
  const result = await f.f.settleRun(f.runId, { stopWorkers: true });

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({ outcome: "stopping", run: { settlement: { attempt: 2 } } });
  await settlement;
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.attention).toMatchObject([
    {
      kind: "settlement-unresolved",
      settledAt: expect.any(String),
      settlementReason: "manual-settlement",
    },
  ]);
  expect(f.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual(["thread-1"]);
});

it("a confirmed Settle that cannot stop its worker raises one Run-level Settle could not stop workers Problem", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  f.t3.contract.support.stop = false;
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.attention).toMatchObject([
    { kind: "settlement-unresolved", blockId: null, blockName: null, settledAt: null },
  ]);
  const navigation = await f.f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]?.attention).toStrictEqual({
    needsInput: false,
    problem: true,
    matters: [
      {
        id: run.value.attention[0]?.id,
        kind: "settlement-unresolved",
        presentation: "problem",
        blockId: null,
        occurrenceId: null,
        nativeRequestId: null,
        pendingRequestCount: null,
        blockName: null,
      },
    ],
  });
});

it("a retried Settle that ends unresolved again keeps its one Problem without a new appearance", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = {
    ...setup,
    ...(await settleUnresolved(setup.world, await workerAtWork(setup.world, setup.input))),
  };
  const before = await f.f.getRun(f.runId);
  assert(before.ok);
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.settlement).toMatchObject({ state: "unresolved", attempt: 2 });
  expect(run.value.attention).toMatchObject([
    { id: before.value.attention[0]?.id, kind: "settlement-unresolved", settledAt: null },
  ]);
  expect(run.value.events.filter((event) => event.kind === "attention-appeared")).toHaveLength(1);
});

it("archiving a Run whose Settle could not stop workers resolves its Problem", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = {
    ...setup,
    ...(await settleUnresolved(setup.world, await workerAtWork(setup.world, setup.input))),
  };

  // Act
  const archivedRun = await f.f.archiveRun(f.runId);

  // Assert
  assert(archivedRun.ok);
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.attention).toMatchObject([
    { kind: "settlement-unresolved", settledAt: expect.any(String), settlementReason: "archived" },
  ]);
});

it("a Settle that could not stop workers wakes its Snoozed Run as Woke", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = {
    ...setup,
    ...(await snoozed(setup.world, await workerAtWork(setup.world, setup.input))),
  };
  f.t3.contract.support.stop = false;
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const navigation = await f.f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]).toMatchObject({
    settlement: "unresolved",
    presentation: { snoozed: false, woke: true },
    attention: { problem: true },
  });
});

it("T3 Code unavailable for the first settlement pass keeps the worker's Stop for a later pass", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  f.t3.threads.stopsEndThreads();
  // The Settle attempt holds the Run's lane from its failed check until it records the outcome.
  const checked = failNextInspection(f.t3);
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  await checked;

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(f.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual(["thread-1"]);
});

it("Settle without confirmation lists a launch AgentEasel has not confirmed as unresolved", async (c) => {
  // Arrange
  const { f, t3, input } = await prepared(c);
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  t3.threads.loseLaunchReply = true;
  t3.threads.discoverAvailable = false;
  await f.reconcileRuns();

  // Act
  const result = await f.settleRun(accepted.value.id, {});

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({
    outcome: "confirmation-required",
    workers: [{ blockId: "worker", threadId: null, state: "unresolved" }],
  });
  expect(t3.threads.threadStops).toStrictEqual([]);
});

it("repeating a confirmed Settle while its worker is stopping sends no second Stop", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  await f.f.reconcileRuns();

  // Act
  const result = await f.f.settleRun(f.runId, { stopWorkers: true });

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({ outcome: "stopping", run: { settlement: { attempt: 1 } } });
  expect(f.t3.threads.threadStops).toHaveLength(1);
});

it("a late report from a stopped worker leaves the manually settled Run settled and records nothing", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  f.t3.threads.stopsEndThreads();
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  await f.f.reconcileRuns();

  // Act
  const result = await f.f.runtime.submit(workerFinal(f.blockId));

  // Assert
  expect(result).toMatchObject({ code: "RUN_SETTLED", next: expect.stringContaining("settled") });
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.reports).toStrictEqual([]);
  expect(run.value.intents.filter((intent) => intent.kind === "handoff")).toStrictEqual([]);
});

it("after a restart, a stopping Run keeps its held work and settles without another Stop once its worker finished", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultHeld(setup.world, atWork)) };
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  assert((await f.f.reconcileRuns()).ok);
  await f.f.close();
  allTurnsEnd(f.world, f);

  // Act
  const reopened = await f.h.open({ t3: f.t3, connectionRetryMs: 60_000 });

  // Assert
  const run = await reopened.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.intents.filter((intent) => intent.kind === "handoff")).toMatchObject([
    { blockId: "parallel-block", state: "cancelled" },
  ]);
  expect(f.t3.threads.threadStops).toHaveLength(1);
  expect(f.t3.threads.launches.size).toBe(1);
});

it("settling a snoozed Run moves it out of Snoozed", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await snoozed(setup.world, reported)) };

  // Act
  const result = await f.f.settleRun(f.runId, {});

  // Assert
  assert(result.ok);
  const navigation = await f.f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]).toMatchObject({
    lifecycle: "settled",
    settlement: null,
    presentation: { snoozed: false, woke: false },
  });
});

it("a Settled Run cannot be snoozed", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await settled(setup.world, reported)) };

  // Act
  const result = await f.f.snoozeRun(f.runId);

  // Assert
  assert(!result.ok);
  expect(result.error.code).toBe("conflict");
});

it("a working report from a Block of an automatically Settled Run returns the Run to Active", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await settled(setup.world, reported)) };

  // Act
  const result = await f.f.runtime.submit(workerWorking(f.blockId));

  // Assert
  expect(result.code).toBe("ACCEPTED");
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("active");
  expect(run.value.events.at(-1)).toMatchObject({ kind: "run-activated", blockId: "worker" });
});

it("repeating the current result on a Settled Run returns the Run to Active", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const f = { ...setup, ...(await settled(setup.world, reported)) };

  // Act
  const result = await f.f.runtime.submit(workerFinal(f.blockId));

  // Assert
  expect(result.code).toBe("ACCEPTED");
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("active");
  expect(run.value.reports).toHaveLength(1);
});

it("repeating the earlier result after a working report makes it current, so the Run settles once its worker thread is finished", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const worker = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...worker };
  assert((await report(f.world, worker, finishedReport())) === "ACCEPTED");
  assert((await report(f.world, worker, workingReport())) === "ACCEPTED");
  assert((await report(f.world, worker, finishedReport())) === "ACCEPTED");
  allTurnsEnd(f.world, worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.blocks[0]).toMatchObject({ state: "finished", workingMessage: null });
});

it("a reply turn in a worker thread without a report leaves the Settled Run Settled", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const reported = await resultReported(setup.world, atWork);
  const worker = await settled(setup.world, reported);
  const f = { ...setup, ...worker };
  turnBegins(f.world, worker, "chat-execution");
  allTurnsEnd(f.world, worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.executions.map((e) => e.executionId)).not.toContain("chat-execution");
  expect(run.value.attention.filter((a) => !a.settledAt)).toStrictEqual([]);
});

it("an execution-failed Problem prevents settling a Block with a finished report", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const f = { ...setup, ...(await resultReported(setup.world, atWork, { status: "failed" })) };

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.attention.filter((a) => !a.settledAt).map((a) => a.kind)).toContain(
    "execution-failed",
  );
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("a working report accepted during the completion read prevents stale settlement", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const worker = await resultReported(setup.world, atWork);
  const f = { ...setup, ...worker };
  reopenDuringSettlement(f.world, worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.blocks[0]?.workingMessage).toBe("Opened PR #42; waiting for its CI checks.");
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("a newer active turn prevents settlement for an older finished result", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const worker = await resultReported(setup.world, atWork);
  const f = { ...setup, ...worker };
  turnBegins(f.world, worker, "newer-execution");

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("a newer idle turn with pending delegated work prevents settlement for an older result", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const atWork = await workerAtWork(setup.world, setup.input);
  const worker = await resultReported(setup.world, atWork);
  const f = { ...setup, ...worker };
  turnBegins(f.world, worker, "newer-execution");
  allTurnsEnd(f.world, worker);
  f.t3.threads.answerDelegatedWait("thread-1", "newer-execution", "pending", "completed");

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([]);
});

it("a newer completed turn is settled once by the Run fallback rather than an older Block result", async (c) => {
  // Arrange
  const setup = await prepared(c);
  const atWork = await workerAtWork(setup.world, setup.input);
  const worker = await resultReported(setup.world, atWork);
  const f = { ...setup, ...worker };
  turnBegins(f.world, worker, "newer-execution");
  allTurnsEnd(f.world, worker);

  // Act
  await f.f.reconcileRuns();

  // Assert
  expect(f.t3.threads.settlements).toStrictEqual([{ threadId: "thread-1" }]);
});

it("a launch whose reply was lost during Settle holds the Run unresolved while AgentEasel searches for its worker", async (c) => {
  // Arrange
  const { f, t3, input, world } = await prepared(c);
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  t3.threads.loseLaunchReply = true;
  t3.threads.discoverAvailable = false;
  settleDuringNextLaunch(world, accepted.value.id);

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(accepted.value.id);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "active",
    gateOpen: false,
    settlement: {
      state: "unresolved",
      workers: [
        {
          blockId: "worker",
          threadId: null,
          state: "unresolved",
          problem:
            "AgentEasel has not confirmed whether T3 Code launched this worker. It keeps searching and stops the worker it finds.",
        },
      ],
    },
  });
  expect(t3.threads.threadStops).toStrictEqual([]);
  const navigation = await f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]?.settlement).toBe(run.value.settlement?.state);
  expect(navigation.value[0]?.attention).toMatchObject({
    problem: true,
    matters: [{ kind: "settlement-unresolved", blockId: null }],
  });
});

it("a worker found after its launch reply was lost during Settle is stopped before the Run settles", async (c) => {
  // Arrange
  const { f, t3, input, world } = await prepared(c);
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  const threads: ControlledT3Threads = t3.threads;
  threads.loseLaunchReply = true;
  settleDuringNextLaunch(world, accepted.value.id);
  await f.reconcileRuns();
  threads.loseLaunchReply = false;
  await threads.recordLaunchedThread("thread-1");
  threads.stopsEndThreads();

  // Act
  await f.reconcileRuns();

  // Assert
  const run = await f.getRun(accepted.value.id);
  assert(run.ok);
  expect(run.value).toMatchObject({ lifecycle: "settled", settlement: null });
  expect(t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual(["thread-1"]);
  expect(t3.threads.launches.size).toBe(1);
});

it("a Stop is not requested once T3 Code authorization changes after the reads, and the worker stays unresolved", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  changeAuthorizationAfterNextRead(f.t3);
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "active",
    settlement: {
      state: "unresolved",
      workers: [
        {
          blockId: "worker",
          state: "unresolved",
          problem: expect.stringContaining("so AgentEasel did not request Stop"),
        },
      ],
    },
  });
  expect(f.t3.threads.threadStops).toStrictEqual([]);
});

it("a Stop whose authorization recheck T3 Code cannot answer is requested once by a later pass, which settles the Run", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  f.t3.threads.stopsEndThreads();
  // The Settle attempt holds the Run's lane from its failed recheck until it records the pass.
  const rechecked = failInspectionAfterNextRead(f.t3);
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  await rechecked;

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(f.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual(["thread-1"]);
});

it("a queued run on an otherwise finished worker blocks Settle but is not stopped", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  allTurnsEnd(setup.world, worker);
  const threads: ControlledT3Threads = setup.t3.threads;
  threads.queueUserMessage(worker.threadId, "queued-run");
  assert((await setup.f.settleRun(worker.runId, { stopWorkers: true })).ok);

  // Act
  await setup.f.reconcileRuns();

  // Assert
  const run = await setup.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.settlement).toMatchObject({
    state: "unresolved",
    workers: [
      {
        threadId: worker.threadId,
        state: "unresolved",
        problem: expect.stringContaining("queued"),
      },
    ],
  });
  expect(setup.t3.threads.threadStops).toStrictEqual([]);
});

it("a queued run does not hide a worker's unfinished delegated work from Settle's Stop", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  allTurnsEnd(setup.world, worker);
  setup.t3.threads.answerDelegatedWait(worker.threadId, worker.executionId, "pending", "completed");
  setup.t3.threads.queueUserMessage(worker.threadId, "queued-run");
  assert((await setup.f.settleRun(worker.runId, { stopWorkers: true })).ok);

  // Act
  await setup.f.reconcileRuns();

  // Assert
  expect(setup.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([
    worker.threadId,
  ]);
  const run = await setup.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.settlement).toMatchObject({
    state: "stopping",
    workers: [{ threadId: worker.threadId, problem: expect.stringContaining("queued") }],
  });
});

it("after a restart, a worker blocked only by queued work keeps its queued reason", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  allTurnsEnd(setup.world, worker);
  setup.t3.threads.queueUserMessage(worker.threadId, "queued-run");
  assert((await setup.f.settleRun(worker.runId, { stopWorkers: true })).ok);
  assert((await setup.f.reconcileRuns()).ok);
  await setup.f.close();

  // Act
  const reopened = await setup.h.open({ t3: setup.t3, connectionRetryMs: 60_000 });

  // Assert
  const run = await reopened.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.settlement).toMatchObject({
    state: "unresolved",
    workers: [
      {
        threadId: worker.threadId,
        state: "unresolved",
        problem: expect.stringContaining("queued"),
      },
    ],
  });
  expect(setup.t3.threads.threadStops).toStrictEqual([]);
});

it("Settle under a replaced T3 Code authorization is refused and leaves the Run unchanged", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  allTurnsEnd(setup.world, worker);
  await setup.f.configureConnection({ endpoint: "https://other.example/mcp" });

  // Act
  const result = await setup.f.settleRun(worker.runId, {});

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "conflict",
    message: expect.stringContaining("earlier T3 Code authorization"),
  });
  const run = await setup.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({ lifecycle: "active", gateOpen: true, settlement: null });
});

it("confirmed Settle under a replaced T3 Code authorization is refused while T3 Code is unavailable", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const worker = await workerAtWork(setup.world, setup.input);
  await setup.f.configureConnection({ endpoint: "https://other.example/mcp" });
  setup.t3.connection.available = false;
  await setup.f.recheckConnection();

  // Act
  const result = await setup.f.settleRun(worker.runId, { stopWorkers: true });

  // Assert
  assert(!result.ok);
  expect(result.error).toMatchObject({
    code: "conflict",
    message: expect.stringContaining("earlier T3 Code authorization"),
  });
  const run = await setup.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({ lifecycle: "active", gateOpen: true, settlement: null });
  expect(setup.t3.threads.threadStops).toStrictEqual([]);
});

it("Settle of a Run without workers still settles under a replaced T3 Code authorization", async (c) => {
  // Arrange
  const setup = await prepared(c);
  setup.t3.threads.rejectLaunch = true;
  const started = await setup.f.startRun(setup.input);
  assert(started.ok);
  assert((await setup.f.reconcileRuns()).ok);
  await setup.f.configureConnection({ endpoint: "https://other.example/mcp" });

  // Act
  const result = await setup.f.settleRun(started.value.id, {});

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({ outcome: "settled", run: { lifecycle: "settled" } });
});

it("a report while a confirmed settlement is stopping its worker records nothing and does not claim the work stopped", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  await f.f.reconcileRuns();

  // Act
  const result = await f.f.runtime.submit(workerFinal(f.blockId));

  // Assert
  expect(result).toMatchObject({
    code: "RUN_SETTLING",
    state: "settling",
    next: "The user is settling this Run: AgentEasel accepts no new work for it and is stopping its workers, so AgentEasel recorded nothing. Stop work on this Block and end the turn.",
  });
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({ lifecycle: "active", gateOpen: false, reports: [] });
});

it("an unreadable worker is stopped once reads recover within the same settlement attempt", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  const restore = pauseWorkerReads(f.t3, f.threadId);
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  assert((await f.f.reconcileRuns()).ok);
  expect(f.t3.threads.threadStops).toStrictEqual([]);
  restore();

  // Act
  await f.f.reconcileRuns();

  // Assert
  const run = await f.f.getRun(f.runId);
  assert(run.ok);
  expect(run.value.settlement).toMatchObject({ attempt: 1, state: "stopping" });
  expect(f.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([f.threadId]);
});

it("a worker unreadable during another worker's Stop remains eligible without repeating that Stop", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const [first, second] = await twoWorkersStarted(setup.world, setup.input);
  const restore = pauseWorkerReads(setup.t3, second.threadId);
  assert((await setup.f.settleRun(first.runId, { stopWorkers: true })).ok);
  assert((await setup.f.reconcileRuns()).ok);
  expect(setup.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([first.threadId]);
  restore();

  // Act
  await setup.f.reconcileRuns();

  // Assert
  const run = await setup.f.getRun(first.runId);
  assert(run.ok);
  expect(run.value.settlement).toMatchObject({ attempt: 1, state: "stopping" });
  expect(setup.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([
    first.threadId,
    second.threadId,
  ]);
});

it("settlement attributes stopped workers only to Stops acknowledged in its current attempt", async (c) => {
  // Arrange
  const setup = await prepared(c, fanOutFlow);
  const [first, second] = await twoWorkersStarted(setup.world, setup.input);
  const restore = pauseWorkerReads(setup.t3, second.threadId);
  assert((await setup.f.settleRun(first.runId, { stopWorkers: true })).ok);
  assert((await setup.f.reconcileRuns()).ok);
  expect(setup.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([first.threadId]);
  allTurnsEnd(setup.world, first);
  restore();
  setup.t3.threads.stopsEndThreads();
  assert((await setup.f.settleRun(first.runId, { stopWorkers: true })).ok);

  // Act
  await setup.f.reconcileRuns();

  // Assert
  const run = await setup.f.getRun(first.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.events.filter((event) => event.kind === "settlement-requested")).toHaveLength(2);
  expect(
    run.value.events
      .filter((event) => event.kind === "worker-stopped")
      .map((event) => event.blockId),
  ).toStrictEqual(["second"]);
  expect(setup.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([
    first.threadId,
    second.threadId,
  ]);
});

it("a restarted backend never sends the Stop deferred by an earlier owner's unreadable worker", async (c) => {
  // Arrange
  const setup = await prepared(c, handoffFlow);
  const f = { ...setup, ...(await workerAtWork(setup.world, setup.input)) };
  const restore = pauseWorkerReads(f.t3, f.threadId);
  assert((await f.f.settleRun(f.runId, { stopWorkers: true })).ok);
  assert((await f.f.reconcileRuns()).ok);
  await f.f.close();
  restore();

  // Act
  const reopened = await f.h.open({ t3: f.t3, connectionRetryMs: 60_000 });

  // Assert
  const run = await reopened.getRun(f.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "active",
    gateOpen: false,
    settlement: { state: "unresolved", attempt: 1 },
  });
  expect(f.t3.threads.threadStops).toStrictEqual([]);
});

it("retrying a launch-only unresolved settlement after restart starts a new owned attempt", async (c) => {
  // Arrange
  const { h, f, t3, input, world } = await prepared(c);
  const accepted = await f.startRun(input);
  assert(accepted.ok);
  t3.threads.loseLaunchReply = true;
  t3.threads.discoverAvailable = false;
  settleDuringNextLaunch(world, accepted.value.id);
  assert((await f.reconcileRuns()).ok);
  await f.close();
  const reopened = await h.open({ t3, connectionRetryMs: 60_000 });
  const before = await reopened.getRun(accepted.value.id);
  assert(before.ok);
  expect(before.value.settlement).toMatchObject({ state: "unresolved", attempt: 1 });

  // Act
  const result = await reopened.settleRun(accepted.value.id, { stopWorkers: true });

  // Assert
  assert(result.ok);
  expect(result.value).toMatchObject({
    outcome: "unresolved",
    run: { settlement: { attempt: 2, workers: [{ threadId: null, state: "unresolved" }] } },
  });
});
