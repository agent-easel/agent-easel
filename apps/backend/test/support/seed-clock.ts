// A historical visit uses the same Factory operations as a current one, on an earlier wall clock.
import { AsyncLocalStorage } from "node:async_hooks";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

const age = new AsyncLocalStorage<number>();
const live = Effect.runSync(Clock.Clock);
const millis = () => live.currentTimeMillisUnsafe() - (age.getStore() ?? 0);
const nanos = () => live.currentTimeNanosUnsafe() - BigInt(age.getStore() ?? 0) * 1_000_000n;

export const seedClock: Clock.Clock = {
  sleep: (duration) => live.sleep(duration),
  monotonicTimeNanos: live.monotonicTimeNanos,
  monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
  currentTimeMillisUnsafe: millis,
  currentTimeMillis: Effect.sync(millis),
  currentTimeNanosUnsafe: nanos,
  currentTimeNanos: Effect.sync(nanos),
};

export const threeHoursAgo = <T>(work: () => Promise<T>) => age.run(3 * 60 * 60 * 1000, work);
