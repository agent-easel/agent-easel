import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type { TriggerDefinition } from "@t3-factory/contracts";

/** The deadline of a Trigger that checks on its schedule, or null when it never checks by itself. */
const scheduledDeadline = (trigger: TriggerDefinition | undefined) =>
  trigger?.enabled && trigger.schedule.enabled ? trigger.nextCheckAt : null;

/** The deadline one schedule interval after `time`. */
export const deadlineAfter = (time: string, intervalMinutes: number) =>
  new Date(Date.parse(time) + intervalMinutes * 60_000).toISOString();

/**
 * One wake-up per scheduled Trigger at its persisted deadline, on the Factory clock. The deadline
 * in the Trigger row is the truth: a wake-up re-reads it, so a stale or extra wake-up checks
 * nothing, and an overdue deadline found at start wakes at once for exactly one check.
 * `checkOnSchedule` checks and writes the next deadline; a Trigger's wake-up is not re-armed while
 * that runs, because its completion arms the deadline it wrote.
 */
export const makeTriggerSchedule = (deps: {
  readonly readTrigger: (id: string) => Effect.Effect<TriggerDefinition | undefined, unknown>;
  readonly checkOnSchedule: (id: string) => Effect.Effect<TriggerDefinition | undefined, unknown>;
}) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const sleeping = new Map<string, { fiber?: Fiber.Fiber<unknown, unknown> }>();
    const running = new Set<string>();
    let closed = false;

    const cancel = (triggerId: string) =>
      Effect.gen(function* () {
        const timer = sleeping.get(triggerId);
        if (!timer) return;
        sleeping.delete(triggerId);
        if (timer.fiber) yield* Fiber.interrupt(timer.fiber);
      });

    /** Arms the Trigger's wake-up for its current deadline, or disarms it when it has none. */
    const follow = (
      triggerId: string,
      trigger: TriggerDefinition | undefined,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        if (closed) return;
        yield* cancel(triggerId);
        const deadline = scheduledDeadline(trigger);
        if (!deadline || running.has(triggerId)) return;
        const delay = Math.max(0, Date.parse(deadline) - (yield* Clock.currentTimeMillis));
        const timer: { fiber?: Fiber.Fiber<unknown, unknown> } = {};
        sleeping.set(triggerId, timer);
        timer.fiber = yield* Effect.forkIn(
          Effect.sleep(delay).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (sleeping.get(triggerId) === timer) sleeping.delete(triggerId);
              }),
            ),
            Effect.andThen(wake(triggerId)),
          ),
          scope,
        );
      });

    const wake = (triggerId: string) =>
      Effect.gen(function* () {
        if (running.has(triggerId)) return;
        const trigger = yield* deps.readTrigger(triggerId);
        const deadline = scheduledDeadline(trigger);
        if (!deadline) return;
        if (Date.parse(deadline) > (yield* Clock.currentTimeMillis))
          return yield* follow(triggerId, trigger);
        running.add(triggerId);
        const checked = yield* deps
          .checkOnSchedule(triggerId)
          .pipe(Effect.ensuring(Effect.sync(() => running.delete(triggerId))));
        yield* follow(triggerId, checked);
      });

    /** Stops every wake-up and waits for a scheduled check in progress; deadlines stay stored. */
    const close = Effect.suspend(() => {
      closed = true;
      return Scope.close(scope, Exit.void);
    });

    return {
      follow,
      /** Arms every scheduled Trigger and stops the schedule when the Factory scope closes. */
      start: (triggers: readonly TriggerDefinition[]) =>
        Effect.gen(function* () {
          yield* Effect.addFinalizer(() => close);
          yield* Effect.forEach(triggers, (trigger) => follow(trigger.id, trigger), {
            discard: true,
          });
        }),
    };
  });
