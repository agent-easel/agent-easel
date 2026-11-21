import * as Effect from "effect/Effect";
import type { ExecutionObservation, T3Threads } from "../t3/threads.ts";
import {
  passedThrough,
  type Delivery,
  type Handoff,
  type RunStore,
} from "./run-store/run-store.ts";
import type { RunRow } from "./runner-types.ts";
import { awaitingBackgroundWork, readWorkerThread } from "./worker-thread.ts";

/** The Handoff release rule's answer for a Handoff, or for the delivery it became. */
export type Release =
  | { readonly state: "held" }
  /** Its Final result version is released. `run` is the Run as read; what the release allows must
   * still find `run.generation`. */
  | { readonly state: "released"; readonly run: RunRow }
  /** A Human answer, Wait forwarding, Condition selection or pass-through released it, and no
   * later record undoes that. A Human occurrence, Wait arrival or Condition arrival is recorded
   * from it without a generation guard; every other transition still requires `run.generation`. */
  | { readonly state: "durable"; readonly run: RunRow };

/** A delivery the release rule does not hold at reservation: no Handoff prepared it, or it was
 * already reserved once. */
type Ungated = { readonly state: "ungated" };

const held: Release = { state: "held" };

/** What releases a Handoff: a Final result version (an Agent's result or a Continuation's
 * response), or a durable Human answer, Wait forwarding, Condition selection or pass-through. A delivery no Handoff
 * prepared (an entry launch, a Request report or a recovery send) has no source. */
type Source =
  | { readonly kind: "result"; readonly reportId: string }
  | { readonly kind: "direct" }
  | { readonly kind: "committed" }
  | { readonly kind: "none" };

function sourceOf(record: Handoff | Delivery): Source {
  if (record.cause.startsWith("start:") || record.cause.startsWith("subflow:"))
    return { kind: "committed" };
  if (record.report_id) return { kind: "result", reportId: record.report_id };
  if (
    record.occurrence_id ||
    record.wait_arrival_id ||
    record.condition_arrival_id ||
    passedThrough(record)
  )
    return { kind: "direct" };
  return { kind: "none" };
}

/** A thread T3 shows with no run and no native request has no earlier turn to wait for, as an idle
 * worker prepared before Factory stopped preparing them, whose first visit is a queued send. */
const neverRan = (thread: ExecutionObservation) =>
  !thread.activeRunId &&
  !thread.latestRunId &&
  thread.recentRuns.length === 0 &&
  thread.pendingRequestCount === 0 &&
  !awaitingBackgroundWork(thread);

/** Asks the Handoff release rule for one Final result version. The Run store answers what the
 * release still waits for and applies the local part; this reads the T3 part, whether the source
 * worker thread is finished, at `run`'s generation. A replaced version is never released. */
function releaseResult(store: RunStore, t3: T3Threads, run: RunRow, reportId: string) {
  return Effect.gen(function* () {
    const wait = yield* store.releaseWait(run, reportId);
    if (wait.released) return true;
    const threadId = wait.sourceThreadId;
    if (!threadId) return false;
    const worker = yield* Effect.tryPromise(() => readWorkerThread(t3, run, threadId));
    if (!worker.finished) return false;
    return yield* store.releaseFinalResult(run, reportId);
  });
}

/** The release rule before a Handoff becomes a delivery, an occurrence or an arrival: the Run's
 * gate is open and the Handoff's source is released. Held Handoffs stay Handoffs, so a held arrival
 * creates no activation; reservation asks again. */
export function releaseAtPreparation(
  store: RunStore,
  t3: T3Threads,
  run: RunRow,
  record: Handoff | Delivery,
) {
  return Effect.gen(function* (): Effect.fn.Return<Release, unknown> {
    const current = yield* store.readRun(run.id);
    if (!current?.gate_open) return held;
    const source = sourceOf(record);
    switch (source.kind) {
      case "result":
        return (yield* releaseResult(store, t3, current, source.reportId))
          ? { state: "released", run: current }
          : held;
      case "direct":
        return (yield* store.directSourceReleased(run.id, record))
          ? { state: "durable", run: current }
          : held;
      case "committed":
        return { state: "durable", run: current };
      case "none":
        return held;
    }
  });
}

/** A revisit waits until the recipient's previous activation has its current Final result
 * released. */
export function previousVisitReleased(
  store: RunStore,
  t3: T3Threads,
  current: RunRow,
  previous: { readonly result_id: string | null },
) {
  return previous.result_id
    ? releaseResult(store, t3, current, previous.result_id)
    : Effect.succeed(false);
}

/** The release rule again when a pending send from a Handoff is reserved, since T3 calls or a
 * restart may intervene after preparation. The revisit's recipient thread must also owe no other
 * Block's task and be finished, or never have run. */
export function releaseAtReservation(store: RunStore, t3: T3Threads, run: RunRow, send: Delivery) {
  return Effect.gen(function* (): Effect.fn.Return<Release | Ungated, unknown> {
    if (send.state !== "pending" || sourceOf(send).kind === "none") return { state: "ungated" };
    const release = yield* releaseAtPreparation(store, t3, run, send);
    if (release.state === "held") return release;
    const { threadId } = JSON.parse(send.target_json) as { threadId: string };
    if (yield* store.threadOwesOtherTask(run.id, threadId, send.block_id)) return held;
    const recipient = yield* Effect.tryPromise(() => readWorkerThread(t3, release.run, threadId));
    return recipient.finished || neverRan(recipient.thread) ? release : held;
  });
}

/** Releases each Continuation result whose worker thread is finished, so its response is
 * forwarded even when no Handoff asks for the release. */
export function releaseContinuationResults(store: RunStore, t3: T3Threads, run: RunRow) {
  return Effect.gen(function* () {
    for (const reportId of yield* store.heldContinuationResults(run.id)) {
      const current = yield* store.readRun(run.id);
      if (!current?.gate_open) return;
      yield* releaseResult(store, t3, current, reportId);
    }
  });
}
