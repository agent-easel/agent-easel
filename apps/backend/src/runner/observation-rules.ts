import type { RunBlock } from "@t3-factory/contracts";
import type { WorkerThread } from "./worker-thread.ts";

/** A failed, cancelled, interrupted or rolled-back run is an execution failure of its Block. */
export const failedRun = (status: string | undefined) =>
  status === "failed" ||
  status === "cancelled" ||
  status === "interrupted" ||
  status === "rolled_back";

type ThreadRunRead = WorkerThread["thread"]["recentRuns"][number];

/** A run T3 cancelled before it started. Only an explicit null start counts: a read without start
 * evidence does not show that the run did no work. */
export const cancelledBeforeStart = (run: ThreadRunRead) =>
  run.status === "cancelled" && run.startedAt === null;

/** The run whose status decides the Block's execution failure. After a finished report, a later
 * run of the Block's own that T3 cancelled before it started did no work, so the newest run that
 * started decides; the turn that produced the report can still fail the Block. Otherwise the
 * latest run. */
export function decidingRun(
  { thread, latest }: WorkerThread,
  current: ReportStatus,
  ownedByBlock: (runId: string) => boolean,
) {
  if (current !== "finished" || !latest || !cancelledBeforeStart(latest)) return latest;
  if (!ownedByBlock(latest.runId)) return latest;
  return thread.recentRuns
    .filter((run) => !cancelledBeforeStart(run))
    .reduce<ThreadRunRead | null>(
      (best, run) => (!best || (run.ordinal ?? 0) >= (best.ordinal ?? 0) ? run : best),
      null,
    );
}

/** The status of the current report of the Block's activation, if any. */
type ReportStatus = "finished" | "working" | undefined;

/** Missing report: the thread is finished, its latest run completed, and the current activation
 * has no current report. */
export function missingReport({ finished, latest }: WorkerThread, current: ReportStatus) {
  return finished && latest?.status === "completed" && !current;
}

export function blockState(
  problem: string | null,
  { finished }: WorkerThread,
  current: ReportStatus,
): RunBlock["state"] {
  if (problem) return "error";
  return current === "finished" && finished ? "finished" : "working";
}
