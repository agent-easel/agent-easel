import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { conditionStorageInterrupted } from "./support/condition-storage.ts";
import { prepared, preparedService } from "./support/prepared-runner.ts";
import { launchedBlockId } from "./support/run-worker.ts";
import {
  allTurnsEnd,
  arrivalsNumbered,
  conditionFlow,
  conditionSelections,
  fanOutConditionFlow,
  finishedReport,
  launchBlockId,
  loopConditionFlow,
  nextLaunch,
  nextSend,
  observeFor,
  parallelConditionFlow,
  report,
  resultHeld,
  resultReleasedToHumanReview,
  resultReleasedToSameWorker,
  resultReported,
  reviewConditionFlow,
  sentTurnBegins,
  settled,
  terminalConditionFlow,
  turnBegins,
  twoWorkersStarted,
  workerAtWork,
} from "./support/scenarios.ts";

it("arrivals from two workers share one count, and each selection forwards its own worker's message and origin", async (c) => {
  // Arrange
  const f = await prepared(c, parallelConditionFlow);
  const [first, second] = await twoWorkersStarted(f.world, f.input);
  await resultReported(f.world, first, { message: "First branch." });
  await arrivalsNumbered(f.world, first.runId, 1);
  await resultReported(f.world, second, { message: "Second branch." });

  // Act
  const run = await observeFor(
    "observe the second arrival and the follow-up launch",
    f.world,
    first.runId,
    (detail) =>
      detail.conditions[0]?.arrivals === 2 &&
      detail.blocks.some((block) => block.blockId === "follow-up" && block.threadId !== null),
  );

  // Assert
  expect(run.conditions).toStrictEqual([
    {
      blockId: "gate",
      arrivals: 2,
      pending: 0,
      latest: { arrivalNumber: 2, outputId: "escalate", acceptedAt: expect.any(String) },
    },
  ]);
  expect(conditionSelections(run)).toStrictEqual([
    { arrivalNumber: 1, outputId: "otherwise" },
    { arrivalNumber: 2, outputId: "escalate" },
  ]);
  expect(
    run.intents
      .filter((intent) => intent.conditionArrivalId !== null)
      .map((intent) => [intent.blockId, intent.origin?.threadId]),
  ).toStrictEqual([
    ["follow-up", first.threadId],
    ["review", second.threadId],
  ]);
  expect(run.humanOccurrences).toMatchObject([{ blockId: "review", context: "Second branch." }]);
  expect(run.blocks.find((block) => block.blockId === "gate")).toMatchObject({
    state: "finished",
    threadId: null,
  });
  expect(run.attention.filter((matter) => matter.blockId === "gate")).toStrictEqual([]);
  expect(f.t3.launches.size).toBe(3);
  const followUp = await f.f.runtime.block({
    arguments: { blockId: launchedBlockId(f.t3, "Follow-up") },
  });
  expect(followUp).toMatchObject({
    reason: "Condition",
    inputs: { results: [], feedback: "First branch." },
  });
});

it("a later result with identical text is the next arrival and escalates from arrival 2", async (c) => {
  // Arrange
  const f = await prepared(c, loopConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  const revisitSent = nextSend(f.world);
  await resultReported(f.world, worker, { message: "Same." });
  await resultReleasedToSameWorker(f.world, worker);
  const revisit = await revisitSent;
  const again = sentTurnBegins(f.world, worker);
  await resultReported(f.world, again, { message: "Same." });

  // Act
  const run = await arrivalsNumbered(f.world, worker.runId, 2);

  // Assert
  expect(revisit.message).toMatch(/Same\.$/);
  expect(conditionSelections(run)).toStrictEqual([
    { arrivalNumber: 1, outputId: "otherwise" },
    { arrivalNumber: 2, outputId: "escalate" },
  ]);
  expect(run.humanOccurrences).toMatchObject([{ context: "Same.", state: "pending" }]);
});

it("a repeated report keeps its one arrival, and an unwired selection ends it and lets the Run settle", async (c) => {
  // Arrange
  const f = await prepared(c, terminalConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "Once." });
  await arrivalsNumbered(f.world, worker.runId, 1);
  await settled(f.world, worker);

  // Act
  const repeated = await report(f.world, worker, finishedReport("Once."));

  // Assert
  expect(repeated).toBe("ACCEPTED");
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.intents.filter((intent) => intent.blockId === "gate")).toHaveLength(1);
  expect(run.value.intents.filter((intent) => intent.conditionArrivalId !== null)).toStrictEqual(
    [],
  );
  expect(run.value.conditions).toMatchObject([{ arrivals: 1, pending: 0 }]);
  expect(conditionSelections(run.value)).toStrictEqual([
    { arrivalNumber: 1, outputId: "otherwise" },
  ]);
});

it("a Run that returns to Active continues its Condition count", async (c) => {
  // Arrange
  const f = await prepared(c, terminalConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "First pass." });
  await settled(f.world, worker);
  const later = turnBegins(f.world, worker, "later-execution");
  const revised = await report(f.world, later, finishedReport("Needs another pass.", "Revise"));
  assert(revised === "ACCEPTED");
  allTurnsEnd(f.world, later);

  // Act
  const reconciled = await f.f.reconcileRuns();

  // Assert
  assert(reconciled.ok);
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.events.map((event) => event.kind)).toContain("run-activated");
  expect(conditionSelections(run.value)).toStrictEqual([
    { arrivalNumber: 1, outputId: "otherwise" },
    { arrivalNumber: 2, outputId: "otherwise" },
  ]);
  expect(run.value.conditions).toMatchObject([{ arrivals: 2, latest: { arrivalNumber: 2 } }]);
});

it.effect(
  "a restart after a committed selection delivers only its outstanding recipient without selecting again",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* preparedService(c, fanOutConditionFlow);
      const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
      f.t3.launchSupported = false;
      yield* Effect.promise(() => resultReported(f.world, worker, { message: "For both." }));
      yield* Effect.promise(() =>
        observeFor(
          "observe the delivered review",
          f.world,
          worker.runId,
          (run) => run.humanOccurrences.length === 1,
        ),
      );
      yield* f.close;
      f.t3.launchSupported = true;
      const followUpLaunch = nextLaunch(f.world);

      // Act
      const recovered = yield* f.reopen;

      // Assert
      yield* Effect.promise(() => followUpLaunch);
      const run = yield* recovered.getRun(worker.runId);
      assert(run.ok);
      expect(conditionSelections(run.value)).toStrictEqual([
        { arrivalNumber: 1, outputId: "otherwise" },
      ]);
      expect(run.value.conditions).toMatchObject([{ arrivals: 1, pending: 0 }]);
      expect(
        run.value.intents
          .filter((intent) => intent.conditionArrivalId !== null)
          .map((intent) => [intent.blockId, intent.kind]),
      ).toStrictEqual([
        ["follow-up", "launch"],
        ["review", "handoff"],
      ]);
      expect(run.value.humanOccurrences).toMatchObject([{ context: "For both." }]);
      expect(f.t3.launches.size).toBe(2);
    }),
);

it("a storage failure while accepting consumes no number and records no Problem; the next pass numbers the delivery 1", async (c) => {
  // Arrange
  const f = await prepared(c, conditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  const restore = conditionStorageInterrupted(f.h.databasePath);
  await resultReported(f.world, worker, { message: "Retry me." });
  const failed = await observeFor("observe the release", f.world, worker.runId, (run) =>
    run.events.some((event) => event.kind === "handoff-released"),
  );
  restore();

  // Act
  const run = await arrivalsNumbered(f.world, worker.runId, 1);

  // Assert
  expect(failed.conditions).toStrictEqual([
    { blockId: "gate", arrivals: 0, pending: 0, latest: null },
  ]);
  expect(failed.intents.find((intent) => intent.blockId === "gate")).toMatchObject({
    state: "pending",
    problem: null,
  });
  expect(failed.attention).toStrictEqual([]);
  expect(conditionSelections(run)).toStrictEqual([{ arrivalNumber: 1, outputId: "otherwise" }]);
  expect(run.intents.find((intent) => intent.blockId === "gate")?.state).toBe("acknowledged");
});

it("Archive after a committed selection keeps it as history and cancels its unsent delivery", async (c) => {
  // Arrange
  const f = await prepared(c, conditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  f.t3.launchSupported = false;
  await resultReported(f.world, worker, { message: "Do not deliver." });
  await arrivalsNumbered(f.world, worker.runId, 1);

  // Act
  const archived = await f.f.archiveRun(worker.runId);

  // Assert
  assert(archived.ok);
  expect(archived.value.conditions).toStrictEqual([
    {
      blockId: "gate",
      arrivals: 1,
      pending: 0,
      latest: { arrivalNumber: 1, outputId: "otherwise", acceptedAt: expect.any(String) },
    },
  ]);
  expect(conditionSelections(archived.value)).toStrictEqual([
    { arrivalNumber: 1, outputId: "otherwise" },
  ]);
  expect(
    archived.value.intents
      .filter((intent) => intent.blockId === "follow-up")
      .map((intent) => intent.state),
  ).toStrictEqual(["cancelled"]);
  expect(archived.value.blocks.find((block) => block.blockId === "gate")?.state).toBe("finished");
  expect(f.t3.launches.size).toBe(1);
});

it("Archive racing acceptance leaves a count matching its recorded selections and nothing to deliver", async (c) => {
  // Arrange
  const f = await prepared(c, conditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  f.t3.launchSupported = false;
  await resultReported(f.world, worker);

  // Act
  const [archived] = await Promise.all([f.f.archiveRun(worker.runId), f.f.reconcileRuns()]);

  // Assert
  assert(archived.ok);
  const run = await f.f.getRun(worker.runId);
  assert(run.ok);
  expect(run.value.gateOpen).toBe(false);
  expect(run.value.conditions[0]?.arrivals).toBe(conditionSelections(run.value).length);
  expect(run.value.conditions[0]?.pending).toBe(0);
  expect(
    run.value.intents.filter(
      (intent) =>
        intent.blockId !== "worker" &&
        intent.state !== "cancelled" &&
        intent.state !== "acknowledged",
    ),
  ).toStrictEqual([]);
  expect(f.t3.launches.size).toBe(1);
});

it("a confirmed Settle that closes the gate before a result reaches the Condition accepts no decision", async (c) => {
  // Arrange
  const f = await prepared(c, conditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultHeld(f.world, worker);
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
  expect(run.value.conditions).toStrictEqual([
    { blockId: "gate", arrivals: 0, pending: 0, latest: null },
  ]);
  expect(run.value.intents.find((intent) => intent.blockId === "gate")?.state).toBe("cancelled");
  expect(run.value.blocks.find((block) => block.blockId === "gate")?.state).toBe("not-started");
  expect(f.t3.launches.size).toBe(1);
});

it("an empty Human approval passes through the Condition unchanged with the reviewed worker", async (c) => {
  // Arrange
  const f = await prepared(c, reviewConditionFlow);
  const worker = await workerAtWork(f.world, f.input);
  await resultReported(f.world, worker, { message: "Ready to review." });
  const review = await resultReleasedToHumanReview(f.world, worker);
  const promptSend = nextSend(f.world);
  const followUpLaunch = nextLaunch(f.world);

  // Act
  const answered = await f.f.answerHumanOccurrence(review.occurrence.id, { exitId: "approve" });

  // Assert
  assert(answered.ok);
  const run = await observeFor("observe the routed deliveries", f.world, worker.runId, (detail) =>
    detail.blocks.some((block) => block.blockId === "spec" && block.state === "sent"),
  );
  const sent = await promptSend;
  expect(sent.threadId).toBe(worker.threadId);
  expect(sent.message).toMatch(/Reply from the Human step "Review" \(Approve\):\n\(no message\)$/);
  const launched = await followUpLaunch;
  const followUp = await f.f.runtime.block({
    arguments: { blockId: launchBlockId(launched.message) },
  });
  expect(followUp).toMatchObject({ reason: "Condition", inputs: { feedback: "" } });
  expect(
    run.intents
      .filter((intent) => intent.conditionArrivalId !== null)
      .map((intent) => [intent.blockId, intent.origin?.threadId]),
  ).toStrictEqual([
    ["spec", worker.threadId],
    ["follow-up", worker.threadId],
  ]);
});
