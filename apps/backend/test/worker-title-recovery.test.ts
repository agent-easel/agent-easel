import { expiredRenameSession } from "./support/worker-thread-wire.ts";
import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { preparedService } from "./support/prepared-runner.ts";
import {
  fanOutFlow,
  manyEntryWorkers,
  holdRunRenames,
  holdWorkerLaunchReply,
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
      const refusal = yield* Effect.promise(() => expiredRenameSession(c, f.t3.threads));
      const dispatched = f.t3.threads.nextRename();
      assert((yield* f.factory.renameRun(worker.runId, { title: "New subject" })).ok);
      yield* f.factory.awaitWorkerTitles();
      expect(refusal.executed()).toHaveLength(0);
      refusal.restore();
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      const sent = yield* Effect.promise(() => dispatched);
      yield* f.factory.awaitWorkerTitles();
      expect(f.t3.threads.renames).toHaveLength(1);
      yield* f.close;
      yield* TestClock.adjust(60_000);

      const replay = f.t3.threads.nextRename();

      // Act
      const reopened = yield* f.reopen;

      // Assert
      yield* Effect.promise(() => replay);
      yield* reopened.awaitWorkerTitles();
      expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
    }),
);

it.effect("a timed-out rename releases its lane and coalesces unsent revisions", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c);
    const worker = yield* Effect.promise(() => workerAtWork(f.world, f.input));
    const { sent } = yield* Effect.promise(() =>
      heldWorkerRename(f.world, worker.runId, "Intermediate"),
    );
    assert((yield* f.factory.renameRun(worker.runId, { title: "Unsent" })).ok);
    assert((yield* f.factory.renameRun(worker.runId, { title: f.input.title })).ok);
    expect(f.t3.threads.renames).toStrictEqual([sent]);

    // Act
    yield* TestClock.adjust(15_000);

    // Assert
    yield* f.factory.awaitWorkerTitles();
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
      yield* f.factory.awaitWorkerTitles();
      f.t3.threads.loseRenameReply = false;
      f.t3.threads.compactRenameKeys.add(sent.clientRequestId);
      f.t3.threads.remoteTitles.set(worker.threadId, "Edited in T3");
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      yield* f.factory.awaitWorkerTitles();
      yield* TestClock.adjust(60_000);
      yield* f.factory.reconcileRuns();
      yield* f.factory.awaitWorkerTitles();
      expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("Edited in T3");

      // Act
      assert((yield* f.factory.renameRun(worker.runId, { title: f.input.title })).ok);

      // Assert
      yield* f.factory.awaitWorkerTitles();
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
      yield* f.factory.awaitWorkerTitles();
      yield* TestClock.adjust(1000);
      yield* f.factory.reconcileRuns();
      yield* f.factory.awaitWorkerTitles();
      yield* TestClock.adjust(1999);
      yield* f.factory.reconcileRuns();
      yield* f.factory.awaitWorkerTitles();
      expect(f.t3.threads.renames).toStrictEqual([sent, sent]);
      f.t3.threads.renameDisposition = undefined;
      yield* TestClock.adjust(1);

      // Act
      yield* f.factory.reconcileRuns();

      // Assert
      yield* f.factory.awaitWorkerTitles();
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
      yield* f.factory.awaitWorkerTitles();
      f.t3.threads.renameDisposition = undefined;
      yield* TestClock.adjust(120_000);
      yield* f.factory.reconcileRuns();
      yield* f.factory.awaitWorkerTitles();
      expect(f.t3.threads.renames).toStrictEqual([sent]);
      f.t3.connection.approve("replacement");
      assert((yield* f.factory.recheckConnection()).ok);

      // Act
      assert((yield* f.factory.renameRun(worker.runId, { title: "After approval" })).ok);

      // Assert
      yield* f.factory.awaitWorkerTitles();
      expect(f.t3.threads.renames).toStrictEqual([sent]);
      expect(f.t3.threads.threadTitle(worker.threadId)).toBe("F#1 Entry worker · Improve search");
    }),
);

it.effect("an unrelated Run starts while worker renames recovered on restart are blocked", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c, fanOutFlow);
    const [worker] = yield* Effect.promise(() => twoWorkersStarted(f.world, f.input));
    f.t3.contract.support.rename = false;
    assert((yield* f.factory.renameRun(worker.runId, { title: "Pending" })).ok);
    yield* f.close;
    f.t3.contract.support.rename = true;
    const waiting = new Promise<void>(() => {});
    f.t3.threads.afterRename = () => waiting;
    const first = f.t3.threads.nextRename();

    const reopened = yield* f.reopen;
    yield* Effect.promise(() => first);

    // Act
    const next = yield* reopened.startRun({ ...f.input, requestId: "another" });

    // Assert
    assert(next.ok);
    yield* Effect.promise(() => expect.poll(() => f.t3.threads.launches.size).toBe(4));
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
    yield* f.factory.awaitWorkerTitles();
    const refusal = yield* Effect.promise(() => expiredRenameSession(c, f.t3.threads));
    yield* TestClock.adjust(1000);
    yield* f.factory.reconcileRuns();
    yield* f.factory.awaitWorkerTitles();
    expect(refusal.executed()).toHaveLength(0);
    refusal.restore();
    f.t3.threads.loseRenameReply = false;
    yield* f.close;
    const reopened = yield* f.reopen;

    // Act
    assert((yield* reopened.renameRun(worker.runId, { title: f.input.title })).ok);

    // Assert
    yield* reopened.awaitWorkerTitles();
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

    // Assert
    yield* f.factory.awaitWorkerTitles();
    expect(f.t3.threads.renames).toStrictEqual([sent]);
  }),
);

it.effect("a later Run renames its worker while an earlier Run still has blocked workers", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c, manyEntryWorkers);
    const early = yield* f.factory.startRun(f.input);
    const later = yield* f.factory.startRun({ ...f.input, requestId: "later" });
    assert(early.ok && later.ok);
    yield* f.factory.reconcileRuns();
    expect(f.t3.threads.launchCalls).toBe(24);
    const held = holdRunRenames(f.world, "F#1 ", 4);
    c.onTestFinished(held.release);
    assert((yield* f.factory.renameRun(early.value.id, { title: "Blocked" })).ok);
    yield* Effect.promise(() => held.reached);
    const updated = f.t3.threads.nextRename();

    // Act
    assert((yield* f.factory.renameRun(later.value.id, { title: "Healthy" })).ok);

    // Assert
    expect((yield* Effect.promise(() => updated)).title).toContain("Healthy");
    expect(held.count()).toBe(4);
  }),
);

it.effect("a newly bound worker renames while its sibling's rename reply is held", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* preparedService(c, fanOutFlow);
    const launch = holdWorkerLaunchReply(f.t3, "F#1 Second entry · Improve search");
    c.onTestFinished(launch.release);
    const started = yield* f.factory.startRun(f.input);
    assert(started.ok);
    const { threadId } = yield* Effect.promise(() => launch.reached);
    const run = yield* f.factory.getRun(started.value.id);
    assert(run.ok);
    const sibling = run.value.blocks.find((block) => block.blockId === "worker")?.threadId;
    assert(sibling);
    const releaseSibling = f.t3.threads.holdRenameReply();
    c.onTestFinished(releaseSibling);
    const first = f.t3.threads.nextRename();
    assert((yield* f.factory.renameRun(started.value.id, { title: "Updated" })).ok);
    const sent = yield* Effect.promise(() => first);
    expect(sent.threadId).toBe(sibling);
    const idle = yield* Effect.forkChild(f.factory.awaitWorkerTitles(), { startImmediately: true });

    // Act
    launch.release();

    // Assert
    yield* Effect.promise(() =>
      expect.poll(() => f.t3.threads.threadTitle(threadId)).toBe("F#1 Second entry · Updated"),
    );
    expect(f.t3.threads.renames).toStrictEqual([
      sent,
      expect.objectContaining({ threadId, title: "F#1 Second entry · Updated" }),
    ]);
    expect(idle.pollUnsafe()).toBeUndefined();
  }),
);
