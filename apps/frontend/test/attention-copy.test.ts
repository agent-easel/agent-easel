import type { RunThreadBinding } from "@agent-easel/contracts";
import { expect, it } from "vite-plus/test";
import {
  attentionLinkedThreads,
  reportRecoveryState,
  settlementPrimary,
  worktreeFixHref,
} from "../src/attention-copy.ts";
import { attention, block, blockedWorker, runDetail, unresolvedSettlement } from "./support/run.ts";

const binding = (id: string, role: RunThreadBinding["role"], link: string): RunThreadBinding => ({
  id,
  blockId: "worker",
  environmentId: "env",
  threadId: id,
  role,
  parentBindingId: role === "descendant" ? "worker-binding" : null,
  link,
});

it("a settlement T3 Code cannot stop leads with Open in T3 Code", () => {
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

it("an Attention card hides only the thread it links, not every binding on its Block", () => {
  // Arrange
  const run = {
    ...runDetail(),
    attention: [{ ...attention("worker", "execution-failed"), link: "https://t3.example/worker" }],
    blocks: [{ ...block("worker"), link: "https://t3.example/worker" }],
    threadBindings: [
      binding("worker-binding", "worker", "https://t3.example/worker"),
      binding("child", "descendant", "https://t3.example/child"),
    ],
  };

  // Act
  const linked = attentionLinkedThreads(run);

  // Assert
  expect(linked.has("https://t3.example/worker")).toBe(true);
  expect(linked.has("https://t3.example/child")).toBe(false);
});

it("a failed worktree opens the Flow-input thread and never the title thread", () => {
  // Arrange
  const detail = runDetail();
  const run = {
    ...detail,
    definitions: {
      ...detail.definitions,
      flow: {
        ...detail.definitions.flow,
        graph: {
          ...detail.definitions.flow.graph,
          flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["worker"] },
        },
      },
    },
    blocks: [
      { ...block("worker"), link: "https://t3.example/creator" },
      { ...block("other"), link: "https://t3.example/other" },
    ],
    titleGeneration: {
      state: "applied" as const,
      reason: null,
      modelLabel: "Model",
      deadlineAt: "2026-11-08T00:00:30Z",
      automaticTitle: "Run",
      generatedTitle: "Run",
      threadLink: "https://t3.example/title",
    },
  };

  // Act
  const href = worktreeFixHref(run);

  // Assert
  expect(href).toBe("https://t3.example/creator");
});

it("a failed worktree with no worker or coordinator thread has no T3 Code fix link", () => {
  // Arrange
  const run = {
    ...runDetail(),
    titleGeneration: {
      state: "failed" as const,
      reason: "T3 Code rejected the title thread launch.",
      modelLabel: "Model",
      deadlineAt: "2026-11-08T00:00:30Z",
      automaticTitle: "Run",
      generatedTitle: null,
      threadLink: "https://t3.example/title",
    },
  };

  // Act
  const href = worktreeFixHref(run);

  // Assert
  expect(href).toBeNull();
});
