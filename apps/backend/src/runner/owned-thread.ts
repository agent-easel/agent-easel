import * as Effect from "effect/Effect";
import type { T3Adapter } from "../adapters/t3.ts";
import type { T3ContractSnapshot } from "../t3/contract.ts";
import type { T3Endpoint } from "../t3/connection.ts";
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
 * it is sent, only while the pass's T3 contract snapshot supports it and carries the owner's
 * authorization context. Requests are best effort: nothing waits for or confirms them.
 */
export function openOwnedThreads(t3: T3Adapter) {
  /** Undefined unless the snapshot is the owner's and supports the request; otherwise a sender
   * that answers whether T3 accepted the request. */
  function requester<R extends OwnedThreadRequest>(
    owner: ThreadOwner,
    snapshot: T3ContractSnapshot,
    supported: boolean,
    send: (request: R) => Promise<void>,
  ) {
    if (snapshot.contextId !== owner.contextId || !supported) return undefined;
    return (request: R) =>
      Effect.gen(function* () {
        if (!(yield* request.claim)) return false;
        return yield* recoverOperation(
          Effect.as(
            Effect.tryPromise(() => send(request)),
            true,
          ),
          () => Effect.succeed(false),
        );
      });
  }

  /** Native settlement of finished threads. */
  const settler = (owner: ThreadOwner, snapshot: T3ContractSnapshot) =>
    requester<OwnedThreadRequest>(
      owner,
      snapshot,
      snapshot.support.settle.supported,
      ({ threadId }) => t3.settleThread(owner.target, { threadId }),
    );

  /** A keyed Stop of threads that may still run, including their delegated work. */
  const stopper = (owner: ThreadOwner, snapshot: T3ContractSnapshot) =>
    requester<OwnedThreadRequest & { readonly clientRequestId: string }>(
      owner,
      snapshot,
      snapshot.support.stop.supported,
      ({ threadId, clientRequestId }) => t3.stopThread(owner.target, { threadId, clientRequestId }),
    );

  return { settler, stopper };
}

export type OwnedThreads = ReturnType<typeof openOwnedThreads>;
