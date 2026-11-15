import * as Effect from "effect/Effect";
import type { T3Adapter, T3Endpoint } from "../adapters/t3.ts";
import { recoverOperation } from "./runner-effects.ts";

/** A thread Factory owns under one T3 authorization context, such as a Run's worker or title
 * thread. */
export type ThreadOwner = { readonly target: T3Endpoint; readonly contextId: string };

/** One request for a thread: `claim` records it in the Run store and answers false when it was
 * already recorded. */
type OwnedThreadRequest = {
  readonly threadId: string;
  readonly claim: Effect.Effect<boolean, unknown>;
};

/**
 * Stop and settle for threads Factory owns: each request is sent at most once, recorded before
 * it is sent, only while T3 supports it and the owner's authorization context is live, which is
 * rechecked for every thread. Requests are best effort: nothing waits for or confirms them.
 */
export function openOwnedThreads(
  t3: T3Adapter,
  liveContextId: () => Effect.Effect<string | null, unknown>,
) {
  /** Undefined when T3 does not support the request or could not answer; otherwise a sender that
   * answers whether T3 accepted the request. */
  function requester<R extends OwnedThreadRequest>(
    owner: ThreadOwner,
    supported: () => Promise<{ readonly supported: boolean }>,
    send: (request: R) => Promise<void>,
  ) {
    return Effect.map(
      Effect.promise(() => supported().catch(() => null)),
      (support) =>
        support?.supported
          ? (request: R) =>
              Effect.gen(function* () {
                if ((yield* liveContextId()) !== owner.contextId) return false;
                if (!(yield* request.claim)) return false;
                return yield* recoverOperation(
                  Effect.as(
                    Effect.tryPromise(() => send(request)),
                    true,
                  ),
                  () => Effect.succeed(false),
                );
              })
          : undefined,
    );
  }

  /** Native settlement of finished threads. */
  const settler = (owner: ThreadOwner) =>
    requester<OwnedThreadRequest>(
      owner,
      () => t3.inspectSettleSupport(owner.target),
      ({ threadId }) => t3.settleThread(owner.target, { threadId }),
    );

  /** A keyed Stop of threads that may still run, including their delegated work. */
  const stopper = (owner: ThreadOwner) =>
    requester<OwnedThreadRequest & { readonly clientRequestId: string }>(
      owner,
      () => t3.inspectStopSupport(owner.target),
      ({ threadId, clientRequestId }) => t3.stopThread(owner.target, { threadId, clientRequestId }),
    );

  return { settler, stopper };
}

export type OwnedThreads = ReturnType<typeof openOwnedThreads>;
