import { assert, expect, it } from "@effect/vitest";
import { promptSent } from "./support/continuation.ts";
import { prepared } from "./support/prepared-runner.ts";
import {
  allTurnsEnd,
  endingBesidePendingWorkFlow,
  endingBesideReviewFlow,
  endingReached,
  finishedReport,
  launchedWorkers,
  optionalEndingFlow,
  racingEndingsFlow,
  report,
  resultHeld,
  resultReleasedToHumanReview,
  resultReported,
  reviewedEndingFlow,
  sentTurnBegins,
  silentEndingFlow,
  turnBegins,
  twoWorkersStarted,
  workerAtWork,
} from "./support/scenarios.ts";

it("two racing deliveries into endings record exactly one Run result and cancel the loser at the closed gate", async (c) => {
  // Arrange
  const f = await prepared(c, racingEndingsFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultHeld(f.world, first, { message: "https://example.test/pull/42" });
  await resultHeld(f.world, second, { message: "Could not reproduce." });

  // Act
  allTurnsEnd(f.world, first);
  allTurnsEnd(f.world, second);
  const run = await endingReached(f.world, first.runId);

  // Assert
  const deliveries = run.intents.filter((intent) => intent.blockId === "finish");
  expect(deliveries.map((intent) => [intent.sourceBlockId, intent.state])).toStrictEqual([
    ["worker", "acknowledged"],
    ["second", "cancelled"],
  ]);
  expect(run.result).toStrictEqual({
    endingId: "delivered",
    endingName: "Delivered",
    output: "https://example.test/pull/42",
    outputMissing: false,
    sourceBlockId: "worker",
    exitId: "done",
    authorBlockId: "worker",
    origin: { runId: run.id, activationId: expect.any(String), threadId: first.threadId },
    deliveryId: deliveries[0]!.id,
    acceptedAt: expect.any(String),
  });
  expect(run.gateOpen).toBe(false);
  expect(run.events.filter((event) => event.kind === "ending-reached")).toMatchObject([
    { causeId: "delivered" },
  ]);
  expect(run.blocks.map((block) => block.blockId)).toStrictEqual(["worker", "second"]);
});

it("a report after the Run result is recorded changes nothing", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "https://example.test/pull/42" });
  const reached = await endingReached(f.world, worker.runId);
  const later = turnBegins(f.world, worker, "later-execution");

  // Act
  const code = await report(f.world, later, finishedReport("A different outcome."));

  // Assert
  expect(code).toBe("RUN_SETTLED");
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.result).toStrictEqual(reached.result);
  expect(run.value.reports).toStrictEqual(reached.reports);
});

it("a blank Human approval routed through a Condition into a Required ending records Output missing, attributed to the Human step", async (c) => {
  // Arrange
  const f = await prepared(c, reviewedEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "Ready to review." });
  const review = await resultReleasedToHumanReview(f.world, worker);

  // Act
  const answered = await f.f.answerHumanOccurrence(review.occurrence.id, { exitId: "approve" });

  // Assert
  assert(answered.ok);
  const run = await endingReached(f.world, worker.runId);
  expect(run.result).toMatchObject({
    endingId: "delivered",
    output: "",
    outputMissing: true,
    sourceBlockId: "gate",
    exitId: "otherwise",
    authorBlockId: "review",
    origin: { threadId: worker.threadId },
  });
  expect(run.attention.filter((matter) => !matter.settledAt)).toStrictEqual([]);
});

it("an ending with Output None records the ending without the message", async (c) => {
  // Arrange
  const f = await prepared(c, silentEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "Nothing to keep." });

  // Act
  const run = await endingReached(f.world, worker.runId);

  // Assert
  expect(run.result).toMatchObject({ endingId: "delivered", output: null, outputMissing: false });
  expect(
    run.intents.filter((intent) => intent.blockId === "finish" && intent.payloadRetained),
  ).toStrictEqual([]);
});

it("the Run result is kept through Archive", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "https://example.test/pull/42" });
  const reached = await endingReached(f.world, worker.runId);

  // Act
  const archived = await f.f.archiveRun(worker.runId);

  // Assert
  assert(archived.ok);
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("archived");
  expect(run.value.result).toStrictEqual(reached.result);
});

it("Archive cancels a pending ending delivery before it can record a Run result", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultHeld(f.world, worker, { message: "https://example.test/pull/42" });
  const pending = await f.f.getRun(worker.runId);
  assert(pending.ok);
  expect(pending.value.intents).toContainEqual(
    expect.objectContaining({ blockId: "finish", targetEndingId: "delivered", state: "pending" }),
  );

  // Act
  const archived = await f.f.archiveRun(worker.runId);

  // Assert
  assert(archived.ok);
  expect(archived.value).toMatchObject({ lifecycle: "archived", gateOpen: false, result: null });
  expect(archived.value.intents.find((intent) => intent.blockId === "finish")).toMatchObject({
    state: "cancelled",
    problem: "cancelled-on-Archive",
  });
  expect(archived.value.events.filter((event) => event.kind === "ending-reached")).toStrictEqual(
    [],
  );
});

it("a confirmed Settle that closes the gate before the delivery is accepted records no Run result", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultHeld(f.world, worker, { message: "https://example.test/pull/42" });
  const stopping = await f.f.settleRun(worker.runId, { stopWorkers: true });
  assert(stopping.ok);
  allTurnsEnd(f.world, worker, "interrupted");

  // Act
  const reconciled = await f.f.reconcileRuns();

  // Assert
  assert(reconciled.ok);
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.result).toBeNull();
  expect(run.value.intents.find((intent) => intent.blockId === "finish")?.state).toBe("cancelled");
  expect(run.value.events.filter((event) => event.kind === "ending-reached")).toStrictEqual([]);
});

it("factory_get_run returns the Run result", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "https://example.test/pull/42" });
  const reached = await endingReached(f.world, worker.runId);

  // Act
  const read = await f.f.runtime.run({ arguments: { blockId: worker.blockId } });

  // Assert
  expect(read).toMatchObject({ code: "RUN", result: reached.result });
});

it("reaching an ending stops the other workers and settles the Run with finish only once fresh reads show them finished", async (c) => {
  // Arrange
  const f = await prepared(c, racingEndingsFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "https://example.test/pull/42" });
  const reached = await endingReached(f.world, first.runId);
  assert((await f.f.reconcileRuns()).ok);
  const stopping = await f.f.getRun(first.runId);
  assert(stopping.ok);

  // Act
  allTurnsEnd(f.world, second, "interrupted");
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  expect(stopping.value).toMatchObject({
    lifecycle: "active",
    gateOpen: false,
    result: reached.result,
    settlement: {
      state: "stopping",
      workers: [
        { blockId: "worker", state: "finished" },
        { blockId: "second", state: "stopping", stopOutcome: "acknowledged" },
      ],
    },
  });
  expect(f.t3.threads.threadStops.map((stop) => stop.threadId)).toStrictEqual([second.threadId]);
  const run = await f.f.getRun(first.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "settled",
    settlement: null,
    result: reached.result,
  });
  expect(run.value.blocks.map((block) => [block.blockId, block.state])).toStrictEqual([
    ["worker", "finished"],
    ["second", "stopped"],
  ]);
  expect(
    run.value.events
      .filter((event) => event.kind.includes("settle") || event.kind.includes("stop"))
      .map((event) => [event.kind, event.blockId]),
  ).toStrictEqual([
    ["settlement-requested", null],
    ["worker-stop-requested", "second"],
    ["worker-stopped", "second"],
    ["run-settled", null],
  ]);
  expect(run.value.events.find((event) => event.kind === "run-settled")?.causeId).toBe("finish");
});

it("a Run that reached its ending exposes the captured ending name and the reason finish on its navigation row after a restart", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "https://example.test/pull/42" });
  const reached = await endingReached(f.world, worker.runId);
  assert(reached.result);
  assert((await f.f.reconcileRuns()).ok);
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  const settledEvent = run.value.events.findLast((event) => event.kind === "run-settled");
  await f.f.close();
  const reopened = await f.h.open({ t3: f.t3, connectionRetryMs: 60_000 });

  // Act
  const navigation = await reopened.listRunNavigation();

  // Assert
  assert(navigation.ok);
  expect(navigation.value[0]).toMatchObject({
    lifecycle: "settled",
    settledCycle: settledEvent?.sequence,
    settledReason: "finish",
    endingName: reached.result.endingName,
  });
  expect(JSON.stringify(navigation.value)).not.toContain("example.test/pull/42");
});

it("a Settle on a Run that already has a Run result is reported as finish on its navigation row", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "https://example.test/pull/42" });
  const reached = await endingReached(f.world, worker.runId);
  assert(reached.result);

  // Act
  const settled = await f.f.settleRun(worker.runId, {});

  // Assert
  assert(settled.ok);
  const navigation = await f.f.listRunNavigation();
  assert(navigation.ok);
  expect(navigation.value[0]).toMatchObject({
    lifecycle: "settled",
    settledReason: "finish",
    endingName: reached.result.endingName,
  });
});

it("settling after an ending cancels the Run's pending Human occurrence with reason finish", async (c) => {
  // Arrange
  const f = await prepared(c, endingBesideReviewFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, second, { message: "Please review." });
  const review = await resultReleasedToHumanReview(f.world, second);
  await resultReported(f.world, first, { message: "https://example.test/pull/42" });

  // Act
  await endingReached(f.world, first.runId);
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  const run = await f.f.getRun(first.runId);
  assert(run.ok);
  expect(run.value.lifecycle).toBe("settled");
  expect(run.value.events.find((event) => event.kind === "run-settled")?.causeId).toBe("finish");
  expect(run.value.humanOccurrences).toMatchObject([
    { id: review.occurrence.id, state: "cancelled" },
  ]);
  expect(run.value.attention).toMatchObject([{ kind: "human", settlementReason: "finish" }]);
  expect(f.t3.threads.threadStops).toStrictEqual([]);
});

it("settling after an ending cancels pending Wait, Condition and Continuation work", async (c) => {
  // Arrange
  const f = await prepared(c, endingBesidePendingWorkFlow);
  const started = await f.f.startRun(f.input);
  assert(started.ok);
  const {
    workers: [first, second, third],
  } = await launchedWorkers(f.world, started.value.id);
  assert(first && second && third);
  f.t3.contract.support.launch = false;
  await resultReported(f.world, second, { message: "For the parallel branch." });
  await promptSent(f.world, second);
  sentTurnBegins(f.world, second);
  await resultReported(f.world, third, { message: "Review notes for the prompt." });
  assert((await f.f.reconcileRuns()).ok);
  const pending = await f.f.getRun(first.runId);
  assert(pending.ok);
  expect(pending.value.waitArrivals).toMatchObject([{ state: "pending" }]);
  expect(pending.value.intents).toContainEqual(
    expect.objectContaining({
      blockId: "follow-up",
      state: "pending",
    }),
  );
  const arrivals = await f.f.listConditionArrivals(first.runId, "gate", "", "");
  assert(arrivals.ok);
  expect(arrivals.value.arrivals).toMatchObject([
    { arrivalNumber: 1, recipients: [{ blockId: "follow-up", disposition: "pending" }] },
  ]);
  expect(pending.value.continuationVisits).toMatchObject([
    { kind: "prompt", state: "sent" },
    { kind: "pass-through", state: "queued" },
  ]);
  await resultHeld(f.world, first, { message: "https://example.test/pull/42" });
  f.t3.threads.stopsEndThreads();

  // Act
  allTurnsEnd(f.world, first, "completed");
  assert((await f.f.reconcileRuns()).ok);

  // Assert
  const run = await f.f.getRun(first.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({ lifecycle: "settled", result: { endingId: "delivered" } });
  expect(run.value.events.find((event) => event.kind === "run-settled")?.causeId).toBe("finish");
  expect(run.value.waitArrivals).toMatchObject([
    { id: pending.value.waitArrivals[0]!.id, state: "cancelled", forwardedBy: null, message: null },
  ]);
  expect(run.value.continuationVisits).toMatchObject([
    { kind: "prompt", state: "cancelled" },
    { kind: "pass-through", state: "cancelled" },
  ]);
  expect(run.value.intents.filter((intent) => intent.blockId === "follow-up")).toMatchObject([
    { state: "cancelled", problem: "cancelled-on-Finish" },
  ]);
  const cancelled = await f.f.listConditionArrivals(first.runId, "gate", "", "");
  assert(cancelled.ok);
  expect(cancelled.value.arrivals).toMatchObject([
    { arrivalNumber: 1, recipients: [{ blockId: "follow-up", disposition: "cancelled" }] },
  ]);
  expect(f.t3.threads.launches.size).toBe(3);
  expect(f.t3.threads.sends.size).toBe(1);
});

it("after restart a held ending reaches Finish once its worker's completed turn is observed", async (c) => {
  // Arrange
  const f = await prepared(c, optionalEndingFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultHeld(f.world, worker, { message: "https://example.test/pull/42" });
  await f.f.close();
  allTurnsEnd(f.world, worker, "completed");

  // Act
  const reopened = await f.h.open({ t3: f.t3, connectionRetryMs: 60_000 });

  // Assert
  const run = await reopened.getRun(worker.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "settled",
    gateOpen: false,
    result: { endingId: "delivered", output: "https://example.test/pull/42" },
  });
  expect(run.value.events.filter((event) => event.kind === "ending-reached")).toHaveLength(1);
  expect(run.value.events.find((event) => event.kind === "run-settled")?.causeId).toBe("finish");
});

it("restarting under a replaced T3 Code authorization leaves an in-progress Finish settlement unresolved without another Stop", async (c) => {
  // Arrange
  const f = await prepared(c, racingEndingsFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "https://example.test/pull/42" });
  const reached = await endingReached(f.world, first.runId);
  expect(reached.settlement?.state).toBe("stopping");
  await f.f.close();
  f.t3.connection.approve("replacement-grant");
  const stops = [...f.t3.threads.threadStops];

  // Act
  const reopened = await f.h.open({ t3: f.t3, connectionRetryMs: 60_000 });

  // Assert
  const run = await reopened.getRun(first.runId);
  assert(run.ok);
  expect(run.value).toMatchObject({
    lifecycle: "active",
    gateOpen: false,
    result: reached.result,
    settlement: {
      state: "unresolved",
      workers: expect.arrayContaining([
        expect.objectContaining({
          threadId: second.threadId,
          problem: "The T3 Code connection is unavailable or its authorization changed.",
          stopOutcome: "acknowledged",
        }),
      ]),
    },
  });
  expect(
    run.value.attention.filter((matter) => matter.settledAt === null).map((m) => m.kind),
  ).toStrictEqual(["settlement-unresolved"]);
  expect(run.value.events.filter((event) => event.kind === "settlement-requested")).toHaveLength(1);
  expect(f.t3.threads.threadStops).toStrictEqual(stops);
});
