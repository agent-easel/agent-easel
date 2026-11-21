import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { preparedService } from "./support/prepared-runner.ts";
import {
  fanOutFlow,
  twoWorkersStarted,
  heldWorkerRename,
  workerAtWork,
} from "./support/scenarios.ts";

it.effect(
  "restart retries an unexpected first acknowledgement with the same revision key after backoff",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* preparedService(c);
      const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
      f.t3.threads.renameDisposition = {
        kind: "different-title",
        threadId: worker.threadId,
        title: "Unexpected",
      };
      f.t3.threads.beforeRename = async () => {
        f.t3.contract.support.rename = false;
        await f.world.factory.recheckConnection();
      };
      const dispatched = f.t3.threads.nextRename();
      assert((yield* f.factory.renameRun(worker.runId, { title: "New subject" })).ok);
      yield* TestClock.adjust(0);
      expect(f.t3.threads.renames).toHaveLength(0);
      expect(f.t3.contract.support.rename).toBe(false);
      delete f.t3.threads.beforeRename;
      f.t3.contract.support.rename = true;
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      const sent = yield* Effect.promise(() => dispatched);
      yield* TestClock.adjust(0);
      expect(f.t3.threads.renames).toHaveLength(1);
      yield* f.close;
      yield* TestClock.adjust(60_000);

      // Act
      const replay = f.t3.threads.nextRename();
      const reopened = yield* f.reopen;

      // Assert
      yield* Effect.promise(() => replay);
      yield* TestClock.adjust(60_000);
      yield* reopened.reconcileRuns();
      yield* TestClock.adjust(0);
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
    yield* TestClock.adjust(0);
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
      const dispatched = f.t3.threads.nextRename();
      assert((yield* f.factory.renameRun(worker.runId, { title: "Intermediate" })).ok);
      const sent = yield* Effect.promise(() => dispatched);
      yield* TestClock.adjust(0);
      f.t3.threads.loseRenameReply = false;
      f.t3.threads.compactRenameKeys.add(sent.clientRequestId);
      f.t3.threads.remoteTitles.set(worker.threadId, "Edited in T3");
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);
      yield* TestClock.adjust(60_000);
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);
      expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("Edited in T3");

      // Act
      assert((yield* f.factory.renameRun(worker.runId, { title: f.input.title })).ok);

      // Assert
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);
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
      const dispatched = f.t3.threads.nextRename();
      assert((yield* f.factory.renameRun(worker.runId, { title: "Delayed" })).ok);
      const sent = yield* Effect.promise(() => dispatched);
      yield* TestClock.adjust(0);
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);
      yield* TestClock.adjust(1999);
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);
      expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
      f.t3.threads.renameDisposition = undefined;
      yield* TestClock.adjust(1);

      // Act
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);

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
      const dispatched = f.t3.threads.nextRename();
      assert((yield* f.factory.renameRun(worker.runId, { title: "Denied" })).ok);
      const sent = yield* Effect.promise(() => dispatched);
      yield* TestClock.adjust(0);
      f.t3.threads.renameDisposition = undefined;
      yield* TestClock.adjust(120_000);
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);
      expect(f.t3.threads.renames).toStrictEqual([sent]);
      f.t3.connection.approve("replacement");
      assert((yield* f.factory.recheckConnection()).ok);

      // Act
      assert((yield* f.factory.renameRun(worker.runId, { title: "After approval" })).ok);

      // Assert
      yield* f.factory.reconcileRuns();
      yield* TestClock.adjust(0);
      expect(f.t3.threads.renames).toStrictEqual([sent]);
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("F#1 Entry worker · Improve search");
    }),
);

it.effect("restart and unrelated launches proceed while multiple worker renames time out", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c, fanOutFlow);
    const [worker] = yield* Effect.promise(() => twoWorkersStarted(f.world, f.input));
    f.t3.contract.support.rename = false;
    assert((yield* f.factory.renameRun(worker.runId, { title: "Pending" })).ok);
    yield* f.close;
    f.t3.contract.support.rename = true;
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.t3.threads.afterRename = () => waiting;
    const first = f.t3.threads.nextRename();

    // Act
    const reopened = yield* f.reopen;
    yield* Effect.promise(() => first);
    const next = yield* reopened.startRun({ ...f.input, requestId: "another" });
    assert(next.ok);
    yield* reopened.reconcileRuns();

    // Assert
    expect(f.t3.threads.launches.size).toBe(4);
    yield* TestClock.adjust(30_000);
    release();
    expect(f.t3.threads.renames).toHaveLength(2);
  }),
);

it.effect("a refused retry preserves uncertainty from a dispatched rename", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c);
    const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
    f.t3.threads.loseRenameReply = true;
    const first = f.t3.threads.nextRename();
    assert((yield* f.factory.renameRun(worker.runId, { title: "Intermediate" })).ok);
    yield* Effect.promise(() => first);
    yield* TestClock.adjust(1000);
    f.t3.threads.beforeRename = async () => {
      f.t3.contract.support.rename = false;
      await f.world.factory.recheckConnection();
    };
    yield* f.factory.reconcileRuns();
    yield* TestClock.adjust(0);
    expect(f.t3.contract.support.rename).toBe(false);
    delete f.t3.threads.beforeRename;
    f.t3.threads.loseRenameReply = false;

    // Act
    assert((yield* f.factory.renameRun(worker.runId, { title: f.input.title })).ok);
    f.t3.contract.support.rename = true;
    yield* f.factory.reconcileRuns();
    yield* TestClock.adjust(0);

    // Assert
    expect(f.t3.threads.renames.map((request) => request.title)).toStrictEqual([
      "F#1 Entry worker · Intermediate",
      "F#1 Entry worker · Improve search",
    ]);
  }),
);

it.effect("an acknowledgement satisfies a newer revision with the same rendered title", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c);
    const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
    const prefix = "a".repeat(299);
    const { sent, release } = yield* Effect.promise(() =>
      heldWorkerRename(f.world, worker.runId, prefix + "b"),
    );
    assert((yield* f.factory.renameRun(worker.runId, { title: prefix + "c" })).ok);

    // Act
    release();
    yield* TestClock.adjust(60_000);

    // Assert
    yield* f.factory.reconcileRuns();
    yield* TestClock.adjust(0);
    expect(f.t3.threads.renames).toStrictEqual([sent]);
  }),
);
