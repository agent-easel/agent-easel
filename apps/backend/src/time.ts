import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

/** Persist observation time from the current runtime's clock. */
export const now = Clock.currentTimeMillis.pipe(
  Effect.map((milliseconds) => new Date(milliseconds).toISOString()),
);

/** The later of a stored time and an optional later event's time, both ISO strings. */
export const laterTime = (time: string, event: string | null) =>
  event !== null && event > time ? event : time;

/** The current time, or a millisecond after `previous` when the clock has not passed it. */
export const nowAfter = (previous: string) =>
  now.pipe(
    Effect.map((current) =>
      current > previous ? current : new Date(Date.parse(previous) + 1).toISOString(),
    ),
  );
