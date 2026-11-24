import type * as SqlClient from "effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import { handoffRecipients } from "@agent-easel/domain-validation";
import { fingerprint } from "../../fingerprint.ts";
import { failure } from "../../result.ts";
import { now } from "../../time.ts";
import { newId } from "../../ids.ts";
import { runTarget, type RunRow } from "../runner-types.ts";
import type { RunnerDatabase } from "./database.ts";
import { guardsHold } from "./guards.ts";
import {
  arrivingHandoff,
  clearSpentArrivalMessages,
  createHandoffs,
  storedProvenance,
} from "./handoffs.ts";
import { activateInvocation, enqueueInvocation, type Invocation } from "./invocation-entry.ts";
import { invocationTree, priorInvocationStop } from "./invocation-cutoff.ts";
import { definitionsAtBlock } from "./run-definitions.ts";
import type { Handoff } from "./records.ts";
import { advanceGeneration, appendTimelineEvent } from "./steps.ts";
import { settleAttention } from "./attention.ts";
import { writeBlockState } from "./blocks.ts";

type StoppingInvocation = Invocation & { stop_attempt: number };

type EndingRecord = {
  ending_id: string;
  output: string | null;
  binding_id: string | null;
  origin_activation_id: string | null;
};

const entry = (run: RunRow, time: string, input: string, carriesStart: boolean) => ({
  runId: run.id,
  definitions: run.definitions,
  contextId: run.context_id,
  target: runTarget(run),
  time,
  input,
  carriesStart,
});

const readStopping = (sql: SqlClient.SqlClient, runId: string) =>
  sql<StoppingInvocation>`SELECT * FROM subflow_invocations WHERE run_id=${runId} AND state='stopping' ORDER BY rowid`;

function nextInvocation(sql: SqlClient.SqlClient, run: RunRow, placement: string, time: string) {
  return Effect.gen(function* () {
    const [next] = yield* sql<Invocation>`SELECT * FROM subflow_invocations
      WHERE run_id=${run.id} AND placement_block_id=${placement} AND state='queued' ORDER BY number LIMIT 1`;
    if (next)
      yield* activateInvocation(sql, entry(run, time, next.input, next.entry_input === 1), next);
  });
}

function stopProblem(
  sql: SqlClient.SqlClient,
  run: RunRow,
  invocation: StoppingInvocation,
  problem: string,
  time: string,
) {
  return Effect.gen(function* () {
    const id = yield* newId;
    const [added] =
      yield* sql`INSERT INTO run_attention(id,run_id,block_id,execution_id,kind,source_key,appeared_at,message)
      VALUES(${id},${run.id},${invocation.placement_block_id},${invocation.id},'subflow-stop-unresolved',${"subflow-stop:" + invocation.id + ":" + invocation.stop_attempt},${time},${problem})
      ON CONFLICT(run_id,source_key) DO NOTHING RETURNING id`;
    if (!added) return false;
    yield* appendTimelineEvent(sql, {
      kind: "attention-appeared",
      runId: run.id,
      blockId: invocation.placement_block_id,
      executionId: invocation.id,
      attentionId: id,
      observedAt: time,
    });
    yield* advanceGeneration(sql, run.id);
    return true;
  });
}

function settleStopProblem(sql: SqlClient.SqlClient, id: string, time: string) {
  return Effect.gen(function* () {
    const matters = yield* sql<{ id: string; runId: string; blockId: string; executionId: string }>`
      SELECT id,run_id AS runId,block_id AS blockId,execution_id AS executionId FROM run_attention
      WHERE execution_id=${id} AND kind='subflow-stop-unresolved' AND settled_at IS NULL`;
    yield* settleAttention(sql, matters, "finish", time);
  });
}

export function openRunInvocations(database: RunnerDatabase) {
  const { owner, mutate, transaction } = database;

  function handoffToInvocation(run: RunRow, handoff: Handoff, generation?: number) {
    return mutate(
      run.id,
      (sql) =>
        Effect.gen(function* () {
          const arrival = yield* arrivingHandoff(sql, owner.token, run.id, handoff, generation);
          if (!arrival) return false;
          const block = run.definitions.flow.graph.blocks.find(
            (item) => item.id === handoff.block_id,
          );
          if (block?.kind !== "subflow" || block.flowId === null)
            return yield* Effect.fail(Error("A Subflow arrival lost its captured placement."));
          const time = yield* now;
          const work = entry(run, time, arrival.message, false);
          const invocation = yield* enqueueInvocation(
            sql,
            work,
            { id: block.id, flowId: block.flowId },
            run.definitions.invocation?.id ?? null,
            handoff.id,
          );
          yield* activateInvocation(sql, work, invocation);
          yield* sql`UPDATE operation_intents SET state='acknowledged',payload_json=NULL,problem=NULL,reconciled_at=${time} WHERE id=${handoff.id}`;
          yield* clearSpentArrivalMessages(sql, run.id);
          yield* advanceGeneration(sql, run.id);
          return true;
        }),
      Boolean,
    );
  }

  function readyToCloseInvocation(run: RunRow) {
    return mutate(
      run.id,
      (sql) =>
        Effect.gen(function* () {
          if (!(yield* database.runHeldUnderContext(sql, run, true))) return false;
          const [quiet] = yield* sql<{
            id: string;
            placement_block_id: string;
          }>`SELECT i.id,i.placement_block_id
        FROM subflow_invocations i WHERE i.run_id=${run.id} AND i.state='active'
        AND NOT EXISTS(SELECT 1 FROM subflow_invocations j WHERE j.parent_id=i.id AND j.state IN ('queued','active','stopping'))
        AND NOT EXISTS(SELECT 1 FROM run_blocks b WHERE b.invocation_id=i.id AND (
          b.state='error'
          OR (b.thread_id IS NOT NULL AND (b.state<>'finished' OR b.worker_finished=0 OR b.freshness<>'fresh'))
          OR EXISTS(SELECT 1 FROM operation_intents w WHERE w.run_id=b.run_id AND w.block_id=b.block_id AND w.state IN ('pending','reserved','uncertain'))
          OR EXISTS(SELECT 1 FROM human_occurrences h WHERE h.run_id=b.run_id AND h.block_id=b.block_id AND h.state='pending')
          OR EXISTS(SELECT 1 FROM wait_arrivals w WHERE w.run_id=b.run_id AND w.block_id=b.block_id AND w.state='pending')
          OR EXISTS(SELECT 1 FROM join_arrivals j WHERE j.run_id=b.run_id AND j.block_id=b.block_id AND j.round_id IS NULL AND j.cancelled_at IS NULL)
          OR EXISTS(SELECT 1 FROM continuation_visits v WHERE v.run_id=b.run_id AND v.block_id=b.block_id AND v.state IN ('queued','sent'))
          OR EXISTS(SELECT 1 FROM run_attention a WHERE a.run_id=b.run_id AND a.block_id=b.block_id AND a.settled_at IS NULL)
        )) ORDER BY i.rowid DESC LIMIT 1`;
          if (!quiet) return false;
          const time = yield* now;
          yield* sql`UPDATE subflow_invocations SET state='nothing-returned',completed_at=${time} WHERE id=${quiet.id}`;
          yield* appendTimelineEvent(sql, {
            kind: "subflow-nothing-returned",
            runId: run.id,
            blockId: quiet.placement_block_id,
            invocationId: quiet.id,
            observedAt: time,
          });
          yield* nextInvocation(sql, run, quiet.placement_block_id, time);
          yield* advanceGeneration(sql, run.id);
          return true;
        }),
      Boolean,
    );
  }

  function completeInvocation(run: RunRow, invocation: StoppingInvocation, generation: number) {
    return mutate(
      run.id,
      (sql) =>
        Effect.gen(function* () {
          if (
            !(yield* guardsHold(sql, owner.token, run.id, {
              gateOpen: true,
              owner: true,
              liveContext: run.context_id,
              generation,
            }))
          )
            return false;
          const time = yield* now;
          const [closed] =
            yield* sql`UPDATE subflow_invocations SET state='returned',completed_at=${time}
        WHERE id=${invocation.id} AND state='stopping' AND stop_attempt=${invocation.stop_attempt}
        RETURNING id`;
          if (!closed) return false;
          const [result] = yield* sql<EndingRecord>`UPDATE subflow_results SET released_at=${time}
        WHERE invocation_id=${invocation.id} AND cancelled_at IS NULL RETURNING *`;
          if (!result)
            return yield* Effect.fail(
              Error("An invocation is stopping without accepted ending evidence."),
            );
          const definitions = yield* definitionsAtBlock(sql, run, invocation.placement_block_id);
          const exit = result.ending_id;
          const recipients = handoffRecipients(
            definitions.flow.graph.connections,
            invocation.placement_block_id,
            exit,
          );
          yield* createHandoffs(
            sql,
            { ...run, definitions },
            {
              kind: "subflow",
              id: invocation.id,
              blockId: invocation.placement_block_id,
              exitId: exit,
              recipients,
              message: result.output ?? "",
              at: time,
              origin: storedProvenance(result),
            },
          );
          yield* sql`UPDATE operation_intents SET state='cancelled',payload_json=NULL,problem='cancelled-on-Subflow-Finish',reconciled_at=${time}
        WHERE run_id=${run.id} AND block_id IN (SELECT block_id FROM run_blocks WHERE invocation_id IN (${invocationTree(sql, invocation.id)}))
          AND kind='send' AND state IN ('reserved','uncertain')`;
          const stopped = yield* sql<{
            block_id: string;
          }>`SELECT block_id FROM run_blocks WHERE run_id=${run.id}
        AND invocation_id IN (${invocationTree(sql, invocation.id)})`;
          for (const { block_id } of stopped)
            yield* writeBlockState(
              sql,
              { runId: run.id, blockId: block_id },
              { keep: ["finished", "not-started", "pass-through"], otherwise: "stopped" },
            );
          yield* settleStopProblem(sql, invocation.id, time);
          yield* appendTimelineEvent(sql, {
            kind: "subflow-released",
            runId: run.id,
            blockId: invocation.placement_block_id,
            invocationId: invocation.id,
            observedAt: time,
          });
          yield* nextInvocation(sql, run, invocation.placement_block_id, time);
          yield* advanceGeneration(sql, run.id);
          return true;
        }),
      Boolean,
    );
  }

  function invocationWorkers(runId: string, invocationId: string) {
    return transaction((sql) =>
      Effect.gen(function* () {
        const tree = invocationTree(sql, invocationId);
        const workers = yield* sql<{
          thread_id: string;
          block_id: string;
        }>`SELECT b.thread_id,b.block_id FROM run_thread_bindings b
        JOIN run_blocks r ON r.run_id=b.run_id AND r.block_id=b.block_id
        WHERE b.run_id=${runId} AND b.role='worker' AND r.invocation_id IN (${tree}) ORDER BY b.rowid`;
        const launches =
          yield* sql`SELECT i.id FROM operation_intents i JOIN run_blocks r ON r.run_id=i.run_id AND r.block_id=i.block_id
        WHERE i.run_id=${runId} AND r.invocation_id IN (${tree}) AND i.kind='launch' AND i.state IN ('reserved','uncertain')`;
        return { workers, hasUnboundLaunch: launches.length > 0 };
      }),
    );
  }

  function claimInvocationStop(
    run: RunRow,
    invocation: StoppingInvocation,
    worker: { thread_id: string; block_id: string },
    executionId: string | null,
  ) {
    return mutate(
      run.id,
      (sql) =>
        Effect.gen(function* () {
          if (!(yield* database.runHeldUnderContext(sql, run, true))) return null;
          const key = fingerprint(
            run.id +
              ":subflow-stop:" +
              invocation.id +
              ":" +
              invocation.stop_attempt +
              ":" +
              worker.thread_id,
          );
          const time = yield* now;
          const [claimed] =
            yield* sql`INSERT INTO subflow_worker_stops(invocation_id,attempt,thread_id,block_id,execution_id,request_key,requested_at)
        SELECT id,stop_attempt,${worker.thread_id},${worker.block_id},${executionId},${key},${time}
        FROM subflow_invocations WHERE id=${invocation.id} AND state='stopping' AND stop_attempt=${invocation.stop_attempt}
        AND NOT EXISTS(SELECT 1 FROM subflow_worker_stops s JOIN subflow_invocations p ON p.id=s.invocation_id WHERE p.run_id=${run.id} AND s.thread_id=${worker.thread_id}
          AND s.execution_id IS ${executionId} AND s.invocation_id<>${invocation.id} AND ${invocation.stop_attempt}=1)
        ON CONFLICT DO NOTHING RETURNING request_key`;
          if (!claimed) return null;
          yield* appendTimelineEvent(sql, {
            kind: "worker-stop-requested",
            runId: run.id,
            blockId: worker.block_id,
            executionId,
            requestKey: key,
            observedAt: time,
          });
          return key;
        }),
      (key) => key !== null,
    );
  }

  return {
    handoffToInvocation,
    readyToCloseInvocation,
    completeInvocation,
    invocationWorkers,
    claimInvocationStop,
    invocationNeedsRetry: (id: string) =>
      transaction((sql) =>
        Effect.map(
          sql`SELECT 1 FROM run_attention
      WHERE execution_id=${id} AND kind='subflow-stop-unresolved' AND settled_at IS NULL`,
          (rows) => rows.length > 0,
        ),
      ),
    invocationStop: (
      runId: string,
      invocation: StoppingInvocation,
      threadId: string,
      executionId: string | null,
    ) =>
      transaction((sql) =>
        Effect.gen(function* () {
          const [current] = yield* sql<{
            requested_at: string;
            outcome: "acknowledged" | "failed" | null;
          }>`
          SELECT requested_at,outcome FROM subflow_worker_stops WHERE invocation_id=${invocation.id}
            AND attempt=${invocation.stop_attempt} AND thread_id=${threadId}`;
          if (current || invocation.stop_attempt !== 1) return current;
          return yield* priorInvocationStop(sql, runId, threadId, executionId, invocation.id);
        }),
      ),
    stoppingInvocations: (runId: string) => transaction((sql) => readStopping(sql, runId)),
    recordInvocationStop: (runId: string, key: string, outcome: "acknowledged" | "failed") =>
      mutate(runId, (sql) =>
        Effect.asVoid(
          sql`UPDATE subflow_worker_stops SET outcome=${outcome} WHERE request_key=${key}`,
        ),
      ),
    invocationUnresolved: (run: RunRow, invocation: StoppingInvocation, problem: string) =>
      mutate(
        run.id,
        (sql) =>
          Effect.gen(function* () {
            if (!(yield* guardsHold(sql, owner.token, run.id, { gateOpen: true, owner: true })))
              return false;
            const [current] = yield* readStopping(sql, run.id).pipe(
              Effect.map((rows) =>
                rows.filter(
                  (row) => row.id === invocation.id && row.stop_attempt === invocation.stop_attempt,
                ),
              ),
            );
            return current ? yield* stopProblem(sql, run, current, problem, yield* now) : false;
          }),
        Boolean,
      ),
    retryInvocation: (runId: string, invocationId: string, contextId: string) =>
      mutate(
        runId,
        (sql) =>
          Effect.gen(function* () {
            const held = yield* guardsHold(sql, owner.token, runId, {
              owner: true,
              gateOpen: true,
              liveContext: contextId,
            });
            if (!held)
              return failure("conflict", "The Run is closed or the authorization has changed.");
            const [retry] = yield* sql`UPDATE subflow_invocations SET stop_attempt=stop_attempt+1
          WHERE run_id=${runId} AND id=${invocationId} AND state='stopping'
          AND EXISTS(SELECT 1 FROM run_attention WHERE run_id=${runId} AND execution_id=${invocationId} AND kind='subflow-stop-unresolved' AND settled_at IS NULL)
          RETURNING id`;
            if (!retry)
              return failure("conflict", "This invocation has no unresolved Stop to retry.");
            yield* settleStopProblem(sql, invocationId, yield* now);
            yield* advanceGeneration(sql, runId);
            return { ok: true as const, value: undefined };
          }),
        (result) => result.ok,
      ),
  };
}
