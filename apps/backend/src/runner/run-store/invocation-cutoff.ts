import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { settleAttention } from "./attention.ts";
import { clearSpentArrivalMessages } from "./handoffs.ts";

export const invocationTree = (sql: SqlClient.SqlClient, invocationId: string) => sql`
  WITH RECURSIVE tree(id) AS (
    SELECT ${invocationId} UNION ALL SELECT i.id FROM subflow_invocations i JOIN tree t ON i.parent_id=t.id
  ) SELECT id FROM tree`;

export function cancelInvocationWork(
  sql: SqlClient.SqlClient,
  runId: string,
  invocationId: string | null,
  time: string,
) {
  return Effect.gen(function* () {
    const descendants =
      invocationId === null
        ? sql`SELECT id FROM subflow_invocations WHERE run_id=${runId}`
        : invocationTree(sql, invocationId);
    yield* sql`UPDATE subflow_invocations SET state='cancelled',completed_at=${time}
      WHERE id IN (${descendants}) AND id IS NOT ${invocationId} AND state IN ('queued','active','stopping')`;
    yield* sql`UPDATE subflow_results SET cancelled_at=${time}
      WHERE invocation_id IN (${descendants}) AND invocation_id IS NOT ${invocationId}
        AND released_at IS NULL AND cancelled_at IS NULL`;
    if (invocationId === null) return;
    const blocks = sql`SELECT block_id FROM run_blocks WHERE run_id=${runId} AND invocation_id IN (${descendants})`;
    yield* sql`UPDATE operation_intents SET state='cancelled',payload_json=NULL,problem='cancelled-on-Subflow-Finish',reconciled_at=${time}
      WHERE run_id=${runId} AND block_id IN (${blocks}) AND state='pending'`;
    yield* sql`UPDATE human_occurrences SET state='cancelled',pending_context=NULL,settled_at=${time}
      WHERE run_id=${runId} AND block_id IN (${blocks}) AND state='pending'`;
    yield* sql`UPDATE wait_arrivals SET state='cancelled',message=NULL,settled_at=${time}
      WHERE run_id=${runId} AND block_id IN (${blocks}) AND state='pending'`;
    yield* sql`UPDATE condition_arrivals SET state='cancelled',cancelled_at=${time}
      WHERE run_id=${runId} AND block_id IN (${blocks}) AND state='pending'`;
    yield* sql`UPDATE continuation_visits SET state='cancelled'
      WHERE run_id=${runId} AND block_id IN (${blocks}) AND state IN ('queued','sent')`;
    const matters = yield* sql<{ id: string; blockId: string; executionId: string }>`
      SELECT id,block_id AS blockId,execution_id AS executionId FROM run_attention
      WHERE run_id=${runId} AND block_id IN (${blocks}) AND settled_at IS NULL`;
    yield* settleAttention(
      sql,
      matters.map((matter) => ({ ...matter, runId })),
      "finish",
      time,
    );
    yield* clearSpentArrivalMessages(sql, runId);
  });
}

export function priorInvocationStop(
  sql: SqlClient.SqlClient,
  runId: string,
  threadId: string,
  executionId: string | null,
  excludeId?: string,
) {
  return Effect.map(
    sql<{ request_key: string; requested_at: string; outcome: "acknowledged" | "failed" | null }>`
    SELECT s.request_key,s.requested_at,s.outcome FROM subflow_worker_stops s
    JOIN subflow_invocations i ON i.id=s.invocation_id
    WHERE i.run_id=${runId} AND s.thread_id=${threadId} AND s.execution_id IS ${executionId}
      AND i.id IS NOT ${excludeId ?? null}
    ORDER BY s.rowid DESC LIMIT 1`,
    ([row]) => row,
  );
}
