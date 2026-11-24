import {
  awaitsReviewInT3,
  type RunAttention,
  type RunBlock,
  type RunDetail,
} from "@agent-easel/contracts";

/**
 * Plain wording for each Attention card: one sentence that names the Block and what happened, and
 * one sentence with the next action. Reason codes, ids and agent-facing text stay in Technical
 * details.
 */

/** The reason code a rejected report recorded, as `INVALID_EXIT` in "INVALID_EXIT: …". */
export function reportReasonCode(message: string | null) {
  return /^([A-Z][A-Z_]+):/.exec(message ?? "")?.[1] ?? null;
}

const REPORT_REJECTIONS: Record<string, string> = {
  INVALID_EXIT: "reported an unknown exit",
  EXIT_NOT_ALLOWED: "reported an exit before finishing",
  MESSAGE_REQUIRED: "reported without a message",
};

/** What a rejected report did, in plain words, for the card title. */
function reportRejection(message: string | null) {
  const code = reportReasonCode(message);
  return (code && REPORT_REJECTIONS[code]) ?? "sent a report Factory couldn't accept";
}

type Recovery = RunDetail["recoveries"][number];

/** A Block's Request report still in flight: unsent, or its assessment turn not yet completed. */
export function pendingRecovery(run: RunDetail, block: RunBlock): Recovery | undefined {
  return run.recoveries.find(
    (r) =>
      r.blockId === block.blockId &&
      (r.sourceExecutionId === block.executionId ||
        (r.executionId === block.executionId && block.engineStatus !== "completed")),
  );
}

/**
 * Where a Block's missing or rejected report stands: `requested` while a Request report is in
 * flight, `no-valid-report` once one ended without a valid report, otherwise `missing`.
 */
export function reportRecoveryState(
  run: RunDetail,
  block: RunBlock | undefined,
  attentionIds: readonly string[],
): { state: "missing" | "no-valid-report" } | { state: "requested"; recovery: Recovery } {
  const recovery = run.recoveries.findLast(
    (r) => r.attentionId !== null && attentionIds.includes(r.attentionId),
  );
  const inFlight = block && pendingRecovery(run, block);
  if (inFlight) return { state: "requested", recovery: inFlight };
  return { state: recovery ? "no-valid-report" : "missing" };
}

/** Why Request report is unavailable for `block`, or null while it can be sent. Only an idle
 * worker with fresh evidence and no pending T3 request can assess its work. */
export function requestReportBlocker(run: RunDetail, block: RunBlock | undefined) {
  if (!run.gateOpen || !block) return "unavailable" as const;
  if (!block.workerFinished || block.engineStatus !== "completed" || block.freshness !== "fresh")
    return "not-idle" as const;
  return null;
}

/** T3 threads a pending Attention card already opens. An activation hides only a binding whose
 * own link is one of these, so another thread on the same Block keeps its link. */
export function attentionLinkedThreads(run: RunDetail) {
  const reviews = run.settlement ? [] : run.blocks.filter((block) => awaitsReviewInT3(block));
  return new Set([
    ...run.attention.flatMap((item) => (!item.settledAt && item.link ? [item.link] : [])),
    ...reviews.flatMap((block) => (block.link ? [block.link] : [])),
    ...(run.attention.some((item) => item.kind === "settlement-unresolved" && !item.settledAt)
      ? blockedWorkers(run).flatMap((worker) => (worker.link ? [worker.link] : []))
      : []),
  ]);
}

/** The worker or coordinator thread that can fix a failed worktree. Never the title thread. */
export function worktreeFixHref(run: RunDetail): string | null {
  const byId = new Map(run.blocks.map((block) => [block.blockId, block]));
  for (const id of run.definitions.flow.graph.flowInput.targetBlockIds) {
    const link = byId.get(id)?.link;
    if (link) return link;
  }
  for (const block of run.blocks) if (block.link) return block.link;
  return run.runCoordinator?.link ?? null;
}

/** The workers a settlement could not resolve. */
export function blockedWorkers(run: RunDetail) {
  return (run.settlement?.workers ?? []).filter((worker) => worker.state === "unresolved");
}

/**
 * The settlement card's primary action. When T3 cannot stop worker threads only the owner can
 * stop them in T3, so Open in T3 leads; otherwise a retry can succeed and leads.
 */
export function settlementPrimary(run: RunDetail): "open-in-t3" | "retry" {
  const blocked = blockedWorkers(run);
  return blocked.some((worker) => worker.stopOutcome === "unsupported" && worker.link)
    ? "open-in-t3"
    : "retry";
}

function names(items: readonly string[]) {
  if (items.length <= 1) return items[0] ?? "its workers";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Title and next action of the settlement card. */
export function settlementCopy(run: RunDetail) {
  const blocked = blockedWorkers(run);
  const unsupported = blocked.some((worker) => worker.stopOutcome === "unsupported");
  const them = blocked.length > 1 ? "them" : "it";
  return {
    title: `Settle couldn’t stop ${names([...new Set(blocked.map((worker) => worker.blockName))])}`,
    next: unsupported
      ? `This T3 version can’t stop worker threads. Stop ${them} in T3, then retry settlement.`
      : `T3 didn’t confirm the stop. Retry settlement, or stop ${them} in T3.`,
  };
}

/** Title and next action of a missing or rejected report card. */
export function reportCopy(
  blockName: string,
  rejection: RunAttention | undefined,
  state: "missing" | "no-valid-report" | "requested",
) {
  const title =
    state === "no-valid-report"
      ? `${blockName} finished without a valid report`
      : rejection
        ? `${blockName} ${reportRejection(rejection.message)}`
        : `${blockName} finished without a report`;
  const next =
    state === "no-valid-report"
      ? "Request the report again, or check the Agent’s work in T3."
      : rejection
        ? "Request a report so the Agent corrects it without redoing the work."
        : "Request a report so the Agent reports its work without redoing it.";
  return { title, next };
}

/** Title and next action of every other Attention kind. */
export function matterCopy(item: RunAttention): { title: string; next: string | null } {
  const block = item.blockName ?? "Run";
  switch (item.kind) {
    case "execution-failed":
      return {
        title: `${block} failed in T3`,
        next: "Check the error and continue in T3. The Run continues when the Agent’s next turn completes or it reports.",
      };
    case "native-request":
      return { title: `${block} needs permission in T3`, next: null };
    case "conversation-waiting":
      return { title: `${block} asked a question`, next: "Answer it in T3." };
    case "condition-integrity":
      return {
        title: `${block} can’t count new arrivals`,
        next: "It accepts no more arrivals. Settle or archive the Run to end it.",
      };
    case "join-integrity":
      return {
        title: `${block} can’t forward its next round`,
        next: "It accepts no more arrivals. Settle or archive the Run to end it.",
      };
    case "report-problem":
      return {
        title: `${block} ${reportRejection(item.message)}`,
        next: "Check the Agent’s work in T3.",
      };
    case "missing-report":
      return reportCopy(block, undefined, "missing");
    case "human":
    case "subflow-stop-unresolved":
      return { title: block + " could not stop its workers", next: item.message };
    case "settlement-unresolved":
      return { title: block, next: null };
  }
}
