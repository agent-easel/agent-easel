import type { Result, RunSettlementOutcome, RunSettlementWorker } from "@t3-factory/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type { T3Adapter, T3ContractSnapshot } from "../adapters/t3.ts";
import { NO_T3_SUPPORT } from "../adapters/t3-contract.ts";
import type { ContractSnapshots } from "../connection.ts";
import { failure } from "../result.ts";
import { threadHref } from "../thread-link.ts";
import type { BoundWorker, RunStore, SettlementWorkerRecord } from "./run-store/run-store.ts";
import { runTarget, type RunnerLifecycle, type RunRow } from "./runner-types.ts";
import { recoverOperation } from "./runner-effects.ts";
import { fingerprint } from "../fingerprint.ts";
import { readWorkerThread, type WorkerThread } from "./worker-thread.ts";
import type { OwnedThreads } from "./owned-thread.ts";

/** How long a worker whose Stop T3 acknowledged may stay unfinished before it is unresolved. */
const STOP_CONFIRMATION_MS = 30_000;

/** A fresh, correctly scoped read of a bound worker thread for manual settlement. */
type SettlementRead =
  | {
      readonly finished: true;
      readonly latest: WorkerThread["latest"];
      readonly recentRuns: WorkerThread["thread"]["recentRuns"];
    }
  | {
      readonly finished: false;
      readonly latest: WorkerThread["latest"];
      /** Whether confirmed settlement stops the thread: false when T3 could not show it in the
       * Run's scope, which Factory never stops, or when only queued work keeps it unfinished. */
      readonly stoppable: boolean;
      readonly problem: string;
    };

const UNREADABLE: SettlementRead = {
  finished: false,
  latest: null,
  stoppable: false,
  problem: "T3 could not show this worker thread in the Run's project and workspace.",
};
const CONTEXT_UNAVAILABLE: SettlementRead = {
  finished: false,
  latest: null,
  stoppable: false,
  problem: "The T3 connection is unavailable or its authorization changed.",
};
/** The snapshot of a pass with no worker thread to read, which asks T3 nothing. */
const UNREAD_SNAPSHOT: T3ContractSnapshot = {
  contextId: null,
  answered: false,
  support: NO_T3_SUPPORT,
};

/** What still keeps an unfinished worker thread from counting as finished. */
function blocker(worker: WorkerThread) {
  const { thread } = worker;
  if (thread.activeRunId) return "T3 shows a run in progress.";
  if (thread.pendingRequestCount > 0) return "A native request is waiting in T3.";
  if (thread.recentRuns.some((run) => run.status === "queued"))
    return "T3 holds a queued run for this thread; remove it in T3 or let it run.";
  if (!worker.latest) return "T3 shows no run for this thread yet.";
  return "T3 has not confirmed that its delegated or background work settled.";
}

/** A worker's progress in the current attempt from its fresh read and its Stop record. */
function progress(read: SettlementRead, stop: SettlementWorkerRecord | undefined, time: number) {
  if (read.finished) return { state: "finished" as const, problem: null };
  if (stop?.stop_outcome === "acknowledged") {
    const waited = time - Date.parse(stop.stop_requested_at ?? "");
    return waited < STOP_CONFIRMATION_MS
      ? { state: "stopping" as const, problem: read.problem }
      : { state: "unresolved" as const, problem: `T3 acknowledged Stop, but ${read.problem}` };
  }
  if (stop?.stop_outcome) return { state: "unresolved" as const, problem: stop.stop_problem };
  if (stop?.stop_key)
    return {
      state: "unresolved" as const,
      problem: "Factory restarted while requesting Stop, so its outcome is unknown.",
    };
  return { state: "unresolved" as const, problem: read.problem };
}

export function openRunnerSettle(
  store: RunStore,
  t3: T3Adapter,
  lifecycle: RunnerLifecycle,
  freshSnapshot: ContractSnapshots["fresh"],
  ownedThreads: OwnedThreads,
) {
  /** A worker thread T3 cannot read now keeps the Run Active until a later sweep. */
  function threadsFinished(run: RunRow, threads: readonly string[]) {
    return recoverOperation(
      Effect.gen(function* () {
        for (const thread of threads)
          if (!(yield* Effect.tryPromise(() => readWorkerThread(t3, run, thread))).finished)
            return false;
        return true;
      }),
      () => Effect.succeed(false),
    );
  }

  /** Automatic settlement: every visited Block has its result, nothing is pending locally, no Human
   * occurrence is open and a fresh read finds every worker thread finished. */
  function settleWhenDone(id: string) {
    return Effect.gen(function* () {
      const run = yield* store.readRun(id);
      if (!run || run.archived_at || run.settled_at || !run.gate_open) return;
      const threads = yield* store.reportedBlockThreads(run.id);
      if (!threads || !(yield* threadsFinished(run, threads))) return;
      const snapshot = yield* freshSnapshot();
      if (snapshot.contextId !== run.context_id) return;
      if (yield* store.settleAutomatically(run))
        yield* settleWorkerThreads(run, Effect.succeed(snapshot));
    });
  }

  const ownerOf = (run: RunRow) => ({ target: runTarget(run), contextId: run.context_id });

  /** Settles worker threads whose Blocks already have a confirmed finished result while the Run continues. */
  function settleFinishedBlockThreads(id: string) {
    return Effect.gen(function* () {
      const run = yield* store.readRun(id);
      if (!run || run.archived_at) return;
      const candidates = yield* store.threadSettlementCandidates(run.id);
      if (!candidates.length) return;
      const settle = ownedThreads.settler(ownerOf(run), yield* freshSnapshot());
      if (!settle) return;
      for (const candidate of candidates) {
        const ready = yield* recoverOperation(
          Effect.tryPromise(async () => {
            const worker = await readWorkerThread(t3, run, candidate.thread_id);
            return worker.finished && worker.latest?.runId === candidate.execution_id;
          }),
          () => Effect.succeed(false),
        );
        if (!ready) continue;
        yield* settle({
          threadId: candidate.thread_id,
          claim: store.claimBlockThreadSettlement(run, candidate),
        });
      }
    });
  }

  /** Best-effort native organization of a Settled Run's worker threads. A possibly issued
   * settlement is never replayed for the same run of a thread, so a manual reopen in T3 is
   * preserved; Factory never unsettles. `snapshot` is taken only when there is a thread. */
  function settleWorkerThreads(run: RunRow, snapshot: Effect.Effect<T3ContractSnapshot, unknown>) {
    return Effect.gen(function* () {
      const threads = yield* store.settledRunThreads(run.id);
      if (!threads.length) return;
      const settle = ownedThreads.settler(ownerOf(run), yield* snapshot);
      if (!settle) return;
      for (const thread of threads)
        yield* settle({
          threadId: thread.thread_id,
          claim: store.claimSettledRunThreadSettlement(run, thread.thread_id, thread.execution_id),
        });
    });
  }

  /** The run Stop is judged by. T3 makes a queued run the thread's latest, and that run's wait
   * never settles while it waits, so a thread with no active run or native request whose latest
   * run is queued is judged, as T3's own Stop targets it, by its latest run that is not queued;
   * null when it has none. Otherwise the active or latest run. */
  function judgedRun({ thread, latest }: WorkerThread) {
    if (thread.activeRunId || thread.pendingRequestCount > 0 || latest?.status !== "queued")
      return latest;
    return thread.recentRuns
      .filter((entry) => entry.status !== "queued")
      .reduce<WorkerThread["latest"]>(
        (best, entry) => (!best || (entry.ordinal ?? 0) >= (best.ordinal ?? 0) ? entry : best),
        null,
      );
  }

  /** Factory's completion rule, plus no queued run, read in the Run's project and workspace. A
   * thread whose judged run and its delegated work settled is unfinished only by queued work,
   * which Stop would not end: it is not stopped. */
  function readForSettlement(run: RunRow, threadId: string) {
    return recoverOperation(
      Effect.tryPromise(async (): Promise<SettlementRead> => {
        const worker = await readWorkerThread(t3, run, threadId);
        const queued = worker.thread.recentRuns.some((entry) => entry.status === "queued");
        if (worker.finished && !queued)
          return { finished: true, latest: worker.latest, recentRuns: worker.thread.recentRuns };
        const judged = judgedRun(worker);
        const stoppable =
          judged === worker.latest
            ? !worker.finished
            : !!judged &&
              (await t3.readDelegatedSettlement(runTarget(run), threadId, judged.runId)).state !==
                "settled";
        return { finished: false, latest: judged, stoppable, problem: blocker(worker) };
      }),
      () => Effect.succeed(UNREADABLE),
    );
  }

  /** The pass's T3 contract snapshot, taken only when the pass has worker threads to read. */
  function passSnapshot(workers: readonly BoundWorker[]) {
    return workers.length ? freshSnapshot() : Effect.succeed(UNREAD_SNAPSHOT);
  }

  /** Fresh reads of every bound worker, under the Run's live authorization context. */
  function readWorkers(run: RunRow, workers: readonly BoundWorker[], snapshot: T3ContractSnapshot) {
    return Effect.gen(function* () {
      const live = snapshot.contextId === run.context_id;
      const reads = new Map<string, SettlementRead>();
      for (const worker of workers)
        reads.set(
          worker.thread_id,
          live ? yield* readForSettlement(run, worker.thread_id) : CONTEXT_UNAVAILABLE,
        );
      return reads;
    });
  }

  /** One T3 thread Stop per unfinished worker of the attempt, each recorded before it is sent,
   * only when the pass's snapshot supports Stop and under the Run's live authorization context,
   * rechecked for every Stop. A recheck T3 cannot answer records nothing, so a later pass can
   * still stop that worker. Stop is thread-scoped, covers delegated work and has no run fence. */
  function requestStops(
    run: RunRow,
    attempt: number,
    workers: readonly BoundWorker[],
    reads: ReadonlyMap<string, SettlementRead>,
    snapshot: T3ContractSnapshot,
  ) {
    return Effect.gen(function* () {
      const support = snapshot.support.stop;
      for (const worker of workers) {
        if (!support.supported) {
          yield* store.recordStopOutcome(
            run,
            attempt,
            worker,
            "unsupported",
            `T3 cannot stop worker threads: ${support.explanation}`,
          );
          continue;
        }
        const recheck = yield* freshSnapshot();
        if (!recheck.answered) continue;
        if (recheck.contextId !== run.context_id) {
          yield* store.recordStopOutcome(
            run,
            attempt,
            worker,
            "failed",
            "The T3 connection is unavailable or its authorization changed, so Factory did not request Stop.",
          );
          continue;
        }
        const key = fingerprint(`${run.id}:settle:${attempt}:${worker.thread_id}`);
        const executionId = reads.get(worker.thread_id)?.latest?.runId ?? null;
        if (!(yield* store.claimWorkerStop(run, attempt, worker, { key, executionId }))) continue;
        const sent = yield* recoverOperation(
          Effect.as(
            Effect.tryPromise(() =>
              t3.stopThread(runTarget(run), { threadId: worker.thread_id, clientRequestId: key }),
            ),
            true,
          ),
          () => Effect.succeed(false),
        );
        yield* store.recordStopOutcome(
          run,
          attempt,
          worker,
          sent ? "acknowledged" : "failed",
          sent ? null : "T3 did not accept the Stop request.",
        );
      }
    });
  }

  /** Stops `stops` and reads each again. */
  function stopAndReread(
    run: RunRow,
    attempt: number,
    stops: readonly BoundWorker[],
    reads: Map<string, SettlementRead>,
    snapshot: T3ContractSnapshot,
  ) {
    return Effect.gen(function* () {
      yield* requestStops(run, attempt, stops, reads, snapshot);
      for (const worker of stops)
        reads.set(worker.thread_id, yield* readForSettlement(run, worker.thread_id));
    });
  }

  /** Settles `run` once every bound worker read finished, cancelling its owed work, then
   * best-effort settles its worker threads in T3. */
  function complete(
    run: RunRow,
    workers: readonly BoundWorker[],
    reads: ReadonlyMap<string, SettlementRead>,
  ) {
    return Effect.gen(function* () {
      const settled = yield* store.completeSettlement(
        run,
        workers.map((worker) => {
          const read = reads.get(worker.thread_id)!;
          return {
            blockId: worker.block_id,
            threadId: worker.thread_id,
            latest: read.latest,
            executions: read.finished ? read.recentRuns : [],
          };
        }),
      );
      if (settled)
        yield* lifecycle.fork(
          recoverOperation(
            Effect.flatMap(store.readRun(run.id), (row) =>
              row ? settleWorkerThreads(row, freshSnapshot()) : Effect.void,
            ),
            () => Effect.void,
          ),
        );
      return settled;
    });
  }

  /**
   * One pass of a confirmed manual settlement, in the Run's drive lane. Its gate is already
   * closed. Every bound worker is read fresh; the backend that accepted the attempt stops each
   * stoppable worker once and reads it again. Workers not stoppable yet, such as unreadable
   * ones, keep their Stop eligibility for later passes; a worker bound later by a launch search joins the attempt.
   * Once a pass reads every worker finished and no launch outcome is unresolved, the Run settles; otherwise each
   * worker's progress is recorded, and a worker that cannot be stopped or confirmed stays
   * unresolved until the user retries.
   */
  function advanceSettlement(id: string) {
    return lifecycle.serial(id, () =>
      recoverOperation(
        Effect.gen(function* () {
          const run = yield* store.readRun(id);
          if (!run || run.archived_at || run.settled_at || run.gate_open) return;
          const operation = yield* store.readSettlementAttempt(id);
          if (!operation) return;
          const workers = yield* store.boundWorkers(id);
          const snapshot = yield* passSnapshot(workers);
          const reads = yield* readWorkers(run, workers, snapshot);
          const stoppable = workers.filter((worker) => {
            const read = reads.get(worker.thread_id)!;
            return !read.finished && read.stoppable;
          });
          const stops =
            stoppable.length && (yield* store.claimStopPass(run, operation.attempt))
              ? stoppable
              : operation.owned
                ? stoppable.filter(
                    (worker) =>
                      !operation.workers.some(
                        (record) =>
                          record.thread_id === worker.thread_id &&
                          (record.stop_key !== null || record.stop_outcome !== null),
                      ),
                  )
                : [];
          if (stops.length) yield* stopAndReread(run, operation.attempt, stops, reads, snapshot);
          const launchesResolved = !(yield* store.unresolvedLaunches(id)).length;
          if (
            launchesResolved &&
            workers.every((worker) => reads.get(worker.thread_id)!.finished) &&
            (yield* complete(run, workers, reads))
          )
            return;
          const records = (yield* store.readSettlementAttempt(id))?.workers ?? [];
          const time = yield* Clock.currentTimeMillis;
          yield* store.recordSettlementProgress(
            run,
            operation.attempt,
            workers.map((worker) => ({
              ...worker,
              ...progress(
                reads.get(worker.thread_id)!,
                records.find((record) => record.thread_id === worker.thread_id),
                time,
              ),
            })),
          );
        }),
        () => Effect.void,
      ),
    );
  }

  /** The answer for the Run as it now is, after a confirmed or repeated Settle. */
  function currentOutcome(id: string) {
    return Effect.gen(function* (): Effect.fn.Return<Result<RunSettlementOutcome>, unknown> {
      const detail = yield* lifecycle.getRun(id);
      if (!detail.ok) return detail;
      const run = detail.value;
      if (run.lifecycle === "settled") return { ok: true, value: { outcome: "settled", run } };
      if (run.settlement) return { ok: true, value: { outcome: run.settlement.state, run } };
      return failure("conflict", "The Run changed while Factory settled it. Settle again.");
    });
  }

  /** Settle without authorization to stop: it completes only when fresh reads, in the Run's
   * drive lane, confirm every bound worker finished; otherwise nothing changes. A Run whose
   * known authorization context was replaced is refused. */
  function settleIfFinished(id: string) {
    return lifecycle.serial(id, () =>
      Effect.gen(function* (): Effect.fn.Return<Result<RunSettlementOutcome>, unknown> {
        const run = yield* store.readRun(id);
        if (!run) return failure("not_found", "This Run does not exist.");
        if (run.archived_at || run.settled_at || !run.gate_open) return yield* currentOutcome(id);
        const workers = yield* store.boundWorkers(id);
        const reads = yield* readWorkers(run, workers, yield* passSnapshot(workers));
        // After the reads, which recheck the connection: confirming could never settle this Run.
        const replaced = yield* store.replacedAuthorization(id);
        if (replaced) return replaced;
        const launches = yield* store.unresolvedLaunches(id);
        if (!launches.length && workers.every((worker) => reads.get(worker.thread_id)!.finished)) {
          // A report or answer accepted during the reads makes `complete` refuse; the user retries.
          yield* complete(run, workers, reads);
          return yield* currentOutcome(id);
        }
        const detail = yield* lifecycle.getRun(id);
        if (!detail.ok) return detail;
        return {
          ok: true,
          value: {
            outcome: "confirmation-required",
            run: detail.value,
            workers: [
              ...workers.map((worker): RunSettlementWorker => {
                const read = reads.get(worker.thread_id)!;
                return {
                  blockId: worker.block_id,
                  blockName: worker.name,
                  threadId: worker.thread_id,
                  link: threadHref(worker.link),
                  // Only a worker confirming stops is executing; Factory never stops a thread it
                  // cannot read, or one that only queued work keeps unfinished.
                  state: read.finished ? "finished" : read.stoppable ? "executing" : "unresolved",
                  stopRequestedAt: null,
                  problem: read.finished ? null : read.problem,
                };
              }),
              ...launches,
            ],
          },
        };
      }),
    );
  }

  return {
    settleIfFinished,
    currentOutcome,
    advanceSettlement,
    settleWhenDone,
    settleFinishedBlockThreads,
  };
}

/** The settlement steps the Runner drives and Settle's entry point runs. */
export type RunnerSettlement = ReturnType<typeof openRunnerSettle>;
