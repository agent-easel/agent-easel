import { threadHref } from "../../thread-link.ts";
import type { RunAttention } from "@agent-easel/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
/** Every attention matter, newest first. A Run-level matter has no Block, link or observation:
 * it is Factory's own record, so it reads fresh. */
export function attentionRows(sql: SqlClient.SqlClient, runId?: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      id: string;
      binding_id: string | null;
      invocation_id: string | null;
      run_id: string;
      title: string;
      block_id: string | null;
      name: string | null;
      execution_id: string;
      kind: RunAttention["kind"];
      native_request_id: string | null;
      occurrence_id: string | null;
      link: string | null;
      freshness: RunAttention["freshness"];
      appeared_at: string;
      settled_at: string | null;
      settlement_reason: string | null;
      message: string | null;
    }>`
      SELECT a.*,CASE WHEN a.kind='subflow-stop-unresolved' THEN a.execution_id ELSE b.invocation_id END AS invocation_id,t.title,b.name,CASE WHEN a.binding_id IS NOT NULL THEN binding.link ELSE b.link END AS link,
      CASE WHEN a.block_id IS NULL THEN 'fresh' ELSE b.freshness END AS freshness FROM run_attention a JOIN runs r ON r.id=a.run_id
      JOIN tasks t ON t.id=r.task_id LEFT JOIN run_blocks b ON b.run_id=a.run_id AND b.block_id=a.block_id
      LEFT JOIN run_thread_bindings binding ON binding.id=a.binding_id
      WHERE (${runId ?? null} IS NULL OR a.run_id=${runId ?? null}) ORDER BY a.appeared_at DESC,a.rowid DESC`;
    return rows.map((attentionEntry) => ({
      id: attentionEntry.id,
      ...(attentionEntry.invocation_id ? { invocationId: attentionEntry.invocation_id } : {}),
      ...(attentionEntry.binding_id ? { bindingId: attentionEntry.binding_id } : {}),
      runId: attentionEntry.run_id,
      taskTitle: attentionEntry.title,
      blockId: attentionEntry.block_id,
      blockName: attentionEntry.name,
      executionId: attentionEntry.execution_id,
      kind: attentionEntry.kind,
      nativeRequestId: attentionEntry.native_request_id,
      occurrenceId: attentionEntry.occurrence_id,
      link: threadHref(attentionEntry.link),
      freshness: attentionEntry.freshness,
      appearedAt: attentionEntry.appeared_at,
      settledAt: attentionEntry.settled_at,
      settlementReason: attentionEntry.settlement_reason,
      message: attentionEntry.message,
    }));
  });
}
