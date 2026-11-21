import * as Semaphore from "effect/Semaphore";
import * as Latch from "effect/Latch";
import type { LiveChanges } from "../live-changes.ts";
import { recoverOperation } from "./runner-effects.ts";
import * as Effect from "effect/Effect";
import type { ContractSnapshots } from "../connection.ts";
import type { T3ContractSnapshot } from "../t3/contract.ts";
import type { T3Threads } from "../t3/threads.ts";
import type { RunStore } from "./run-store/run-store.ts";

function canRename(snapshot: T3ContractSnapshot, contextId: string) {
  return snapshot.answered && snapshot.contextId === contextId && snapshot.support.rename.supported;
}

function syncWorkerTitles(
  store: RunStore,
  t3: T3Threads,
  snapshots: ContractSnapshots,
  permits: Semaphore.Semaphore,
  runId: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const due = yield* store.dueWorkerTitleSyncs(runId);
    if (!due.length) return;
    const snapshot = yield* snapshots.fresh();
    yield* Effect.forEach(
      due,
      (item) =>
        permits.withPermit(
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
            const disposition = yield* Effect.promise((signal) =>
              t3
                .renameThread(
                  {
                    endpoint: claimed.endpoint,
                    authorizationIdentity: claimed.authorizationIdentity,
                    signal,
                    refuseDispatch: () =>
                      Effect.runPromise(store.refuseWorkerTitleDispatch(claimed)),
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
              Effect.catchTag("TimeoutError", () =>
                Effect.succeed({ kind: "unavailable" as const }),
              ),
            );
            yield* store.recordWorkerTitleSync(claimed, disposition.kind);
          }),
        ),
      { concurrency: 4, discard: true },
    );
  });
}

export const openWorkerTitleDispatch = Effect.fn("WorkerTitles.open")(function* (
  store: RunStore,
  t3: T3Threads,
  snapshots: ContractSnapshots,
  changes: LiveChanges,
) {
  const permits = Semaphore.makeUnsafe(8);
  const dirty = new Set<string>();
  const active = new Set<string>();
  const wake = Latch.makeUnsafe(false);
  const idle = Latch.makeUnsafe(true);
  const queue = (id: string) => {
    dirty.add(id);
    idle.closeUnsafe();
    if (!active.has(id)) wake.openUnsafe();
  };
  yield* changes.onRunChanged(queue);
  const worker = yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        yield* wake.await;
        wake.closeUnsafe();
        for (const id of dirty) {
          if (active.has(id)) continue;
          dirty.delete(id);
          active.add(id);
          yield* recoverOperation(syncWorkerTitles(store, t3, snapshots, permits, id), () =>
            Effect.logWarning("Worker title synchronization failed", { runId: id }),
          ).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                active.delete(id);
                if (dirty.has(id)) wake.openUnsafe();
                if (!active.size && !dirty.size) idle.openUnsafe();
              }),
            ),
            Effect.forkChild,
          );
        }
      }),
    ),
  );
  return { worker, queue, idle };
});
