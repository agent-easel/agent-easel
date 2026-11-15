import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createRefreshSchedule, type RefreshPage } from "../src/refresh-schedule.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A page whose visibility and focus the test controls. */
function fakePage(visible = true) {
  let events: Parameters<RefreshPage["subscribe"]>[0] | undefined;
  const page: RefreshPage = {
    visible: () => visible,
    subscribe(next) {
      events = next;
      return () => {
        events = undefined;
      };
    },
  };
  return {
    page,
    setVisible(next: boolean) {
      visible = next;
      events?.visibility();
    },
    focus: () => events?.focus(),
  };
}

/** Reads the test answers one by one, in any order. */
function controlledReads() {
  const pending: { resolve: (value: string) => void; reject: (cause: unknown) => void }[] = [];
  const applied: string[] = [];
  const failures: unknown[] = [];
  const schedule = createRefreshSchedule<string>({
    read: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    apply: (value) => applied.push(value),
    failed: (failure) => failures.push(failure && failure.cause),
  });
  return { schedule, pending, applied, failures };
}

it("a hidden page stops reading and reads again as soon as it is visible", async () => {
  // Arrange
  const { schedule, pending } = controlledReads();
  const page = fakePage();
  schedule.watch(1000, page.page);
  page.setVisible(false);
  await vi.advanceTimersByTimeAsync(5000);
  const whileHidden = pending.length;

  // Act
  page.setVisible(true);
  await vi.advanceTimersByTimeAsync(1000);

  // Assert: one immediate read before hiding, none while hidden, then immediate and interval.
  expect(whileHidden).toBe(1);
  expect(pending).toHaveLength(3);
});

it("focusing the window reads at once without waiting for the interval", () => {
  // Arrange
  const { schedule, pending } = controlledReads();
  const page = fakePage();
  schedule.watch(30_000, page.page);

  // Act
  page.focus();

  // Assert
  expect(pending).toHaveLength(2);
});

it("a slower earlier read never replaces the answer of a later read", async () => {
  // Arrange
  const { schedule, pending, applied } = controlledReads();
  void schedule.refresh();
  const later = schedule.refresh();
  pending[1]?.resolve("later");
  await later;

  // Act
  pending[0]?.resolve("earlier");
  await vi.advanceTimersByTimeAsync(0);

  // Assert
  expect(applied).toStrictEqual(["later"]);
});

it("a failed read is reported until a later read succeeds", async () => {
  // Arrange
  const { schedule, pending, applied, failures } = controlledReads();
  const failing = schedule.refresh();
  pending[0]?.reject(new Error("offline"));
  await failing;

  // Act
  const succeeding = schedule.refresh();
  pending[1]?.resolve("fresh");
  await succeeding;

  // Assert
  expect(failures).toStrictEqual([new Error("offline"), null]);
  expect(applied).toStrictEqual(["fresh"]);
});

it("a read in flight when an action's answer applies is dropped", async () => {
  // Arrange
  const { schedule, pending, applied } = controlledReads();
  const background = schedule.refresh();

  // Act
  schedule.supersede();
  pending[0]?.resolve("before the action");
  await background;

  // Assert
  expect(applied).toStrictEqual([]);
});

it("a closed schedule applies no answer and stops its interval", async () => {
  // Arrange
  const { schedule, pending, applied } = controlledReads();
  const stop = schedule.watch(1000, fakePage().page);

  // Act
  stop();
  schedule.close();
  pending[0]?.resolve("after unmount");
  await vi.advanceTimersByTimeAsync(5000);

  // Assert
  expect(applied).toStrictEqual([]);
  expect(pending).toHaveLength(1);
});
