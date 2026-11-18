import { expect, it } from "vite-plus/test";
import { reportRecoveryState, settlementPrimary } from "../src/attention-copy.ts";
import { attention, block, blockedWorker, runDetail, unresolvedSettlement } from "./support/run.ts";

it("a settlement T3 cannot stop leads with Open in T3", () => {
  // Arrange
  const run = {
    ...runDetail(),
    settlement: unresolvedSettlement([blockedWorker("worker", "unsupported")]),
  };

  // Act
  const primary = settlementPrimary(run);

  // Assert
  expect(primary).toBe("open-in-t3");
});

it("a settlement whose Stop failed leads with Retry settlement", () => {
  // Arrange
  const run = {
    ...runDetail(),
    settlement: unresolvedSettlement([blockedWorker("worker", "failed")]),
  };

  // Act
  const primary = settlementPrimary(run);

  // Assert
  expect(primary).toBe("retry");
});

it("a missing report whose requested report turn ended without one reads as no valid report", () => {
  // Arrange
  const missing = { ...attention("worker", "missing-report"), id: "missing" };
  const worker = {
    ...block("worker"),
    executionId: "recovery-turn",
    engineStatus: "completed",
  };
  const run = {
    ...runDetail(),
    blocks: [worker],
    attention: [missing],
    recoveries: [
      {
        attentionId: "missing",
        blockId: "worker",
        sourceExecutionId: "first-turn",
        intentId: "intent",
        executionId: "recovery-turn",
        requestedAt: "2026-11-08T22:18:00Z",
        settledAt: null,
      },
    ],
  };

  // Act
  const recovery = reportRecoveryState(run, worker, [missing.id]);

  // Assert
  expect(recovery).toStrictEqual({ state: "no-valid-report" });
});
