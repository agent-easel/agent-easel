import { openBlockTools } from "./runner-block-tools.ts";
import { settleRecoveries } from "./runner-recovery-settlement.ts";
import { releaseContinuationResults } from "./handoff-release.ts";
import { openRunNavigation } from "./run-navigation.ts";
import type { FactoryOperations, Result } from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Semaphore from "effect/Semaphore";
import type { EffectOperations } from "../effect-operations.ts";
import type { GitAdapter } from "../adapters/git.ts";
import type { T3Adapter, T3ContractSnapshot } from "../adapters/t3.ts";
import type { ContractSnapshots } from "../connection.ts";
import { failure } from "../result.ts";
import type { BlockRow, RunnerOptions, RunRow } from "./runner-types.ts";
import { openRunStore, queryPageLimit } from "./run-store/run-store.ts";
import { openRunnerDispatch } from "./runner-dispatch.ts";
import { openRunnerStart, type StartAuthorization } from "./runner-start.ts";
import { openRunnerSettle } from "./runner-settle.ts";
import { openRunActions } from "./run-actions.ts";
import { openOwnedThreads } from "./owned-thread.ts";
import { makeRunLanes } from "./runner-lanes.ts";
import { recoverOperation } from "./runner-effects.ts";
import { bindRunWorkspace } from "./run-workspace-binding.ts";
import { readWorkerThread } from "./worker-thread.ts";
import { makeWaitTimers } from "./runner-wait-timers.ts";
import type { LiveChanges } from "../live-changes.ts";
import type { RunImages } from "../run-images.ts";
import type { RunnerTitleGeneration } from "../run-titles.ts";

/** One scoped Runner owner. Accepted work drains before SQL and ownership are released. */
export const makeRunner = Effect.fn("Runner.make")(function* (
  ops: EffectOperations<FactoryOperations>,
  freshSnapshot: ContractSnapshots["fresh"],
  /** The Project catalog reconciled under the latest connection check, without checking again. */
  refreshProjects: EffectOperations<FactoryOperations>["recheckProjects"],
  t3: T3Adapter,
  git: GitAdapter,
  owner: { token: string },
  intervalMs: number,
  checkAgent: RunnerOptions["checkAgent"],
  changes: LiveChanges,
  images: RunImages,
  titles: RunnerTitleGeneration,
) {
  const scope = yield* Effect.scope;
  const store = yield* openRunStore(owner, changes);
  const { readRun: row, getRun, listAttention } = store;
  let closed = false;
  const starts = Semaphore.makeUnsafe(1);
  const sweeps = Semaphore.makeUnsafe(1);
  const closing = Semaphore.makeUnsafe(1);
  const drives = makeRunLanes();
  const detached = new Set<Fiber.Fiber<unknown, unknown>>();
  let timer: Fiber.Fiber<never, unknown> | undefined;
  const fork = Effect.fn("Runner.fork")(function* (work: Effect.Effect<unknown, unknown>) {
    if (closed) return;
    const fiber = yield* Effect.forkIn(work.pipe(Effect.uninterruptible), scope);
    detached.add(fiber);
    fiber.addObserver(() => detached.delete(fiber));
  });
  const lifecycle = { isClosed: () => closed, drive, fork, getRun, serial: drives.serial };
  const waitTimers = makeWaitTimers(scope, (runId) => fork(drive(runId, "dispatch")));
  const titleDeadlines = makeWaitTimers(scope, (runId) =>
    fork(titles.reconcileTitleGeneration(runId)),
  );
  /** A Run title generation runs beside its Run: its first step now, and a wake-up at its deadline. */
  const followTitleGeneration = (runId: string) =>
    Effect.gen(function* () {
      yield* Effect.forEach(yield* titles.pendingTitleDeadlines(runId), titleDeadlines.schedule, {
        discard: true,
      });
      yield* fork(titles.reconcileTitleGeneration(runId));
    });
  const { dispatchIntent } = openRunnerDispatch(
    store,
    ops,
    t3,
    checkAgent,
    observe,
    images,
    waitTimers.schedule,
  );
  const { start, startText, startBlockers } = openRunnerStart(
    store,
    ops,
    freshSnapshot,
    refreshProjects,
    git,
    lifecycle,
    checkAgent,
    titles.planTitleGeneration,
    followTitleGeneration,
    images,
  );
  const ownedThreads = openOwnedThreads(t3);
  const settlement = openRunnerSettle(store, t3, lifecycle, freshSnapshot, ownedThreads);
  const { settleWhenDone, settleFinishedBlockThreads, advanceSettlement } = settlement;
  const actions = openRunActions({
    store,
    t3,
    ownedThreads,
    lifecycle,
    freshSnapshot,
    cancelWaitTimer: waitTimers.cancel,
    settlement,
    reconcileTitleGeneration: titles.reconcileTitleGeneration,
  });

  /** Observes a Block's worker thread and derives its execution failure, missing report and
   * native-request attention from the shared thread-finished rule. */
  function observe(runRow: RunRow, block: BlockRow, contextId: string | null) {
    return recoverOperation(
      Effect.gen(function* () {
        if (contextId !== runRow.context_id) throw Error("Authorization context changed.");
        const before = yield* store.readRun(runRow.id);
        const bound = !!before && (yield* bindRunWorkspace(store, t3, before));
        const run = bound ? yield* store.readRun(runRow.id) : before;
        const current = yield* store.readBlock(runRow.id, block.block_id);
        if (!run || !current?.thread_id) return;
        const worker = yield* Effect.tryPromise(() =>
          readWorkerThread(t3, run, current.thread_id!),
        );
        yield* store.recordWorkerObservation(run, current, worker);
      }),
      () => store.markObservationUnavailable(runRow, block.block_id),
    );
  }
  function drive(
    id: string,
    phase: "observe" | "dispatch" | "both" = "both",
  ): Effect.Effect<void, unknown> {
    return drives.serial(id, () => driveWork(id, phase));
  }
  function driveWork(id: string, phase: "observe" | "dispatch" | "both") {
    return Effect.gen(function* () {
      const runRow = yield* row(id);
      if (!runRow || runRow.archived_at) return;
      yield* driveBlockWork(runRow, yield* freshSnapshot(), phase);
    });
  }
  function driveBlockWork(
    runRow: RunRow,
    snapshot: T3ContractSnapshot,
    phase: "observe" | "dispatch" | "both",
  ) {
    return Effect.gen(function* () {
      const id = runRow.id;
      const blocks = yield* store.blocksWithWorkers(id);
      if (runRow.gate_open && phase !== "dispatch")
        for (const block of blocks) yield* observe((yield* row(id))!, block, snapshot.contextId);
      yield* settleRecoveries(store, lifecycle, t3, id);
      if (phase === "observe") return;
      yield* forwardDueWaits(id);
      yield* releaseContinuationResults(store, t3, (yield* row(id)) ?? runRow);
      const observed = (yield* row(id)) ?? runRow;
      yield* dispatchIntents(observed, snapshot);
      // Binding the Run worktree during dispatch records the launches that join it.
      const current = yield* row(id);
      if (preparing(observed) && current && !preparing(current))
        yield* dispatchIntents(current, snapshot);
    });
  }
  /** Forwards every arrival whose deadline passed, before the pass dispatches its Handoffs. */
  function forwardDueWaits(runId: string) {
    return Effect.gen(function* () {
      for (const arrival of yield* store.dueWaitArrivals(runId))
        yield* store.forwardWaitArrival(runId, arrival.id, "timer");
    });
  }
  function dispatchIntents(runRow: RunRow, snapshot: T3ContractSnapshot) {
    return Effect.gen(function* () {
      for (const work of yield* store.dispatchable(runRow)) {
        if (closed) break;
        yield* dispatchIntent(runRow, work, snapshot);
      }
    });
  }
  const preparing = ({ workspace }: RunRow) =>
    workspace.mode === "worktree" && workspace.state === "preparing";
  const reconcileRuns = Effect.fn("Runner.reconcile")(function* (): Effect.fn.Return<
    Result<void>,
    unknown
  > {
    if (closed) return failure("conflict", "Factory is shutting down.");
    return yield* sweeps
      .withPermit(
        Effect.gen(function* () {
          if (closed) return failure("conflict", "Factory is shutting down.");
          // A Settled Run is driven only while it still owes an operation, so its work continues.
          const ids = yield* store.runsToReconcile();
          // Restart observes every Run before dispatching any pending intent.
          yield* Effect.forEach(ids, (run) => drive(run.id, "observe"), {
            concurrency: "unbounded",
          });
          yield* Effect.forEach(ids, (run) => settleFinishedBlockThreads(run.id), {
            concurrency: "unbounded",
          });
          yield* Effect.forEach(ids, (run) => drive(run.id, "dispatch"), {
            concurrency: "unbounded",
          });
          yield* Effect.forEach(ids, (run) => settleWhenDone(run.id), {
            concurrency: "unbounded",
          });
          // A confirmed manual settlement holds its Run's gate closed until it settles.
          const settling = yield* store.runsWithSettlement(ids.map((run) => run.id));
          yield* Effect.forEach(settling, (run) => advanceSettlement(run.run_id), {
            concurrency: "unbounded",
          });
          // Title generations run beside their Runs, also Archived ones still owing cleanup.
          yield* titles.reconcileTitleGenerations();
          // Include dispatches queued by reports while the sweep observed its Runs' workers.
          yield* drives.drain(ids.map((run) => run.id));
          return { ok: true as const, value: undefined };
        }),
      )
      .pipe(Effect.uninterruptible);
  });
  const close = () =>
    closing
      .withPermit(
        Effect.gen(function* () {
          if (closed) return;
          closed = true;
          if (timer) yield* Fiber.interrupt(timer);
          yield* waitTimers.close();
          yield* titleDeadlines.close();
          yield* starts.withPermit(Effect.void);
          yield* sweeps.withPermit(Effect.void);
          yield* Fiber.awaitAll(detached);
          yield* drives.drain();
          yield* store.drain();
        }),
      )
      .pipe(Effect.uninterruptible);
  yield* Effect.addFinalizer(close);
  return {
    ...actions,
    readFactoryTool: openBlockTools(store, getRun, images),
    ...openRunNavigation(store),
    listRunNavigation: store.listRunNavigation,
    snoozeRun: store.snoozeRun,
    restoreRun: store.restoreRun,
    markRunWokeSeen: store.markRunWokeSeen,
    getRun,
    /** The HTTP Condition evidence read, whose empty query parameters are absent. */
    listConditionArrivals: (runId: string, blockId: string, limit: string, cursor: string) =>
      store.listConditionArrivals(runId, blockId, queryPageLimit(limit), cursor || undefined),
    listAttention,
    getRunCreationPolicy: () =>
      Effect.succeed({ ok: true as const, value: { ready: true as const } }),
    startRun: (input: unknown) => starts.withPermit(start(input)).pipe(Effect.uninterruptible),
    startTextRun: (input: unknown, authorization?: StartAuthorization) =>
      starts.withPermit(startText(input, authorization)).pipe(Effect.uninterruptible),
    startBlockers,
    /** The Run a Start request ID was accepted as; undefined when it was never accepted. */
    acceptedStart: (requestId: string) =>
      Effect.gen(function* () {
        const accepted = yield* store.acceptedStart(requestId);
        return accepted ? yield* getRun(accepted.id) : undefined;
      }),
    /** The Run whose Human occurrence an attributed answer request answered; undefined when it
     * never applied. Another caller's answer to the same occurrence is not this request's. */
    acceptedHumanAnswer: (requestId: string) =>
      Effect.gen(function* () {
        const answered = yield* store.answeredByRequest(requestId);
        return answered ? yield* getRun(answered.run_id) : undefined;
      }),
    /** The Run an attributed Archive request archived; undefined when it never applied. A Run
     * archived by anyone else is not this request's. */
    acceptedArchive: (requestId: string) =>
      Effect.gen(function* () {
        const archived = yield* store.archivedByRequest(requestId);
        return archived ? yield* getRun(archived.id) : undefined;
      }),
    listRuns: (projectId: string) =>
      Effect.gen(function* () {
        const list = yield* actions.listTasks(projectId);
        if (!list.ok) return list;
        return {
          ok: true as const,
          value: list.value.flatMap((task) =>
            task.runs.map((run) => ({
              id: run.id,
              task: { id: task.id, title: task.title, projectId: task.projectId },
              flowId: run.flowId,
              flowName: run.flowName,
              startedAt: run.startedAt,
              lifecycle: run.lifecycle,
            })),
          ),
        };
      }),
    reconcileRuns,
    initialize: () =>
      Effect.gen(function* () {
        yield* store.takeOwnership();
        yield* reconcileRuns();
        yield* Effect.forEach(yield* store.pendingWaits(), waitTimers.schedule, { discard: true });
        yield* Effect.forEach(yield* titles.pendingTitleDeadlines(), titleDeadlines.schedule, {
          discard: true,
        });
        timer = yield* Effect.forkIn(
          Effect.forever(
            Effect.gen(function* () {
              yield* Effect.sleep(intervalMs);
              yield* recoverOperation(reconcileRuns(), () => Effect.void);
            }),
          ),
          scope,
        );
      }),
    close,
  };
});
