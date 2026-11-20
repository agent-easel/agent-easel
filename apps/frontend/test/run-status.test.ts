import { expect, it } from "vite-plus/test";
import {
  lifecycleAt,
  runActivity,
  runFreshness,
  runResultState,
  waitsForWorkerConfirmation,
} from "../src/run-status.ts";
import { block, event, runDetail, runEntry } from "./support/run.ts";

it("a reopened Run shows the time of its latest settlement", () => {
  // Arrange
  const run = {
    ...runDetail(),
    events: [
      { ...event(1), kind: "run-settled", observedAt: "2026-11-08T09:00:00Z" },
      { ...event(2), kind: "run-activated", observedAt: "2026-11-08T09:30:00Z" },
      { ...event(3), kind: "run-settled", observedAt: "2026-11-08T10:15:00Z" },
    ],
  };

  // Act
  const at = lifecycleAt(run, "run-settled");

  // Assert
  expect(at).toBe("2026-11-08T10:15:00Z");
});

it("a finished Block with a pending handoff is idle and not yet waiting for worker confirmation", () => {
  // Arrange
  const run = {
    ...runEntry(),
    pendingWork: true,
    blocks: [{ ...block("worker"), state: "finished" as const }],
  };

  // Act
  const waiting = waitsForWorkerConfirmation(run);
  const activity = runActivity(run);

  // Assert
  expect(waiting).toBe(false);
  expect(activity).toBe("idle");
});

it("a Block that is waiting is the Waiting activity", () => {
  // Arrange
  const run = {
    ...runEntry(),
    blocks: [{ ...block("worker"), state: "waiting" as const }],
  };

  // Act
  const activity = runActivity(run);

  // Assert
  expect(activity).toBe("waiting");
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

/** A Run whose captured Flow declares one ending. */
function runWithEnding() {
  const run = runDetail();
  const graph = run.definitions.flow.graph;
  const ending = {
    id: "shipped",
    name: "Shipped",
    description: "",
    output: "required" as const,
    outputDescription: "URL of the PR",
  };
  return {
    ...run,
    definitions: {
      ...run.definitions,
      flow: {
        ...run.definitions.flow,
        graph: { ...graph, finish: { ...graph.finish, endings: [ending] } },
      },
    },
  };
}

it("a Run whose captured Flow has no endings has no Result section", () => {
  // Arrange
  const run = { ...runDetail(), lifecycle: "settled" as const, gateOpen: false };

  // Act
  const state = runResultState(run);

  // Assert
  expect(state).toBe("none");
});

it("an open Run with endings and no result can still reach one", () => {
  // Arrange
  const run = runWithEnding();

  // Act
  const state = runResultState(run);

  // Assert
  expect(state).toBe("not-yet");
});

it("a Run whose gate closed without a result ended without one", () => {
  // Arrange
  const run = { ...runWithEnding(), gateOpen: false };

  // Act
  const state = runResultState(run);

  // Assert
  expect(state).toBe("not-reached");
});
