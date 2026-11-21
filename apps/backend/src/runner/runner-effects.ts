import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type { T3Target } from "../t3/connection.ts";
import type { T3Threads } from "../t3/threads.ts";

/** Remote/protocol failures become uncertainty; cancellation never fabricates evidence. */
export const recoverOperation = <A, E, R, B, E2, R2>(
  operation: Effect.Effect<A, E, R>,
  recover: (error: unknown) => Effect.Effect<B, E2, R2>,
): Effect.Effect<A | B, E | E2, R | R2> =>
  operation.pipe(
    Effect.catchCause((cause): Effect.Effect<B, E | E2, R2> =>
      Cause.hasInterrupts(cause) ? Effect.failCause(cause) : recover(Cause.squash(cause)),
    ),
  );

export const requestThreadStop = (t3: T3Threads, target: T3Target, threadId: string, key: string) =>
  recoverOperation(
    Effect.as(
      Effect.tryPromise(() => t3.stopThread(target, { threadId, clientRequestId: key })),
      true,
    ),
    () => Effect.succeed(false),
  );
