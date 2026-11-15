import * as Effect from "effect/Effect";

/** Backend service operations; Promise translation belongs only at external entry points. */
export type EffectOperations<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => Promise<infer A>
    ? (...args: Args) => Effect.Effect<A, unknown>
    : T[K];
};

/** Runs a Promise-returning operation as an Effect that fails with the rejection as is. */
export const boundary = <A>(operation: () => PromiseLike<A>) =>
  Effect.tryPromise({ try: operation, catch: (error) => error });
