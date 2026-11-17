import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { TriggerDefinition, TriggerMissedIssue } from "@t3-factory/contracts";

type TriggerRow = {
  id: string;
  kind: "github_issues";
  name: string;
  enabled: number;
  project_id: string;
  flow_id: string;
  schedule_enabled: number;
  interval_minutes: number;
  max_active_runs: number;
  revision: number;
  next_check_at: string | null;
  latest_check_at: string | null;
  latest_check_started: number | null;
  latest_check_waiting: number | null;
  error_code: string | null;
  error_message: string | null;
  error_first_seen_at: string | null;
  error_last_seen_at: string | null;
  error_count: number | null;
  created_at: string;
  updated_at: string;
  repository_host: string;
  repository_name_with_owner: string;
  repository_node_id: string;
  query: string;
  ready_label: string;
};
type MissRow = TriggerMissedIssue & { trigger_id: string };

function triggerDefinition(row: TriggerRow, misses: readonly MissRow[]): TriggerDefinition {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled === 1,
    projectId: row.project_id,
    flowId: row.flow_id,
    schedule: { enabled: row.schedule_enabled === 1, intervalMinutes: row.interval_minutes },
    maxActiveRuns: row.max_active_runs,
    revision: row.revision,
    nextCheckAt: row.next_check_at,
    latestCheck:
      row.latest_check_at === null
        ? null
        : {
            checkedAt: row.latest_check_at,
            started: row.latest_check_started!,
            waiting: row.latest_check_waiting!,
            notStarted: misses.map(({ issue, reason }) => ({ issue, reason })),
          },
    error:
      row.error_code === null
        ? null
        : {
            code: row.error_code,
            message: row.error_message!,
            firstSeenAt: row.error_first_seen_at!,
            lastSeenAt: row.error_last_seen_at!,
            count: row.error_count!,
          },
    github: {
      repository: {
        host: row.repository_host,
        nameWithOwner: row.repository_name_with_owner,
        nodeId: row.repository_node_id,
      },
      query: row.query,
      readyLabel: row.ready_label,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every current Trigger (or only `triggerId`), newest first. */
export const readTriggers = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  triggerId?: string,
) {
  const rows = yield* sql<TriggerRow>`SELECT t.*, g.repository_host,
      g.repository_name_with_owner, g.repository_node_id, g.query, g.ready_label
    FROM run_triggers t JOIN run_trigger_github_issues g ON g.trigger_id = t.id
    ${triggerId === undefined ? sql`` : sql`WHERE t.id = ${triggerId}`}
    ORDER BY t.created_at DESC, t.id ASC`;
  const misses = yield* sql<MissRow>`SELECT trigger_id, issue, reason FROM run_trigger_check_misses
    ${triggerId === undefined ? sql`` : sql`WHERE trigger_id = ${triggerId}`}
    ORDER BY trigger_id, position`;
  return rows.map((row) =>
    triggerDefinition(
      row,
      misses.filter((miss) => miss.trigger_id === row.id),
    ),
  );
});

/** The saved settings of a new Trigger or a new revision; callers own the transaction. */
export const writeTriggerSettings = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  trigger: TriggerDefinition,
  created: boolean,
) {
  const { repository } = trigger.github;
  if (created) {
    yield* sql`INSERT INTO run_triggers (
        id, kind, name, enabled, project_id, flow_id, schedule_enabled, interval_minutes,
        max_active_runs, revision, created_at, updated_at
      ) VALUES (
        ${trigger.id}, ${trigger.kind}, ${trigger.name}, ${trigger.enabled ? 1 : 0},
        ${trigger.projectId}, ${trigger.flowId}, ${trigger.schedule.enabled ? 1 : 0},
        ${trigger.schedule.intervalMinutes}, ${trigger.maxActiveRuns}, ${trigger.revision},
        ${trigger.createdAt}, ${trigger.updatedAt}
      )`;
    yield* sql`INSERT INTO run_trigger_github_issues (
        trigger_id, repository_host, repository_name_with_owner, repository_node_id, query,
        ready_label
      ) VALUES (
        ${trigger.id}, ${repository.host}, ${repository.nameWithOwner}, ${repository.nodeId},
        ${trigger.github.query}, ${trigger.github.readyLabel}
      )`;
    return;
  }
  yield* sql`UPDATE run_triggers SET name = ${trigger.name}, project_id = ${trigger.projectId},
      flow_id = ${trigger.flowId}, schedule_enabled = ${trigger.schedule.enabled ? 1 : 0},
      interval_minutes = ${trigger.schedule.intervalMinutes},
      max_active_runs = ${trigger.maxActiveRuns}, revision = ${trigger.revision},
      updated_at = ${trigger.updatedAt}
    WHERE id = ${trigger.id}`;
  yield* sql`UPDATE run_trigger_github_issues SET repository_host = ${repository.host},
      repository_name_with_owner = ${repository.nameWithOwner},
      repository_node_id = ${repository.nodeId}, query = ${trigger.github.query},
      ready_label = ${trigger.github.readyLabel}
    WHERE trigger_id = ${trigger.id}`;
});

export const writeTriggerEnabled = (
  sql: SqlClient.SqlClient,
  triggerId: string,
  enabled: boolean,
  updatedAt: string,
) =>
  sql`UPDATE run_triggers SET enabled = ${enabled ? 1 : 0}, updated_at = ${updatedAt}
    WHERE id = ${triggerId}`;

/** Deletes the Trigger with its settings and latest check. */
export const deleteTrigger = (sql: SqlClient.SqlClient, triggerId: string) =>
  sql`DELETE FROM run_triggers WHERE id = ${triggerId}`;

/** Whether another current Trigger has `name`, ignoring letter case. */
export const triggerNameTaken = (sql: SqlClient.SqlClient, name: string, exceptId: string | null) =>
  sql<{ id: string }>`SELECT id FROM run_triggers
    WHERE name = ${name} COLLATE NOCASE AND id IS NOT ${exceptId}`.pipe(
    Effect.map((rows) => rows.length > 0),
  );

/** Names of the other current Triggers that read the repository `nodeId`. */
export const triggersWatching = (
  sql: SqlClient.SqlClient,
  nodeId: string,
  exceptId: string | null,
) =>
  sql<{ name: string }>`SELECT t.name FROM run_triggers t
      JOIN run_trigger_github_issues g ON g.trigger_id = t.id
    WHERE g.repository_node_id = ${nodeId} AND t.id IS NOT ${exceptId}
    ORDER BY t.name`.pipe(Effect.map((rows) => rows.map((row) => row.name)));
