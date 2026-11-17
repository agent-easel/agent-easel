import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import {
  checkingWorld,
  scheduledWorld,
  startedIssues,
  studioTrigger,
  triggerEdit,
} from "./support/triggers.ts";

const MINUTE = 60_000;
const INTERVAL = 5 * MINUTE;
const after = (time: string, milliseconds: number) =>
  new Date(Date.parse(time) + milliseconds).toISOString();

it.effect(
  "an enabled Trigger checks one interval after it was enabled and sets its next deadline one interval after that check",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* scheduledWorld(c);
      f.readyIssue(1, "Scheduled");
      const checked = studioTrigger(c, f.factory.live, f.trigger.id, (trigger) =>
        Boolean(trigger.latestCheck && trigger.nextCheckAt !== f.trigger.nextCheckAt),
      );

      // Act
      yield* TestClock.adjust(INTERVAL);

      // Assert
      const trigger = yield* Effect.promise(() => checked);
      expect(trigger.latestCheck).toMatchObject({
        checkedAt: after(f.trigger.updatedAt, INTERVAL),
        started: 1,
      });
      expect(trigger.nextCheckAt).toBe(after(trigger.latestCheck!.checkedAt, INTERVAL));
      expect(
        yield* Effect.promise(() => startedIssues(f.world.factory, f.project.id)),
      ).toStrictEqual([1]);
    }),
);

it.effect(
  "a restart after several missed deadlines runs one overdue check and schedules the next one interval after it",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* scheduledWorld(c);
      f.readyIssue(1, "Waited through the downtime");
      yield* f.close;
      yield* TestClock.adjust(3 * INTERVAL + MINUTE);

      // Act
      const recovered = yield* f.reopen;

      // Assert
      const trigger = yield* Effect.promise(() =>
        studioTrigger(
          c,
          recovered.live,
          f.trigger.id,
          (shown) => shown.nextCheckAt !== f.trigger.nextCheckAt,
        ),
      );
      expect(trigger.latestCheck).toMatchObject({
        checkedAt: after(f.trigger.updatedAt, 3 * INTERVAL + MINUTE),
        started: 1,
      });
      expect(trigger.nextCheckAt).toBe(after(trigger.latestCheck!.checkedAt, INTERVAL));
      expect(f.github.calls.filter((call) => call === "openIssues")).toHaveLength(1);
    }),
);

it.effect(
  "a scheduled check and a manual Run racing start each ready issue once within the free slots",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* scheduledWorld(c, { maxActiveRuns: 2 });
      f.readyIssue(1, "First");
      f.readyIssue(2, "Second");
      f.readyIssue(3, "Third");
      const scheduled = studioTrigger(
        c,
        f.factory.live,
        f.trigger.id,
        (trigger) => trigger.nextCheckAt !== f.trigger.nextCheckAt,
      );

      // Act
      const [, manual] = yield* Effect.all(
        [TestClock.adjust(INTERVAL), f.factory.runTrigger(f.trigger.id)],
        {
          concurrency: "unbounded",
        },
      );

      // Assert
      assert(manual.ok);
      yield* Effect.promise(() => scheduled);
      expect(f.github.calls.filter((call) => call === "openIssues")).toHaveLength(2);
      expect(
        yield* Effect.promise(() => startedIssues(f.world.factory, f.project.id)),
      ).toStrictEqual([1, 2]);
    }),
);

it.effect(
  "with its schedule off an enabled Trigger has no deadline and never checks by itself",
  (c) =>
    Effect.gen(function* () {
      // Arrange
      const f = yield* scheduledWorld(c, { schedule: { enabled: false, intervalMinutes: 5 } });
      f.readyIssue(1, "Waits for Run");

      // Act
      yield* TestClock.adjust(12 * INTERVAL);

      // Assert
      const trigger = yield* f.factory.getTrigger(f.trigger.id);
      assert(trigger.ok);
      expect(trigger.value).toMatchObject({ enabled: true, nextCheckAt: null, latestCheck: null });
      expect(f.github.calls).toStrictEqual([]);
    }),
);

it.effect("a disabled Trigger has no deadline and never checks by itself", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* scheduledWorld(c);
    f.readyIssue(1, "Waits for enable");
    assert((yield* f.factory.setTriggerEnabled(f.trigger.id, { enabled: false })).ok);

    // Act
    yield* TestClock.adjust(12 * INTERVAL);

    // Assert
    const trigger = yield* f.factory.getTrigger(f.trigger.id);
    assert(trigger.ok);
    expect(trigger.value).toMatchObject({ enabled: false, nextCheckAt: null, latestCheck: null });
    expect(f.github.calls).toStrictEqual([]);
  }),
);

it.effect("a removed Trigger's deadline never checks", (c) =>
  Effect.gen(function* () {
    // Arrange
    const f = yield* scheduledWorld(c);
    f.readyIssue(1, "Removed before its check");
    assert((yield* f.factory.removeTrigger(f.trigger.id)).ok);

    // Act
    yield* TestClock.adjust(12 * INTERVAL);

    // Assert
    expect(f.github.calls).toStrictEqual([]);
    expect(yield* Effect.promise(() => startedIssues(f.world.factory, f.project.id))).toStrictEqual(
      [],
    );
  }),
);

it("a Trigger with its schedule off checks when asked to Run", async (c) => {
  // Arrange
  const world = await checkingWorld(c, { schedule: { enabled: false, intervalMinutes: 5 } });
  world.readyIssue(1, "On demand");

  // Act
  const checked = await world.f.runTrigger(world.trigger.id);

  // Assert
  assert(checked.ok);
  expect(checked.value.latestCheck).toMatchObject({ started: 1 });
  expect(await startedIssues(world.f, world.project.id)).toStrictEqual([1]);
});

it("a new interval moves the next check to one new interval after the save", async (c) => {
  // Arrange
  const world = await checkingWorld(c, { schedule: { enabled: true, intervalMinutes: 24 * 60 } });

  // Act
  const saved = await world.f.updateTrigger(
    world.trigger.id,
    triggerEdit(world.trigger, { schedule: { enabled: true, intervalMinutes: 5 } }),
  );

  // Assert
  assert(saved.ok);
  expect(saved.value.trigger.nextCheckAt).toBe(after(saved.value.trigger.updatedAt, INTERVAL));
});
