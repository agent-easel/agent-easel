import * as Effect from "effect/Effect";
import type { ContractSnapshots } from "../connection.ts";
import type { T3Threads } from "../t3/threads.ts";
import type { RunStore } from "./run-store/run-store.ts";

function syncOnce(
  store: RunStore,
  t3: T3Threads,
  freshSnapshot: ContractSnapshots["fresh"],
  runId: string,
): Effect.Effect<boolean, unknown> {
  return Effect.gen(function* () {
    const due = yield* store.dueWorkerTitleSyncs(runId);
    if (!due.length) return false;
    const snapshot = yield* freshSnapshot();
    let sent = false;
    for (const item of due) {
      if (
        !snapshot.answered ||
        snapshot.contextId !== item.context_id ||
        !snapshot.support.rename.supported
      )
        continue;
      const claimed = yield* store.claimWorkerTitleSync(runId, item.id, item.context_id);
      if (!claimed) continue;
      const disposition = yield* Effect.promise(() =>
        t3
          .renameThread(
            { endpoint: claimed.endpoint },
            {
              threadId: claimed.threadId,
              title: claimed.title,
              clientRequestId: claimed.requestId,
              ...(snapshot.support.rename.includeEnvironmentId
                ? { environmentId: claimed.environmentId }
                : {}),
            },
          )
          .catch(() => ({ kind: "unavailable" as const })),
      );
      yield* store.recordWorkerTitleSync(claimed, disposition.kind);
      sent = true;
    }
    return sent;
  });
}

export function syncWorkerTitles(
  store: RunStore,
  t3: T3Threads,
  freshSnapshot: ContractSnapshots["fresh"],
  runId: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    let sent = true;
    while (sent) sent = yield* syncOnce(store, t3, freshSnapshot, runId);
  });
}
