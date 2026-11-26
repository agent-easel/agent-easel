// A historical visit uses the same Factory operations as a current one, on an earlier wall clock.
import { AsyncLocalStorage } from "node:async_hooks";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

const age = new AsyncLocalStorage<number>();
const live = Effect.runSync(Clock.Clock);
const millis = () => live.currentTimeMillisUnsafe() - (age.getStore() ?? 0);
const nanos = () => live.currentTimeNanosUnsafe() - BigInt(age.getStore() ?? 0) * 1_000_000n;

export function shiftedClock(offsetMs: () => number): Clock.Clock {
  const shiftedMillis = () => live.currentTimeMillisUnsafe() + offsetMs();
  const shiftedNanos = () => live.currentTimeNanosUnsafe() + BigInt(offsetMs()) * 1_000_000n;
  return {
    sleep: (duration) => live.sleep(duration),
    monotonicTimeNanos: live.monotonicTimeNanos,
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    currentTimeMillisUnsafe: shiftedMillis,
    currentTimeMillis: Effect.sync(shiftedMillis),
    currentTimeNanosUnsafe: shiftedNanos,
    currentTimeNanos: Effect.sync(shiftedNanos),
  };
}

export const seedClock = shiftedClock(() => -(age.getStore() ?? 0));

export const threeHoursAgo = <T>(work: () => Promise<T>) => age.run(3 * 60 * 60 * 1000, work);

/** Keeps the seed clock running and also wakes its scheduled sleeps when a journey advances it. */
export function advancingSeedClock() {
  let offset = 0;
  const sleepers = new Set<() => void>();
  const wallMillis = () => millis() + offset;
  const wallNanos = () => nanos() + BigInt(offset) * 1_000_000n;
  const elapsed = () => live.currentTimeMillisUnsafe() + offset;
  const advanced = (before: number) =>
    Effect.callback<boolean>((resume) => {
      const wake = () => resume(Effect.succeed(false));
      if (offset !== before) return wake();
      sleepers.add(wake);
      return Effect.sync(() => {
        sleepers.delete(wake);
      });
    });
  const sleepUntil = (deadline: number): Effect.Effect<void> =>
    Effect.suspend(() => {
      const remaining = deadline - elapsed();
      if (remaining <= 0) return Effect.void;
      return Effect.flatMap(
        Effect.raceFirst(
          Effect.as(seedClock.sleep(Duration.millis(remaining)), true),
          advanced(offset),
        ),
        (finished) => (finished ? Effect.void : sleepUntil(deadline)),
      );
    });
  const clock: Clock.Clock = {
    monotonicTimeNanos: seedClock.monotonicTimeNanos,
    monotonicTimeNanosUnsafe: seedClock.monotonicTimeNanosUnsafe,
    currentTimeMillisUnsafe: wallMillis,
    currentTimeMillis: Effect.sync(wallMillis),
    currentTimeNanosUnsafe: wallNanos,
    currentTimeNanos: Effect.sync(wallNanos),
    sleep: (duration) => Effect.suspend(() => sleepUntil(elapsed() + Duration.toMillis(duration))),
  };
  return {
    clock,
    advanceTo(timestamp: number) {
      offset += Math.max(0, timestamp - elapsed());
      const waking = [...sleepers];
      sleepers.clear();
      for (const wake of waking) wake();
    },
  };
}
