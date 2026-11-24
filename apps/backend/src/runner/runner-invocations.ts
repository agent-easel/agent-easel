import * as Effect from "effect/Effect";
import type { ContractSnapshots } from "../connection.ts";
import type { T3ContractSnapshot } from "../t3/contract.ts";
import type { T3Threads } from "../t3/threads.ts";
import { now } from "../time.ts";
import { requestThreadStop } from "./runner-effects.ts";
import { STOP_CONFIRMATION_MS, type SettlementRead } from "./runner-settle.ts";
import type { RunStore } from "./run-store/run-store.ts";
import { runTarget, type RunRow } from "./runner-types.ts";

type Stopping = Effect.Success<ReturnType<RunStore["stoppingInvocations"]>>[number];
type ReadWorker = (run: RunRow, threadId: string) => Effect.Effect<SettlementRead, unknown>;
type StopContext = {
  store: RunStore;
  t3: T3Threads;
  run: RunRow;
  invocation: Stopping;
  snapshot: T3ContractSnapshot;
  readWorker: ReadWorker;
  freshSnapshot: ContractSnapshots["fresh"];
};

function pendingStopProblem(
  stop: { requested_at: string; outcome: "acknowledged" | "failed" | null },
  problem: string,
) {
  return Effect.gen(function* () {
    if (stop.outcome !== "acknowledged") return "T3 Code did not confirm the Stop request.";
    const elapsed = Date.parse(yield* now) - Date.parse(stop.requested_at);
    return elapsed >= STOP_CONFIRMATION_MS ? problem : undefined;
  });
}

function verifyWorkerStop(
  { store, t3, run, invocation, readWorker, freshSnapshot }: StopContext,
  worker: { thread_id: string; block_id: string },
  needsRetry: boolean,
) {
  return Effect.gen(function* (): Effect.fn.Return<string | null | undefined, unknown> {
    const observed = yield* readWorker(run, worker.thread_id);
    if (observed.finished) return null;
    const saved = yield* store.invocationStop(
      run.id,
      invocation,
      worker.thread_id,
      observed.latest?.runId ?? null,
    );
    if (saved) return yield* pendingStopProblem(saved, observed.problem);
    if (needsRetry) return observed.problem;
    if (!observed.stoppable) return observed.problem;
    const current = yield* freshSnapshot();
    if (current.contextId !== run.context_id)
      return "The T3 Code authorization for this Run changed.";
    if (!current.answered) return "T3 Code could not confirm current Stop support.";
    if (!current.support.stop.supported)
      return current.support.stop.explanation ?? observed.problem;
    const key = yield* store.claimInvocationStop(
      run,
      invocation,
      worker,
      observed.latest?.runId ?? null,
    );
    if (!key) return "This worker already has a Stop request from an earlier scope closure.";
    const acknowledged = yield* requestThreadStop(t3, runTarget(run), worker.thread_id, key);
    yield* store.recordInvocationStop(run.id, key, acknowledged ? "acknowledged" : "failed");
    if ((yield* readWorker(run, worker.thread_id)).finished) return null;
    return acknowledged ? undefined : "T3 Code did not accept the Stop request.";
  });
}

function verifyScope(context: StopContext) {
  return Effect.gen(function* () {
    const { store, run, invocation, snapshot } = context;
    const current = yield* store.readRun(run.id);
    if (!current?.gate_open) return;
    if (snapshot.contextId !== run.context_id) {
      yield* store.invocationUnresolved(
        run,
        invocation,
        "The T3 Code authorization for this Run is unavailable.",
      );
      return;
    }
    const { workers, hasUnboundLaunch } = yield* store.invocationWorkers(run.id, invocation.id);
    const needsRetry = yield* store.invocationNeedsRetry(invocation.id);
    const states = yield* Effect.forEach(workers, (worker) =>
      verifyWorkerStop(context, worker, needsRetry),
    );
    const problem =
      states.find((state) => typeof state === "string") ??
      (hasUnboundLaunch ? "A worker launch is still unconfirmed." : null);
    if (problem) yield* store.invocationUnresolved(run, invocation, problem);
    if (!hasUnboundLaunch && states.every((state) => state === null))
      yield* store.completeInvocation(run, invocation, current.generation);
  });
}

export function advanceInvocations(
  store: RunStore,
  t3: T3Threads,
  run: RunRow,
  snapshot: T3ContractSnapshot,
  readWorker: ReadWorker,
  freshSnapshot: ContractSnapshots["fresh"],
) {
  return Effect.gen(function* () {
    for (const invocation of yield* store.stoppingInvocations(run.id))
      yield* verifyScope({ store, t3, run, invocation, snapshot, readWorker, freshSnapshot });
    yield* store.readyToCloseInvocation(run);
  });
}
