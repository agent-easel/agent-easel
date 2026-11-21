import * as Effect from "effect/Effect";
import type { ContractSnapshots } from "../connection.ts";
import type { T3ContractSnapshot } from "../t3/contract.ts";
import type { T3Threads } from "../t3/threads.ts";
import type { RunStore } from "./run-store/run-store.ts";

function canRename(snapshot: T3ContractSnapshot, contextId: string) {
  return snapshot.answered && snapshot.contextId === contextId && snapshot.support.rename.supported;
}

export function syncWorkerTitles(
  store: RunStore,
  t3: T3Threads,
  snapshots: ContractSnapshots,
  runId: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const due = yield* store.dueWorkerTitleSyncs(runId);
    if (!due.length) return;
    const snapshot = yield* snapshots.fresh();
    yield* Effect.forEach(
      due,
      (item) =>
        Effect.gen(function* () {
          if (!canRename(snapshot, item.context_id)) return;
          const claimed = yield* store.claimWorkerTitleSync(runId, item.id, item.context_id);
          if (!claimed) return;
          const authorizeDispatch = Effect.gen(function* () {
            const latest = yield* snapshots.latest();
            if (
              !canRename(latest, claimed.contextId) ||
              latest.support.rename.includeEnvironmentId !==
                snapshot.support.rename.includeEnvironmentId
            )
              return false;
            return yield* store.authorizeWorkerTitleDispatch(claimed);
          });
          let dispatched = false;
          const disposition = yield* Effect.promise((signal) =>
            t3
              .renameThread(
                {
                  endpoint: claimed.endpoint,
                  authorizationIdentity: claimed.authorizationIdentity,
                  signal,
                  onDispatch: () => {
                    dispatched = true;
                  },
                  authorizeDispatch: () => Effect.runPromise(authorizeDispatch),
                },
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
          ).pipe(
            Effect.interruptible,
            Effect.timeout("15 seconds"),
            Effect.catchTag("TimeoutError", () => Effect.succeed({ kind: "unavailable" as const })),
          );
          yield* store.recordWorkerTitleSync(claimed, disposition.kind, dispatched);
        }),
      { concurrency: 8, discard: true },
    );
  });
}
