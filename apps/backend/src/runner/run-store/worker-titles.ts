import type { FlowBlock } from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { now } from "../../time.ts";
import { workerThreadTitle, workerTitleRequestId } from "../worker-title.ts";
import type { RunnerDatabase } from "./database.ts";
import { readFlowRevision } from "../../flow-revisions.ts";
import { guardsHold } from "./guards.ts";

type TitleRun = {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly title_revision: number;
  readonly flow_revision_id: string;
  readonly archived_at: string | null;
};
type TitleBinding = {
  readonly id: string;
  readonly block_id: string;
  readonly thread_id: string;
  readonly title_acknowledged: string | null;
  readonly title_sync_state: string | null;
};
export type WorkerTitleSyncClaim = {
  readonly bindingId: string;
  readonly runId: string;
  readonly threadId: string;
  readonly revision: number;
  readonly title: string;
  readonly requestId: string;
  readonly contextId: string;
  readonly endpoint: string;
  readonly environmentId: string;
};
function renderedTitle(
  blocks: readonly Pick<FlowBlock, "id" | "kind" | "name">[],
  run: { readonly number: number | null; readonly title: string },
  blockId: string,
) {
  const block = blocks.find((entry) => entry.id === blockId);
  if (!block || block.kind !== "agent") return undefined;
  return workerThreadTitle(run, blocks, blockId);
}

function queueBinding(
  sql: SqlClient.SqlClient,
  run: TitleRun,
  blocks: readonly Pick<FlowBlock, "id" | "kind" | "name">[],
  binding: TitleBinding,
) {
  return Effect.gen(function* () {
    if (binding.title_sync_state === "retired") return;
    const desired = renderedTitle(blocks, run, binding.block_id);
    if (desired === undefined) return;
    const requestId = workerTitleRequestId(run.id, binding.thread_id, run.title_revision);
    if (binding.title_sync_state === "paused" || binding.title_sync_state === "inflight") {
      yield* sql`UPDATE run_thread_bindings SET title_target=${desired},title_target_revision=${run.title_revision},title_request_id=${requestId},title_not_before=NULL WHERE id=${binding.id} AND title_sync_state=${binding.title_sync_state}`;
      return;
    }
    if (desired === binding.title_acknowledged) {
      yield* sql`UPDATE run_thread_bindings SET title_sync_state=NULL,title_target=NULL,title_target_revision=NULL,title_request_id=NULL,title_not_before=NULL,title_disposition=NULL WHERE id=${binding.id} AND title_sync_state IS NOT 'inflight' AND title_sync_state IS NOT 'retired' AND title_sync_state IS NOT 'paused'`;
      return;
    }
    yield* sql`UPDATE run_thread_bindings SET title_sync_state='pending',title_target=${desired},title_target_revision=${run.title_revision},title_request_id=${requestId},title_not_before=NULL,title_disposition=NULL,title_blocked_context=NULL,title_attempt=0 WHERE id=${binding.id} AND title_sync_state IS NOT 'inflight' AND title_sync_state IS NOT 'retired' AND title_sync_state IS NOT 'paused'`;
  });
}

export function queueWorkerTitleSync(sql: SqlClient.SqlClient, runId: string) {
  return Effect.gen(function* () {
    const [run] =
      yield* sql<TitleRun>`UPDATE runs SET title_revision=title_revision+1 WHERE id=${runId} RETURNING id,number,title,title_revision,flow_revision_id,archived_at`;
    if (!run || run.archived_at) return;
    const flow = yield* readFlowRevision(sql, run.flow_revision_id);
    const bindings =
      yield* sql<TitleBinding>`SELECT id,block_id,thread_id,title_acknowledged,title_sync_state FROM run_thread_bindings WHERE run_id=${runId} AND role='worker'`;
    for (const binding of bindings) yield* queueBinding(sql, run, flow.graph.blocks, binding);
  });
}

export function baselineWorkerTitle(
  sql: SqlClient.SqlClient,
  runId: string,
  bindingId: string,
  blockId: string,
  threadId: string,
  launchTitle: string,
) {
  return Effect.gen(function* () {
    const [run] =
      yield* sql<TitleRun>`SELECT id,number,title,title_revision,flow_revision_id,archived_at FROM runs WHERE id=${runId}`;
    if (!run || run.archived_at) return;
    const flow = yield* readFlowRevision(sql, run.flow_revision_id);
    const desired = renderedTitle(flow.graph.blocks, run, blockId);
    if (desired === undefined) return;
    const pending = desired !== launchTitle;
    yield* sql`UPDATE run_thread_bindings SET title_acknowledged=${launchTitle},title_synced_revision=${pending ? null : run.title_revision},title_sync_state=${pending ? "pending" : null},title_target=${pending ? desired : null},title_target_revision=${pending ? run.title_revision : null},title_request_id=${pending ? workerTitleRequestId(runId, threadId, run.title_revision) : null},title_not_before=NULL,title_disposition=NULL,title_attempt=0 WHERE id=${bindingId} AND role='worker' AND title_synced_revision IS NULL AND title_sync_state IS NULL AND title_acknowledged IS NULL`;
  });
}

export function cancelWorkerTitleSync(sql: SqlClient.SqlClient, runId: string) {
  return sql`UPDATE run_thread_bindings SET title_sync_state=NULL,title_target=NULL,title_target_revision=NULL,title_request_id=NULL,title_not_before=NULL WHERE run_id=${runId} AND role='worker' AND title_sync_state IN ('pending','paused')`;
}

function clearInflight(sql: SqlClient.SqlClient, bindingId: string, requestId: string) {
  return sql`UPDATE run_thread_bindings SET title_sync_state=NULL,title_inflight_revision=NULL,title_inflight_request_id=NULL,title_target=NULL,title_target_revision=NULL,title_request_id=NULL,title_not_before=NULL WHERE id=${bindingId} AND title_inflight_request_id=${requestId}`;
}

function finishRename(
  sql: SqlClient.SqlClient,
  claim: WorkerTitleSyncClaim,
  acknowledged: boolean,
) {
  return Effect.gen(function* () {
    if (acknowledged) {
      yield* sql`UPDATE run_thread_bindings SET title_acknowledged=${claim.title},title_synced_revision=${claim.revision} WHERE id=${claim.bindingId}`;
    }
    const keep =
      yield* sql`UPDATE run_thread_bindings SET title_sync_state='pending',title_inflight_revision=NULL,title_inflight_request_id=NULL,title_disposition=NULL,title_not_before=NULL
      WHERE id=${claim.bindingId} AND title_target_revision > ${claim.revision} AND (${Number(acknowledged)}=0 OR title_target IS NOT ${claim.title}) RETURNING id`;
    if (!keep.length) {
      yield* clearInflight(sql, claim.bindingId, claim.requestId);
      yield* sql`UPDATE run_thread_bindings SET title_disposition=${acknowledged ? null : "superseded"} WHERE id=${claim.bindingId}`;
    }
  });
}

export function openWorkerTitles(database: RunnerDatabase) {
  const dueWorkerTitleSyncs = (runId: string) =>
    database.transaction(
      (sql) =>
        sql<{
          id: string;
          context_id: string;
        }>`SELECT b.id,r.context_id FROM run_thread_bindings b JOIN runs r ON r.id=b.run_id WHERE b.role='worker' AND b.title_sync_state='pending' AND b.title_not_before IS NULL AND r.archived_at IS NULL AND b.run_id=${runId} ORDER BY b.rowid`,
    );

  const runsPendingWorkerTitleSync = () =>
    database.transaction(
      (sql) =>
        sql<{
          id: string;
        }>`SELECT DISTINCT b.run_id AS id FROM run_thread_bindings b JOIN runs r ON r.id=b.run_id WHERE b.role='worker' AND b.title_sync_state='pending' AND b.title_not_before IS NULL AND r.archived_at IS NULL ORDER BY b.run_id`,
    );

  const claimWorkerTitleSync = (runId: string, bindingId: string, contextId: string) =>
    database.mutate(
      runId,
      (sql) =>
        Effect.gen(function* () {
          if (
            !(yield* guardsHold(sql, database.owner.token, runId, {
              owner: true,
              notArchived: true,
              liveContext: contextId,
            }))
          )
            return null;
          const claimed =
            yield* sql`UPDATE run_thread_bindings SET title_sync_state='inflight',title_inflight_revision=title_target_revision,title_inflight_request_id=title_request_id,title_attempt=title_attempt+1 WHERE id=${bindingId} AND role='worker' AND title_sync_state='pending' AND title_not_before IS NULL AND title_target IS NOT NULL AND title_request_id IS NOT NULL AND run_id=${runId} RETURNING id`;
          if (!claimed.length) return null;
          const [row] = yield* sql<{
            binding_id: string;
            run_id: string;
            thread_id: string;
            revision: number;
            title: string;
            request_id: string;
            context_id: string;
            endpoint: string;
            environment_id: string;
          }>`SELECT b.id AS binding_id,b.run_id,b.thread_id,b.title_inflight_revision AS revision,b.title_target AS title,b.title_inflight_request_id AS request_id,r.context_id,c.endpoint,c.environment_id FROM run_thread_bindings b JOIN runs r ON r.id=b.run_id JOIN t3_authorization_contexts c ON c.id=r.context_id WHERE b.id=${bindingId}`;
          if (!row?.request_id || !row.title || row.revision === null) return null;
          const claim: WorkerTitleSyncClaim = {
            bindingId: row.binding_id,
            runId: row.run_id,
            threadId: row.thread_id,
            revision: row.revision,
            title: row.title,
            requestId: row.request_id,
            contextId: row.context_id,
            endpoint: row.endpoint,
            environmentId: row.environment_id,
          };
          return claim;
        }),
      () => false,
    );

  const recordWorkerTitleSync = (
    claim: WorkerTitleSyncClaim,
    disposition:
      | "acknowledged"
      | "superseded"
      | "thread-not-found"
      | "unavailable"
      | "unclassified"
      | "capability-denied",
  ) =>
    database.mutate(
      claim.runId,
      (sql) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{
            title_inflight_request_id: string | null;
            archived_at: string | null;
          }>`SELECT b.title_inflight_request_id,r.archived_at FROM run_thread_bindings b JOIN runs r ON r.id=b.run_id WHERE b.id=${claim.bindingId}`;
          if (!row || row.title_inflight_request_id !== claim.requestId) return;
          if (row.archived_at) {
            yield* clearInflight(sql, claim.bindingId, claim.requestId);
            return;
          }
          if (disposition === "acknowledged" || disposition === "superseded") {
            yield* finishRename(sql, claim, disposition === "acknowledged");
            return;
          }
          if (disposition === "thread-not-found") {
            yield* sql`UPDATE run_thread_bindings SET title_sync_state='retired',title_disposition='thread-not-found',title_inflight_revision=NULL,title_inflight_request_id=NULL,title_target=NULL,title_target_revision=NULL,title_request_id=NULL,title_not_before=NULL WHERE id=${claim.bindingId} AND title_inflight_request_id=${claim.requestId}`;
            return;
          }
          const time = yield* now;
          const blocked = disposition === "capability-denied" ? claim.contextId : null;
          const state = disposition === "capability-denied" ? "paused" : "pending";
          yield* sql`UPDATE run_thread_bindings SET title_sync_state=${state},title_disposition=${disposition},title_blocked_context=${blocked},title_inflight_revision=NULL,title_inflight_request_id=NULL,title_not_before=${time} WHERE id=${claim.bindingId} AND title_inflight_request_id=${claim.requestId}`;
        }),
      () => false,
    );

  return {
    dueWorkerTitleSyncs,
    runsPendingWorkerTitleSync,
    claimWorkerTitleSync,
    recordWorkerTitleSync,
  };
}
