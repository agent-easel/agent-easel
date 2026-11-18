import { expect, it } from "vite-plus/test";
import { runFreshness, runHeaderStatus } from "../src/run-status.ts";
import { attention, block, event, runDetail } from "./support/run.ts";

it("an Active Run whose Block asks for input states nothing in the header", () => {
  // Arrange
  const run = {
    ...runDetail(),
    blocks: [{ ...block("review"), state: "waiting" as const }],
    attention: [attention("review", "human")],
  };

  // Act
  const status = runHeaderStatus(run);

  // Assert
  expect(status).toBeNull();
});

it("a Settled Run shows Settled with its settle time instead of its block states", () => {
  // Arrange
  const run = {
    ...runDetail(),
    lifecycle: "settled" as const,
    blocks: [{ ...block("worker"), state: "error" as const }],
    events: [{ ...event(1), kind: "run-settled", observedAt: "2026-11-08T10:15:00Z" }],
  };

  // Act
  const status = runHeaderStatus(run);

  // Assert
  expect(status).toStrictEqual({ kind: "settled", at: "2026-11-08T10:15:00Z" });
});

it("an Archived Run shows Archived although a block still asks for input", () => {
  // Arrange
  const run = {
    ...runDetail(),
    lifecycle: "archived" as const,
    attention: [attention("worker", "human")],
    events: [{ ...event(1), kind: "run-archived", observedAt: "2026-11-08T11:00:00Z" }],
  };

  // Act
  const status = runHeaderStatus(run);

  // Assert
  expect(status).toStrictEqual({ kind: "archived", at: "2026-11-08T11:00:00Z" });
});

it("a stale started block makes an active Run Not live since its latest observation", () => {
  // Arrange
  const run = {
    ...runDetail(),
    blocks: [
      { ...block("worker"), freshness: "stale" as const, observedAt: "2026-11-08T09:40:00Z" },
      { ...block("review"), observedAt: "2026-11-08T09:44:00Z" },
      { ...block("untouched"), state: "not-started" as const, observedAt: "2026-11-08T09:50:00Z" },
    ],
  };

  // Act
  const freshness = runFreshness(run, false);

  // Assert
  expect(freshness).toStrictEqual({ live: false, lastObservedAt: "2026-11-08T09:44:00Z" });
});

it("unavailable live delivery makes an active Run Not live although its blocks were fresh", () => {
  // Arrange
  const run = {
    ...runDetail(),
    blocks: [{ ...block("worker"), observedAt: "2026-11-08T09:44:00Z" }],
  };

  // Act
  const freshness = runFreshness(run, true);

  // Assert
  expect(freshness).toStrictEqual({ live: false, lastObservedAt: "2026-11-08T09:44:00Z" });
});

it("a Settled Run with a stale block is not reported Not live", () => {
  // Arrange
  const run = {
    ...runDetail(),
    lifecycle: "settled" as const,
    blocks: [{ ...block("worker"), state: "finished" as const, freshness: "stale" as const }],
  };

  // Act
  const freshness = runFreshness(run, false);

  // Assert
  expect(freshness).toStrictEqual({ live: true });
});
