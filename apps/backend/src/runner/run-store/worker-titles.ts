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
  readonly title_disposition: string | null;
  readonly title_inflight_request_id: string | null;
  readonly title_sync_state: string | null;
};
export type WorkerTitleSyncClaim = {
  readonly bindingId: string;
  readonly runId: string;
  readonly threadId: string;
  readonly revision: number;
  readonly title: string;
  readonly requestId: string;
  readonly lastDispatchedKey: string | null;
  readonly contextId: string;
  readonly authorizationIdentity: string;
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
    const unchanged = binding.title_disposition === null && desired === binding.title_acknowledged;
    const state =
      binding.title_sync_state === "paused" || binding.title_inflight_request_id !== null
        ? binding.title_sync_state
        : unchanged
          ? null
          : "pending";
    yield* sql`UPDATE run_thread_bindings SET title_sync_state=${state},
      title_target=${state ? desired : null},title_target_revision=${state ? run.title_revision : null},
      title_request_id=${state ? requestId : null},title_not_before=NULL,title_attempt=0,
      title_inflight_revision=CASE WHEN title_inflight_request_id IS NOT NULL THEN title_inflight_revision END
      WHERE id=${binding.id}`;
  });
}

export function queueWorkerTitleSync(sql: SqlClient.SqlClient, runId: string) {
  return Effect.gen(function* () {
    const [run] =
      yield* sql<TitleRun>`UPDATE runs SET title_revision=title_revision+1 WHERE id=${runId} RETURNING id,number,title,title_revision,flow_revision_id,archived_at`;
    if (!run || run.archived_at) return;
    const flow = yield* readFlowRevision(sql, run.flow_revision_id);
    const bindings =
      yield* sql<TitleBinding>`SELECT id,block_id,thread_id,title_acknowledged,title_disposition,title_sync_state,title_inflight_request_id FROM run_thread_bindings WHERE run_id=${runId} AND role='worker'`;
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
  return sql`UPDATE run_thread_bindings SET title_sync_state=NULL,title_target=NULL,title_target_revision=NULL,title_request_id=NULL,title_not_before=NULL,title_inflight_request_id=NULL,title_inflight_revision=NULL WHERE run_id=${runId} AND role='worker' AND title_sync_state IN ('pending','paused','inflight')`;
}

export function resumeWorkerTitleClaims(sql: SqlClient.SqlClient) {
  return sql`UPDATE run_thread_bindings SET title_sync_state='pending',
    title_disposition=CASE WHEN title_inflight_request_id IS NULL THEN title_disposition ELSE 'unavailable' END,
    title_last_dispatched_key=COALESCE(title_inflight_request_id,title_last_dispatched_key),
    title_inflight_revision=NULL,title_inflight_request_id=NULL WHERE title_sync_state='inflight'`;
}

type ClaimState = {
  title_attempt: number;
  title_target_revision: number;
  title_target: string;
  title_acknowledged: string | null;
  title_disposition: string | null;
};

function finishRename(
  sql: SqlClient.SqlClient,
  claim: WorkerTitleSyncClaim,
  row: ClaimState,
  acknowledged: string | null,
) {
  const satisfied = row.title_target === acknowledged;
  const pending = row.title_target_revision > claim.revision && !satisfied;
  const syncedRevision = satisfied ? row.title_target_revision : claim.revision;
  return sql`UPDATE run_thread_bindings SET
    title_acknowledged=COALESCE(${acknowledged},title_acknowledged),
    title_synced_revision=CASE WHEN ${acknowledged} IS NOT NULL THEN ${syncedRevision} ELSE title_synced_revision END,
    title_sync_state=${pending ? "pending" : null},
    title_inflight_revision=NULL,title_inflight_request_id=NULL,title_attempt=0,title_not_before=NULL,
    title_disposition=${acknowledged === null ? "superseded" : null},
    title_target=CASE WHEN ${Number(pending)} THEN title_target END,
    title_request_id=CASE WHEN ${Number(pending)} THEN title_request_id END,
    title_target_revision=CASE WHEN ${Number(pending)} THEN title_target_revision END
    WHERE id=${claim.bindingId}`;
}

export function openWorkerTitles(database: RunnerDatabase) {
  const dueWorkerTitleSyncs = (runId: string) =>
    database.transaction((sql) =>
      Effect.gen(function* () {
        return yield* sql<{
          id: string;
          context_id: string;
        }>`SELECT b.id,r.context_id FROM run_thread_bindings b
          JOIN runs r ON r.id=b.run_id WHERE b.title_sync_state='pending' AND r.archived_at IS NULL
          AND (b.title_not_before IS NULL OR b.title_not_before<=${yield* now}) AND b.run_id=${runId} ORDER BY b.rowid`;
      }),
    );

  const runsPendingWorkerTitleSync = () =>
    database.transaction((sql) =>
      Effect.gen(function* () {
        return yield* sql<{
          id: string;
        }>`SELECT DISTINCT b.run_id AS id FROM run_thread_bindings b
          JOIN runs r ON r.id=b.run_id WHERE b.title_sync_state='pending' AND r.archived_at IS NULL
          AND (b.title_not_before IS NULL OR b.title_not_before<=${yield* now}) ORDER BY b.run_id`;
      }),
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
            yield* sql`UPDATE run_thread_bindings SET title_sync_state='inflight',title_inflight_revision=title_target_revision,title_inflight_request_id=NULL,title_attempt=title_attempt+1 WHERE id=${bindingId} AND role='worker' AND title_sync_state='pending' AND (title_not_before IS NULL OR title_not_before<=${yield* now}) AND title_target IS NOT NULL AND title_request_id IS NOT NULL AND run_id=${runId} RETURNING id`;
          if (!claimed.length) return null;
          const [claim] = yield* sql<WorkerTitleSyncClaim>`
            SELECT b.id AS bindingId,b.run_id AS runId,b.thread_id AS threadId,
              b.title_inflight_revision AS revision,b.title_target AS title,b.title_request_id AS requestId,
              b.title_last_dispatched_key AS lastDispatchedKey,r.context_id AS contextId,c.authorization_identity AS authorizationIdentity,
              c.endpoint,c.environment_id AS environmentId
            FROM run_thread_bindings b JOIN runs r ON r.id=b.run_id
            JOIN t3_authorization_contexts c ON c.id=r.context_id WHERE b.id=${bindingId}`;
          if (!claim) throw Error("Missing claimed worker binding.");
          return claim;
        }),
      () => false,
    );

  function currentClaim(sql: SqlClient.SqlClient, claim: WorkerTitleSyncClaim) {
    return Effect.map(
      sql<ClaimState>`
      SELECT b.title_attempt,b.title_target_revision,b.title_target,b.title_acknowledged,b.title_disposition FROM run_thread_bindings b
      JOIN runs r ON r.id=b.run_id JOIN runner_owner o ON o.singleton=1 JOIN t3_connection c ON c.singleton=1
      WHERE b.id=${claim.bindingId} AND b.title_sync_state='inflight' AND b.title_inflight_revision=${claim.revision}
      AND r.archived_at IS NULL AND c.context_id=${claim.contextId} AND o.token=${database.owner.token}`,
      ([row]) => row,
    );
  }

  const recordWorkerTitleSync = (
    claim: WorkerTitleSyncClaim,
    disposition:
      | "acknowledged"
      | "different-title"
      | "thread-not-found"
      | "unavailable"
      | "unclassified"
      | "capability-denied",
    dispatched: boolean,
  ) =>
    database.mutate(
      claim.runId,
      (sql) =>
        Effect.gen(function* () {
          const row = yield* currentClaim(sql, claim);
          if (!row) return;
          if (
            !dispatched &&
            row.title_disposition === null &&
            row.title_target === row.title_acknowledged
          ) {
            yield* finishRename(sql, claim, row, row.title_acknowledged);
            return;
          }
          if (
            disposition === "acknowledged" ||
            (disposition === "different-title" && claim.lastDispatchedKey === claim.requestId)
          ) {
            yield* finishRename(
              sql,
              claim,
              row,
              disposition === "acknowledged" ? claim.title : null,
            );
            return;
          }
          if (disposition === "thread-not-found") {
            yield* sql`UPDATE run_thread_bindings SET title_sync_state='retired',title_disposition='thread-not-found',title_inflight_revision=NULL,title_inflight_request_id=NULL,title_target=NULL,title_target_revision=NULL,title_request_id=NULL,title_not_before=NULL WHERE id=${claim.bindingId}`;
            return;
          }
          const delay = Math.min(60_000, 1000 * 2 ** Math.min(row.title_attempt - 1, 6));
          const retryAt =
            row.title_target_revision === claim.revision && disposition !== "capability-denied"
              ? new Date(Date.parse(yield* now) + delay).toISOString()
              : null;
          const blocked = disposition === "capability-denied" ? claim.contextId : null;
          const state = disposition === "capability-denied" ? "paused" : "pending";
          yield* sql`UPDATE run_thread_bindings SET title_sync_state=${state},title_last_dispatched_key=CASE WHEN ${Number(dispatched)} THEN ${claim.requestId} ELSE title_last_dispatched_key END,title_disposition=CASE WHEN ${Number(dispatched)} THEN ${disposition === "different-title" ? "unclassified" : disposition} ELSE title_disposition END,title_blocked_context=${blocked},title_inflight_revision=NULL,title_inflight_request_id=NULL,title_not_before=${retryAt} WHERE id=${claim.bindingId}`;
        }),
      () => false,
    );

  return {
    dueWorkerTitleSyncs,
    runsPendingWorkerTitleSync,
    claimWorkerTitleSync,
    recordWorkerTitleSync,
    authorizeWorkerTitleDispatch: (claim: WorkerTitleSyncClaim) =>
      database.transaction((sql) =>
        Effect.gen(function* () {
          const row = yield* currentClaim(sql, claim);
          if (row?.title_target_revision !== claim.revision) return false;
          yield* sql`UPDATE run_thread_bindings SET title_inflight_request_id=${claim.requestId} WHERE id=${claim.bindingId}`;
          return true;
        }),
      ),
  };
}
