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

type RenameCapability = { contextId: string; includeEnvironmentId: boolean };

function syncWorkerTitle(
  store: RunStore,
  t3: T3Threads,
  snapshots: ContractSnapshots,
  runId: string,
  bindingId: string,
  capability: RenameCapability,
) {
  return Effect.gen(function* () {
    const claimed = yield* store.claimWorkerTitleSync(runId, bindingId, capability.contextId);
    if (!claimed) return false;
    const authorizeDispatch = Effect.gen(function* () {
      const latest = yield* snapshots.latest();
      if (
        !canRename(latest, claimed.contextId) ||
        latest.support.rename.includeEnvironmentId !== capability.includeEnvironmentId
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
            refuseDispatch: () => Effect.runPromise(store.refuseWorkerTitleDispatch(claimed)),
            authorizeDispatch: () => Effect.runPromise(authorizeDispatch),
          },
          {
            threadId: claimed.threadId,
            title: claimed.title,
            clientRequestId: claimed.requestId,
            ...(capability.includeEnvironmentId ? { environmentId: claimed.environmentId } : {}),
          },
        )
        .catch(() => ({ kind: "unavailable" as const })),
    ).pipe(
      Effect.interruptible,
      Effect.timeout("15 seconds"),
      Effect.catchTag("TimeoutError", () => Effect.succeed({ kind: "unavailable" as const })),
    );
    return yield* store.recordWorkerTitleSync(claimed, disposition.kind);
  });
}

export const openWorkerTitleDispatch = Effect.fn("WorkerTitles.open")(function* (
  store: RunStore,
  t3: T3Threads,
  snapshots: ContractSnapshots,
  changes: LiveChanges,
) {
  const dirty = new Set<string>();
  const pending = new Map<string, { capability: RenameCapability; bindings: Set<string> }>();
  const active = new Map<string, string>();
  const slots = (id: string) =>
    Math.min(4 - [...active.values()].filter((runId) => runId === id).length, 8 - active.size);
  const wake = Latch.makeUnsafe(false);
  const idle = Latch.makeUnsafe(true);
  const queue = (id: string) => {
    dirty.add(id);
    idle.closeUnsafe();
    wake.openUnsafe();
  };
  yield* changes.onRunChanged(queue);
  const worker = yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        yield* wake.await;
        wake.closeUnsafe();
        for (const id of new Set([...dirty, ...pending.keys()])) {
          if (!slots(id)) continue;

          const warn = () =>
            Effect.logWarning("Worker title synchronization failed", { runId: id });
          if (dirty.delete(id)) {
            pending.delete(id);
            yield* recoverOperation(
              Effect.gen(function* () {
                const due = yield* store.dueWorkerTitleSyncs(id);
                const first = due[0];
                if (!first) return;
                const snapshot = yield* snapshots.fresh();
                if (!canRename(snapshot, first.context_id)) return;
                pending.set(id, {
                  capability: {
                    contextId: first.context_id,
                    includeEnvironmentId: snapshot.support.rename.includeEnvironmentId,
                  },
                  bindings: new Set(due.map((item) => item.id)),
                });
              }),
              warn,
            );
          }

          const work = pending.get(id);
          if (!work) continue;
          const batch = [...work.bindings]
            .filter((binding) => !active.has(binding))
            .slice(0, slots(id));
          for (const binding of batch) {
            work.bindings.delete(binding);
            active.set(binding, id);
            yield* recoverOperation(
              syncWorkerTitle(store, t3, snapshots, id, binding, work.capability),
              () => warn().pipe(Effect.as(false)),
            ).pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  active.delete(binding);
                  if (exit._tag === "Success" && exit.value) queue(id);
                  else wake.openUnsafe();
                }),
              ),
              Effect.forkChild,
            );
          }
          if (!work.bindings.size) pending.delete(id);
        }
        if (!active.size && !dirty.size && !pending.size) idle.openUnsafe();
      }),
    ),
  );
  return { worker, queue, idle };
});
