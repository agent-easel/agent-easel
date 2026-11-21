import type { RunAttention, RunPullRequest } from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import type * as SqlClient from "effect/sql/SqlClient";
import {
  blockState,
  cancelledBeforeStart,
  decidingRun,
  failedRun,
  missingReport,
} from "../observation-rules.ts";
import type { BlockRow, RunRow } from "../runner-types.ts";
import { now } from "../../time.ts";
import type { WorkerThread } from "../worker-thread.ts";
import { recordActivationPhase } from "./activations.ts";
import { observeAttention, settlePendingAttention } from "./attention.ts";
import { currentReports } from "./current-report.ts";
import { refreshWorkerLink } from "./deliveries.ts";
import { guardsHold } from "./guards.ts";
import type { RunnerDatabase } from "./database.ts";
import { advanceGeneration, appendTimelineEvent } from "./steps.ts";
import { writeBlockState } from "./blocks.ts";

const comparePullRequests = (a: RunPullRequest, b: RunPullRequest) =>
  a.host.localeCompare(b.host) || a.repository.localeCompare(b.repository) || a.number - b.number;

function recordWorkerRepository(
  sql: SqlClient.SqlClient,
  bindingId: string,
  repository: WorkerThread["thread"]["repository"],
  time: string,
) {
  return Effect.gen(function* () {
    if (!repository) return;
    const [prior] = yield* sql<{
      branch: string | null;
    }>`SELECT branch FROM worker_repositories WHERE binding_id=${bindingId}`;
    const previous =
      yield* sql<RunPullRequest>`SELECT host,repository,number,url,state FROM worker_pull_requests WHERE binding_id=${bindingId} ORDER BY host,repository,number`;
    const current = [
      ...new Map(
        repository.pullRequests.map((pr) => [`${pr.host}/${pr.repository}/${pr.number}`, pr]),
      ).values(),
    ].sort(comparePullRequests);
    // Unchanged reads must not create navigation changes or replace the Run header.
    if (
      prior?.branch === repository.branch &&
      Equal.equals([...previous].sort(comparePullRequests), current)
    )
      return;
    yield* sql`INSERT INTO worker_repositories(binding_id,branch,updated_at) VALUES(${bindingId},${repository.branch},${time}) ON CONFLICT(binding_id) DO UPDATE SET branch=excluded.branch,updated_at=excluded.updated_at`;
    yield* sql`DELETE FROM worker_pull_requests WHERE binding_id=${bindingId}`;
    for (const pr of current)
      yield* sql`INSERT INTO worker_pull_requests(binding_id,host,repository,number,url,state) VALUES(${bindingId},${pr.host},${pr.repository},${pr.number},${pr.url},${pr.state}) ON CONFLICT(binding_id,host,repository,number) DO UPDATE SET url=excluded.url,state=excluded.state`;
  });
}

/** One T3 run of a worker thread as a fresh read showed it. */
type ExecutionRead = WorkerThread["thread"]["recentRuns"][number];

/**
 * Records `execution` of `scope`'s worker thread: its engine status, ordinal and native request
 * count, with `execution-observed` when its status changed. A new record belongs to `scope`'s
 * Block. `problem` replaces the recorded Problem; `"keep"` leaves an existing one and gives a new
 * record none.
 */
export function recordExecution(
  sql: SqlClient.SqlClient,
  scope: {
    readonly runId: string;
    readonly blockId: string;
    readonly threadId: string;
    readonly bindingId: string;
  },
  execution: ExecutionRead,
  nativeRequestCount: number,
  problem: "execution-failed" | null | "keep",
  time: string,
) {
  return Effect.gen(function* () {
    const { runId, blockId, threadId, bindingId } = scope;
    const [previous] = yield* sql<{
      engine_status: string;
    }>`SELECT engine_status FROM run_executions WHERE run_id=${runId} AND thread_id=${threadId} AND execution_id=${execution.runId}`;
    const keep = problem === "keep" ? 1 : 0;
    const recorded = problem === "keep" ? null : problem;
    yield* sql`INSERT INTO run_executions(run_id,block_id,thread_id,execution_id,binding_id,engine_status,ordinal,observed_at,problem,native_request_count) VALUES(${runId},${blockId},${threadId},${execution.runId},${bindingId},${execution.status},${execution.ordinal ?? null},${time},${recorded},${nativeRequestCount}) ON CONFLICT(run_id,thread_id,execution_id) DO UPDATE SET engine_status=excluded.engine_status,ordinal=COALESCE(excluded.ordinal,run_executions.ordinal),observed_at=excluded.observed_at,problem=CASE WHEN ${keep}=1 THEN run_executions.problem ELSE excluded.problem END,native_request_count=excluded.native_request_count`;
    if (previous?.engine_status !== execution.status)
      yield* appendTimelineEvent(sql, {
        kind: "execution-observed",
        runId,
        blockId,
        executionId: execution.runId,
        bindingId,
        engineStatus: execution.status,
        observedAt: time,
      });
  });
}

/** The Problem recorded on `execution`: a failed run is an execution failure, unless it did no work
 * after the Block's finished report (`noWork`). A run cancelled before it started keeps the
 * classification recorded when it was first seen cancelled once it no longer decides. */
function executionProblem(
  execution: ExecutionRead,
  deciding: ExecutionRead | null,
  noWork: boolean,
  recordedCancelled: boolean,
): "execution-failed" | null | "keep" {
  if (!failedRun(execution.status)) return null;
  if (execution.runId === deciding?.runId) return "execution-failed";
  if (cancelledBeforeStart(execution) && recordedCancelled) return "keep";
  return noWork ? null : "execution-failed";
}

/** The Block's current finished report: when it was accepted and the turn it came from, when
 * Factory observed that turn at acceptance. Null while the current report is not finished. */
function currentFinishedReport(sql: SqlClient.SqlClient, runId: string, blockId: string) {
  return Effect.gen(function* () {
    const activation = (yield* currentReports(sql, runId)).find(
      (entry) => entry.blockId === blockId,
    );
    if (activation?.report?.status !== "finished") return null;
    const [report] = yield* sql<{
      reporting_execution_id: string | null;
      accepted_at: string;
    }>`SELECT reporting_execution_id,accepted_at FROM runtime_reports WHERE activation_id=${activation.activationId} AND status='finished' ORDER BY rowid DESC LIMIT 1`;
    return report ?? null;
  });
}

function recordExecutions(
  sql: SqlClient.SqlClient,
  run: RunRow,
  block: BlockRow,
  bindingId: string,
  { thread }: WorkerThread,
  deciding: ExecutionRead | null,
  noWork: (execution: ExecutionRead) => boolean,
  recordedCancelled: (runId: string) => boolean,
  time: string,
) {
  return Effect.gen(function* () {
    const scope = {
      runId: run.id,
      blockId: block.block_id,
      threadId: thread.threadId,
      bindingId,
    };
    for (const execution of thread.recentRuns)
      yield* recordExecution(
        sql,
        scope,
        execution,
        thread.pendingRequestCount,
        executionProblem(
          execution,
          deciding,
          noWork(execution),
          recordedCancelled(execution.runId),
        ),
        time,
      );
  });
}

function workerObservation(worker: WorkerThread, time: string, ownsLatest: boolean) {
  return {
    worker_finished: ownsLatest && worker.finished ? 1 : 0,
    freshness: "fresh",
    observed_at: time,
    pending_request_count: worker.thread.pendingRequestCount,
  } as const;
}

function recordActivation(
  sql: SqlClient.SqlClient,
  run: RunRow,
  block: BlockRow,
  worker: WorkerThread,
  time: string,
) {
  return Effect.gen(function* () {
    const { latest } = worker;
    const activation = (yield* currentReports(sql, run.id)).find(
      (entry) => entry.blockId === block.block_id,
    );
    if (!activation) throw Error("Activation is missing.");
    const current = activation.report?.status;
    if (latest) {
      const missing = missingReport(worker, current);
      yield* observeAttention(sql, run.id, block, latest.runId, "missing-report", missing, time);
      if (missing)
        yield* sql`UPDATE run_executions SET problem='missing-report' WHERE run_id=${run.id} AND thread_id=${block.thread_id} AND execution_id=${latest.runId}`;
    }
    const [pending] = yield* sql<{
      kind: RunAttention["kind"];
    }>`SELECT kind FROM run_attention WHERE run_id=${run.id} AND block_id=${block.block_id} AND kind IN ('execution-failed','missing-report') AND settled_at IS NULL ORDER BY kind LIMIT 1`;
    const problem = pending?.kind ?? null;
    const phase = current === "finished" ? "reported" : "assessing";
    yield* recordActivationPhase(sql, activation.activationId, phase, problem);
    yield* writeBlockState(
      sql,
      { runId: run.id, blockId: block.block_id },
      blockState(problem, worker, current),
      {
        execution_id: latest?.runId ?? block.execution_id,
        engine_status: latest?.status ?? null,
        ...workerObservation(worker, time, latest !== null),
        problem,
      },
    );
  });
}

/**
 * The Continuations whose prompt runs on this worker thread and is not yet forwarded: a missing
 * report after their run, attention and their `sent` or `error` state. The worker's own Block
 * shows the thread working meanwhile.
 */
function recordContinuations(
  sql: SqlClient.SqlClient,
  run: RunRow,
  bindingId: string,
  worker: WorkerThread,
  latestOwner: string,
  time: string,
) {
  return Effect.gen(function* () {
    const visits = yield* sql<{
      block_id: string;
      activation_id: string;
    }>`SELECT block_id,activation_id FROM continuation_visits WHERE run_id=${run.id} AND binding_id=${bindingId} AND kind='prompt' AND state='sent'`;
    if (!visits.length) return;
    const reports = yield* currentReports(sql, run.id);
    const { latest } = worker;
    for (const visit of visits) {
      const current = reports.find((entry) => entry.activationId === visit.activation_id)?.report
        ?.status;
      const owned = latest && latestOwner === visit.block_id;
      if (owned) {
        const missing = missingReport(worker, current);
        yield* observeAttention(
          sql,
          run.id,
          { block_id: visit.block_id },
          latest.runId,
          "missing-report",
          missing,
          time,
        );
        if (missing)
          yield* sql`UPDATE run_executions SET problem='missing-report' WHERE run_id=${run.id} AND thread_id=${worker.thread.threadId} AND execution_id=${latest.runId}`;
      }
      const [pending] = yield* sql<{
        kind: RunAttention["kind"];
      }>`SELECT kind FROM run_attention WHERE run_id=${run.id} AND block_id=${visit.block_id} AND kind IN ('execution-failed','missing-report') AND settled_at IS NULL ORDER BY kind LIMIT 1`;
      const problem = pending?.kind ?? null;
      yield* recordActivationPhase(
        sql,
        visit.activation_id,
        current === "finished" ? "reported" : "assessing",
        problem,
      );
      yield* writeBlockState(
        sql,
        { runId: run.id, blockId: visit.block_id },
        problem ? "error" : "sent",
        {
          ...(owned ? { execution_id: latest.runId, engine_status: latest.status } : {}),
          ...workerObservation(worker, time, Boolean(owned)),
          problem,
        },
      );
    }
  });
}

function recordWorkerAttention(
  sql: SqlClient.SqlClient,
  context: {
    runId: string;
    blockId: string;
    bindingId: string;
    ownsBlock: boolean;
    latestOwner: string;
    decidingOwner: string;
  },
  worker: WorkerThread,
  deciding: ExecutionRead | null,
  time: string,
) {
  return Effect.gen(function* () {
    const ownerScope = { block_id: deciding ? context.decidingOwner : context.blockId };
    const ownsCurrentWork = context.ownsBlock || ownerScope.block_id !== context.blockId;
    if (ownsCurrentWork)
      yield* observeAttention(
        sql,
        context.runId,
        {
          bindingId: context.bindingId,
          block_id: context.ownsBlock ? context.blockId : context.latestOwner,
        },
        worker.latest?.runId ?? "",
        "native-request",
        worker.thread.pendingRequestCount > 0,
        time,
      );
    if (ownsCurrentWork && deciding && failedRun(deciding.status))
      yield* observeAttention(
        sql,
        context.runId,
        ownerScope,
        deciding.runId,
        "execution-failed",
        true,
        time,
      );
    // A later run of the thread that completes recovers earlier execution failures.
    if (deciding?.status === "completed")
      yield* settlePendingAttention(
        sql,
        context.runId,
        ownerScope.block_id,
        "execution-failed",
        "completed",
        time,
      );
  });
}

function recordWorkerThread(
  sql: SqlClient.SqlClient,
  run: RunRow,
  block: BlockRow,
  worker: WorkerThread,
  time: string,
) {
  return Effect.gen(function* () {
    const { thread, latest } = worker;
    const [binding] = yield* sql<{
      id: string;
    }>`SELECT id FROM run_thread_bindings WHERE run_id=${run.id} AND thread_id=${thread.threadId}`;
    if (!binding) throw Error("Worker binding is missing.");
    yield* recordWorkerRepository(sql, binding.id, thread.repository, time);
    yield* refreshWorkerLink(sql, binding.id, thread.link);
    const [ownedHere] =
      yield* sql`SELECT 1 FROM run_blocks b WHERE b.run_id=${run.id} AND b.block_id=${block.block_id}
      AND NOT EXISTS(SELECT 1 FROM subflow_invocations i WHERE i.id=b.invocation_id AND i.state<>'active')`;

    // A run queued for a Continuation's prompt belongs to that Continuation, not to the worker's
    // Block: its failure is the Continuation's. A run not recorded yet is recorded as the Block's.
    const recorded = yield* sql<{
      execution_id: string;
      block_id: string;
      engine_status: string;
      ordinal: number | null;
      observed_at: string;
      problem: string | null;
    }>`SELECT execution_id,block_id,engine_status,ordinal,observed_at,problem FROM run_executions WHERE run_id=${run.id} AND thread_id=${thread.threadId}`;
    const recordOf = (runId: string) => recorded.find((entry) => entry.execution_id === runId);
    const ownerOf = (runId: string) => recordOf(runId)?.block_id ?? block.block_id;
    const report = yield* currentFinishedReport(sql, run.id, block.block_id);
    const reportingOrdinal = report?.reporting_execution_id
      ? (recordOf(report.reporting_execution_id)?.ordinal ?? null)
      : null;
    // The newest run an observation after the report's acceptance showed: T3 shows the run with
    // the highest ordinal as the latest, so a newer run did not exist yet.
    const seenAfterReport = report
      ? Math.max(
          -1,
          ...recorded
            .filter((entry) => entry.observed_at >= report.accepted_at)
            .map((entry) => entry.ordinal ?? -1),
        )
      : -1;
    // After the Block's finished report, a run of its own that T3 cancelled before it started did
    // no work when the evidence shows it was cancelled after the report: it is newer than the
    // reporting turn or than every run an observation after acceptance showed, or that
    // observation showed it not yet cancelled. Once recorded cancelled, its recorded Problem keeps
    // that judgement. Otherwise it is an execution failure as before.
    const noWork = (execution: ExecutionRead) => {
      if (!report || !cancelledBeforeStart(execution)) return false;
      if (ownerOf(execution.runId) !== block.block_id) return false;
      const prior = recordOf(execution.runId);
      if (prior?.engine_status === "cancelled") return prior.problem === null;
      if (prior && prior.observed_at >= report.accepted_at) return true;
      const ordinal = execution.ordinal;
      if (ordinal === undefined) return false;
      return (
        (reportingOrdinal !== null && ordinal > reportingOrdinal) ||
        (seenAfterReport >= 0 && ordinal > seenAfterReport)
      );
    };
    const deciding = decidingRun(worker, noWork);
    yield* recordExecutions(
      sql,
      run,
      block,
      binding.id,
      worker,
      deciding,
      noWork,
      (runId) => recordOf(runId)?.engine_status === "cancelled",
      time,
    );
    const latestOwner = latest ? ownerOf(latest.runId) : block.block_id;
    yield* recordWorkerAttention(
      sql,
      {
        runId: run.id,
        blockId: block.block_id,
        bindingId: binding.id,
        ownsBlock: Boolean(ownedHere),
        latestOwner,
        decidingOwner: deciding ? ownerOf(deciding.runId) : block.block_id,
      },
      worker,
      deciding,
      time,
    );
    if (ownedHere) yield* recordActivation(sql, run, block, worker, time);
    yield* recordContinuations(sql, run, binding.id, worker, latestOwner, time);
    yield* advanceGeneration(sql, run.id);
  });
}

export function openRunObservation(database: RunnerDatabase) {
  const ownerToken = database.owner.token;

  /** Records what T3 showed of `block`'s worker thread: work periods, native-request,
   * execution-failed and missing-report attention, the activation's phase, Block state and worker
   * repository metadata. `run` is the snapshot the thread was read at. Guards: owner, not
   * Archived, `run`'s authorization context is live and its generation holds, since a report or
   * Handoff accepted during the read makes the observation stale. Advances the generation. */
  const recordWorkerObservation = (run: RunRow, block: BlockRow, worker: WorkerThread) =>
    database.mutate(run.id, (sql) =>
      Effect.gen(function* () {
        if (!(yield* database.runHeldUnderContext(sql, run))) return;
        const unchanged = yield* guardsHold(sql, ownerToken, run.id, {
          generation: run.generation,
        });
        if (!unchanged) return;
        yield* recordWorkerThread(sql, run, block, worker, yield* now);
      }),
    );

  /** Marks `blockId`'s worker thread observation stale and unavailable. Guards: owner, not
   * Archived, `run`'s authorization context is live. Advances the generation. */
  const markObservationUnavailable = (run: RunRow, blockId: string) =>
    database.mutate(run.id, (sql) =>
      Effect.gen(function* () {
        if (!(yield* database.runHeldUnderContext(sql, run))) return;
        yield* sql`UPDATE run_blocks SET freshness='stale',problem='Worker thread observation unavailable.' WHERE run_id=${run.id} AND block_id=${blockId} AND NOT EXISTS(SELECT 1 FROM subflow_invocations i WHERE i.id=run_blocks.invocation_id AND i.state<>'active')`;
        yield* advanceGeneration(sql, run.id);
      }),
    );

  return { recordWorkerObservation, markObservationUnavailable };
}
