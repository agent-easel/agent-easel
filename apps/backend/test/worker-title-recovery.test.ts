import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { preparedService } from "./support/prepared-runner.ts";
import { heldWorkerRename, workerAtWork } from "./support/scenarios.ts";

it.effect("restart retries a lost acknowledgement with the same revision key after backoff", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c);
    const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
    f.t3.threads.loseRenameReply = true;
    assert((yield* f.factory.renameRun(worker.runId, { title: "New subject" })).ok);
    yield* f.factory.reconcileRuns();
    const [sent] = f.t3.threads.renames;
    assert(sent);
    expect(f.t3.threads.renames).toHaveLength(1);
    yield* f.close;
    f.t3.threads.loseRenameReply = false;
    yield* TestClock.adjust(60_000);

    // Act
    const reopened = yield* f.reopen;

    // Assert
    yield* reopened.reconcileRuns();
    expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
  }),
);

it.effect("a timed-out rename releases its lane and coalesces unsent revisions", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c);
    const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
    const { sent, release } = yield* Effect.promise(() =>
      heldWorkerRename(f.world, worker.runId, "Intermediate"),
    );
    assert((yield* f.factory.renameRun(worker.runId, { title: "Unsent" })).ok);
    assert((yield* f.factory.renameRun(worker.runId, { title: f.input.title })).ok);
    expect(f.t3.threads.renames).toStrictEqual([sent]);

    // Act
    yield* TestClock.adjust(15_000);

    // Assert
    yield* f.factory.reconcileRuns();
    release();
    expect(f.t3.threads.renames.map(({ title }) => title)).toStrictEqual([
      "F#1 Entry worker · Intermediate",
      "F#1 Entry worker · Improve search",
    ]);
    expect(f.t3.threads.renames[1]?.clientRequestId).not.toBe(sent.clientRequestId);
  }),
);

it.effect(
  "a compacted replay closes the revision and a later return to the original title is sent",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* preparedService(c);
      const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
      f.t3.threads.loseRenameReply = true;
      assert((yield* f.factory.renameRun(worker.runId, { title: "Intermediate" })).ok);
      yield* f.factory.reconcileRuns();
      const [sent] = f.t3.threads.renames;
      assert(sent);
      f.t3.threads.loseRenameReply = false;
      f.t3.threads.compactRenameKeys.add(sent.clientRequestId);
      f.t3.threads.remoteTitles.set(worker.threadId, "Edited in T3");
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(60_000);
      yield* f.factory.reconcileRuns();
      expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("Edited in T3");

      // Act
      assert((yield* f.factory.renameRun(worker.runId, { title: f.input.title })).ok);

      // Assert
      yield* f.factory.reconcileRuns();
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("F#1 Entry worker · Improve search");
      expect(f.t3.threads.renames[2]?.clientRequestId).not.toBe(sent.clientRequestId);
    }),
);

it.effect(
  "a transient refusal backs off consecutive attempts and recovers with the same key",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* preparedService(c);
      const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
      f.t3.threads.renameDisposition = { kind: "unavailable" };
      assert((yield* f.factory.renameRun(worker.runId, { title: "Delayed" })).ok);
      yield* f.factory.reconcileRuns();
      const [sent] = f.t3.threads.renames;
      assert(sent);
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(1999);
      yield* f.factory.reconcileRuns();
      expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
      f.t3.threads.renameDisposition = undefined;
      yield* TestClock.adjust(1);

      // Act
      yield* f.factory.reconcileRuns();

      // Assert
      expect(f.t3.threads.renames).toStrictEqual([sent, sent, sent]);
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("F#1 Entry worker · Delayed");
    }),
);

it.effect(
  "a denied worker stays paused across time and never replays under replacement authorization",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* preparedService(c);
      const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
      f.t3.threads.renameDisposition = { kind: "capability-denied" };
      assert((yield* f.factory.renameRun(worker.runId, { title: "Denied" })).ok);
      yield* f.factory.reconcileRuns();
      const [sent] = f.t3.threads.renames;
      assert(sent);
      f.t3.threads.renameDisposition = undefined;
      yield* TestClock.adjust(120_000);
      yield* f.factory.reconcileRuns();
      expect(f.t3.threads.renames).toStrictEqual([sent]);
      f.t3.connection.approve("replacement");
      assert((yield* f.factory.recheckConnection()).ok);

      // Act
      assert((yield* f.factory.renameRun(worker.runId, { title: "After approval" })).ok);

      // Assert
      yield* f.factory.reconcileRuns();
      expect(f.t3.threads.renames).toStrictEqual([sent]);
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("F#1 Entry worker · Improve search");
    }),
);
