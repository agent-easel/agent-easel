import type { RunOrigin } from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

/**
 * The stored origin copy of each Trigger-started Run, by Run id: one Run, or every unarchived Run
 * for navigation. Runs no Trigger started have no entry.
 */
export const readRunOrigins = (sql: SqlClient.SqlClient, runId?: string, archived = false) =>
  sql<{
    run_id: string;
    trigger_id: string;
    trigger_name: string;
    repository: string;
    issue_number: number;
    issue_node_id: string;
    issue_url: string;
    issue_title: string;
  }>`SELECT o.* FROM run_trigger_origins o JOIN runs r ON r.id=o.run_id
  WHERE ((${runId ?? null} IS NULL AND (r.archived_at IS NOT NULL)=${archived ? 1 : 0}) OR o.run_id=${runId ?? null})`.pipe(
    Effect.map(
      (rows) =>
        new Map(
          rows.map((row): [string, RunOrigin] => [
            row.run_id,
            {
              trigger: { id: row.trigger_id, name: row.trigger_name },
              repository: row.repository,
              issueNumber: row.issue_number,
              issueNodeId: row.issue_node_id,
              url: row.issue_url,
              title: row.issue_title,
            },
          ]),
        ),
    ),
  );
