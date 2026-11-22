import {
  attentionPresentation,
  awaitsReviewInT3,
  type FlowBlock,
  type RunBlock,
  type RunDetail,
} from "@t3-factory/contracts";
import type { RunStateKind } from "./components/status-badge.tsx";

/**
 * A Block's pending attention. Needs input is a pending question or decision, or an Agent that
 * awaits review in T3; a confirmed Settle answers nothing, so then nothing asks.
 */
function blockAttention(run: RunDetail, recorded: RunBlock | undefined) {
  if (!recorded) return { needsInput: false, problem: false };
  const pending = run.attention.filter(
    (item) => item.blockId === recorded.blockId && !item.settledAt,
  );
  return {
    needsInput:
      !run.settlement &&
      (awaitsReviewInT3(recorded) ||
        pending.some((item) => attentionPresentation(item.kind) === "needs-input")),
    problem: pending.some((item) => attentionPresentation(item.kind) === "problem"),
  };
}

const stateKinds: Record<RunBlock["state"], RunStateKind | null> = {
  "not-started": null,
  working: "working",
  sent: "working",
  waiting: "waiting",
  finished: "finished",
  "pass-through": "finished",
  error: "problem",
  stopped: "stopped",
};

/**
 * The canonical state a started Block shows. Needs input replaces Working and Waiting; a pending
 * Problem replaces any other settled state, but a Block still running in T3 shows Working.
 */
export function blockStateKind(
  run: RunDetail,
  recorded: RunBlock | undefined,
): RunStateKind | null {
  const kind = recorded ? stateKinds[recorded.state] : null;
  const attention = blockAttention(run, recorded);
  if ((kind === "working" || kind === "waiting") && attention.needsInput) return "needs-input";
  if (
    (kind === "waiting" || kind === null) &&
    attention.problem &&
    run.joins.some((join) => join.blockId === recorded?.blockId)
  )
    return "problem";
  if (kind !== null && kind !== "working" && kind !== "waiting" && attention.problem)
    return "problem";
  return kind;
}

/**
 * When an Agent that awaits review in T3 began waiting: Factory first saw its current turn end.
 * Its `observedAt` only says when Factory last looked.
 */
export function reviewInT3Since(run: RunDetail, recorded: RunBlock) {
  return (
    run.executions.find(
      (execution) =>
        execution.blockId === recorded.blockId && execution.executionId === recorded.executionId,
    )?.observedEndedAt ?? null
  );
}

/** The exits a report, an answer, a selection or a forward has chosen on the Block's latest
 * visit; the rest have not been taken. */
export function chosenExitIds(
  run: RunDetail,
  block: FlowBlock,
  recorded: RunBlock | undefined,
): ReadonlySet<string> {
  const state = recorded?.state ?? "not-started";
  switch (block.kind) {
    case "agent": {
      if (state !== "finished") return new Set();
      const report = run.reports.findLast(
        (item) => item.blockId === block.id && item.status === "finished",
      );
      return new Set(report?.exitId ? [report.exitId] : []);
    }
    case "human": {
      const latest = run.humanOccurrences.findLast((item) => item.blockId === block.id);
      return new Set(latest?.state === "answered" && latest.exitId ? [latest.exitId] : []);
    }
    case "condition":
      return new Set(
        run.events.flatMap((event) =>
          event.blockId === block.id && event.condition ? [event.condition.outputId] : [],
        ),
      );
    case "wait":
      return new Set(
        run.waitArrivals.some(
          (arrival) => arrival.blockId === block.id && arrival.state === "forwarded",
        )
          ? ["output"]
          : [],
      );
    case "subflow":
      return new Set();
    case "join":
      return new Set(
        run.events.some(
          (event) => event.blockId === block.id && event.kind === "join-round-forwarded",
        )
          ? ["output"]
          : [],
      );
    case "continuation":
      return new Set(
        run.continuationVisits.some(
          (visit) => visit.blockId === block.id && visit.state === "forwarded",
        )
          ? ["output"]
          : [],
      );
  }
}
