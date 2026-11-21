import type { ExecutionObservation, T3Threads } from "../t3/threads.ts";
import { runTarget, type RunRow } from "./runner-types.ts";
import { inRunWorkspace } from "./run-workspace.ts";

type ThreadRun = Pick<
  RunRow,
  "endpoint" | "environment_id" | "t3_project_id" | "workspace_root" | "workspace"
>;

/** One Block's worker thread as T3 reports it now. */
export interface WorkerThread {
  readonly thread: ExecutionObservation;
  /** The active run, else the latest one; null before T3 shows any run of the thread. */
  readonly latest: ExecutionObservation["recentRuns"][number] | null;
  /** The shared "worker thread finished" rule; see {@link readWorkerThread}. */
  readonly finished: boolean;
}

export function awaitingBackgroundWork(thread: ExecutionObservation): boolean {
  return (
    thread.status === "waiting" ||
    thread.pendingBackgroundTasks?.some((task) => task.awaited) === true
  );
}

export async function readWorkerThread(
  t3: T3Threads,
  run: ThreadRun,
  threadId: string,
): Promise<WorkerThread> {
  const target = runTarget(run);
  const thread = await t3.readExecution(target, threadId);
  if (
    thread.threadId !== threadId ||
    thread.projectId !== run.t3_project_id ||
    !inRunWorkspace(run, thread)
  )
    throw Error("Worker thread scope changed.");
  const latestId = thread.activeRunId ?? thread.latestRunId ?? null;
  const latest = thread.recentRuns.find((r) => r.runId === latestId) ?? null;
  if (
    thread.activeRunId ||
    thread.pendingRequestCount !== 0 ||
    awaitingBackgroundWork(thread) ||
    !latestId
  )
    return { thread, latest, finished: false };
  const settlement = await t3.readDelegatedSettlement(target, threadId, latestId);
  return { thread, latest, finished: settlement.state === "settled" };
}
