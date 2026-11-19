import * as Effect from "effect/Effect";
import type { T3Threads } from "../t3/threads.ts";
import type { Delivery, RunStore } from "./run-store/run-store.ts";
import type { RunRow } from "./runner-types.ts";
import { readWorkerThread } from "./worker-thread.ts";
/** Request report assesses a finished worker thread whose latest run is the one it was asked for. */
export function recoveryReady(t3: T3Threads, run: RunRow, threadId: string, executionId: string) {
  return Effect.tryPromise(async () => {
    const worker = await readWorkerThread(t3, run, threadId);
    return (
      worker.finished &&
      worker.latest?.runId === executionId &&
      worker.latest.status === "completed"
    );
  });
}
export function recoveryDispatchGeneration(
  store: RunStore,
  t3: T3Threads,
  runRow: RunRow,
  intent: Delivery,
) {
  return Effect.gen(function* () {
    if (!intent.cause.startsWith("recovery:") || intent.state !== "pending") return undefined;
    const current = yield* store.readRun(runRow.id);
    if (!current) return null;
    const target = JSON.parse(intent.target_json) as {
      threadId: string;
    };
    const recovery = yield* store.recoverySource(intent.id);
    if (
      !recovery ||
      !(yield* recoveryReady(t3, current, target.threadId, recovery.source_execution_id))
    ) {
      yield* store.noteUnresolved(
        intent,
        "Recovery target has new activity or pending attention; the accepted request remains unsent.",
      );
      return null;
    }
    return current.generation;
  });
}
