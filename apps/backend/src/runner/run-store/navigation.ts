import {
  attentionPresentation,
  awaitsReviewInT3,
  type ArchivedRunMatch,
  type Result,
  type RunAttention,
  type RunNavigationEntry,
  type RunOrigin,
} from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import { currentProgress } from "./current-report.ts";
import type { RunnerDatabase } from "./database.ts";
import { readRunSettlementStates } from "./manual-settlement.ts";
import { pendingRunWork, type SettlementReason } from "./settlement.ts";
import { runLifecycle } from "./lifecycle.ts";
import { failure } from "../../result.ts";
import { readWorkerRepositories } from "./worker-repositories.ts";
import { readRunOrigins } from "./run-origins.ts";
import { storedProjectIcon } from "../../projects.ts";
import { projectFaviconUrl } from "../../project-favicon.ts";
import { dropTitleGeneration, readTitleGenerations } from "./title-generations.ts";
import { queueWorkerTitleSync } from "./worker-titles.ts";
import { runWordMatches } from "./run-word-matches.ts";

export interface ArchivedRunRow {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly createdAt: string;
  readonly creationKey: string;
  readonly startedAt: string;
  readonly flowName: string;
  readonly origin: RunOrigin | null;
  readonly project: Pick<
    RunNavigationEntry["project"],
    "id" | "title" | "workspaceRoot" | "availability"
  >;
}

export interface RunListExtras {
  readonly startedAt: ReadonlyMap<string, string>;
  readonly archived: readonly ArchivedRunRow[];
}

export function openRunNavigation(database: RunnerDatabase) {
  return {
    listRunListExtras(words: readonly string[]): Effect.Effect<Result<RunListExtras>, unknown> {
      return database.transaction((sql) =>
        Effect.gen(function* () {
          const rows = yield* sql<{
            id: string;
            number: number | null;
            title: string;
            created_at: string;
            creation_key: string;
            started_at: string;
            archived_at: string | null;
            flow_name: string;
            project_id: string;
            project_title: string;
            workspace_root: string;
            availability: RunNavigationEntry["project"]["availability"];
          }>`SELECT r.id,r.number,r.title,r.created_at,r.creation_key,r.started_at,r.archived_at,f.name AS flow_name,
          p.id AS project_id,p.title AS project_title,p.workspace_root,p.availability
          FROM runs r JOIN tasks t ON t.id=r.task_id JOIN projects p ON p.id=t.project_id
          JOIN flow_revisions f ON f.id=r.flow_revision_id
          ${words.length ? sql`WHERE ${sql.and(runWordMatches(sql, words))}` : sql``}`;
          const origins = yield* readRunOrigins(sql, undefined, true);
          return {
            ok: true as const,
            value: {
              startedAt: new Map(rows.map((row) => [row.id, row.started_at])),
              archived: rows
                .filter((row) => row.archived_at !== null)
                .map((row) => ({
                  id: row.id,
                  number: row.number,
                  title: row.title,
                  createdAt: row.created_at,
                  creationKey: row.creation_key,
                  startedAt: row.started_at,
                  flowName: row.flow_name,
                  origin: origins.get(row.id) ?? null,
                  project: {
                    id: row.project_id,
                    title: row.project_title,
                    workspaceRoot: row.workspace_root,
                    availability: row.availability,
                  },
                })),
            },
          };
        }),
      );
    },
    listRunNavigation(): Effect.Effect<Result<readonly RunNavigationEntry[]>, unknown> {
      return database.transaction((sql) =>
        Effect.gen(function* () {
          const rows = yield* sql<{
            id: string;
            number: number | null;
            title: string;
            title_provenance: RunNavigationEntry["titleProvenance"];
            created_at: string;
            last_activity_at: string;
            flow_name: string;
            project_icon_json: string | null;
            favicon_path: string | null;
            creation_key: string;
            settled_at: string | null;
            archived_at: null;
            pending_work: number;
            snoozed: number | null;
            woke: number | null;
            project_id: string;
            project_title: string;
            workspace_root: string;
            availability: RunNavigationEntry["project"]["availability"];
            workspace_state: "preparing" | "bound" | "failed" | null;
            settled_cycle: number | null;
            settled_reason: SettlementReason | null;
            ending_name: string | null;
            bound_branch: string | null;
            result_output_missing: 0 | 1 | null;
            flow_has_endings: number;
          }>`SELECT r.id,r.number,r.title,r.title_provenance,r.created_at,r.creation_key,r.settled_at,r.archived_at,rp.snoozed,rp.woke,w.state AS workspace_state,w.branch AS bound_branch,
          (SELECT e.sequence FROM run_events e WHERE e.run_id=r.id AND e.kind='run-settled' ORDER BY e.sequence DESC LIMIT 1) AS settled_cycle,
          (SELECT e.cause_id FROM run_events e WHERE e.run_id=r.id AND e.kind='run-settled' ORDER BY e.sequence DESC LIMIT 1) AS settled_reason,
          x.ending_name AS ending_name,x.output_missing AS result_output_missing,
          EXISTS(SELECT 1 FROM flow_revision_endings e WHERE e.flow_revision_id=r.flow_revision_id) AS flow_has_endings,
          COALESCE((SELECT MAX(e.observed_at) FROM run_events e WHERE e.run_id=r.id AND e.kind IN ('execution-observed','report-accepted','working-reported','human-answered','attention-appeared','handoff-released','continuation-passed','run-settled','run-activated')),r.started_at) AS last_activity_at,
          CASE WHEN r.settled_at IS NULL THEN EXISTS(${pendingRunWork(sql, sql`r.id`)}) ELSE 0 END AS pending_work,
          f.name AS flow_name,p.project_icon_json,p.favicon_path,
          p.id AS project_id,p.title AS project_title,p.workspace_root,p.availability
          FROM runs r JOIN tasks t ON t.id=r.task_id JOIN projects p ON p.id=t.project_id
          JOIN flow_revisions f ON f.id=r.flow_revision_id
          LEFT JOIN run_presentation rp ON rp.run_id=r.id
          LEFT JOIN run_workspaces w ON w.run_id=r.id
          LEFT JOIN run_results x ON x.run_id=r.id WHERE r.archived_at IS NULL ORDER BY r.created_at DESC,r.creation_key`;
          const settlements = yield* readRunSettlementStates(sql, rows);
          const origins = yield* readRunOrigins(sql);
          const titleGenerations = yield* readTitleGenerations(
            sql,
            rows.map((row) => row.id),
          );
          const blocks = yield* sql<{
            run_id: string;
            block_id: string;
            state: RunNavigationEntry["blocks"][number]["state"];
            freshness: RunNavigationEntry["blocks"][number]["freshness"];
            report_status: "working" | "finished" | null;
            engine_status: string | null;
            worker_finished: 0 | 1;
          }>`SELECT b.run_id,b.block_id,b.state,b.freshness,b.report_status,b.engine_status,b.worker_finished FROM run_blocks b JOIN runs r ON r.id=b.run_id WHERE r.archived_at IS NULL AND (b.invocation_id IS NOT NULL AND b.template_block_id IS NOT NULL OR EXISTS(SELECT 1 FROM flow_revision_blocks f WHERE f.flow_revision_id=r.flow_revision_id AND f.block_id=b.block_id)) ORDER BY b.rowid`;
          const working = new Map(
            (yield* currentProgress(sql)).map((row) => [`${row.runId}/${row.blockId}`, row]),
          );
          const byRun = new Map<string, RunNavigationEntry["blocks"][number][]>();
          const reviewInT3 = new Set(
            blocks
              .filter((block) =>
                awaitsReviewInT3({
                  state: block.state,
                  reportStatus: block.report_status,
                  engineStatus: block.engine_status,
                  workerFinished: block.worker_finished === 1,
                  progressOverdue:
                    working.get(`${block.run_id}/${block.block_id}`)?.overdue ?? false,
                }),
              )
              .map((block) => block.run_id),
          );
          const repositories = new Map<string, RunNavigationEntry["repositories"][number][]>();
          for (const { runId, ...worker } of yield* readWorkerRepositories(sql)) {
            const entries = repositories.get(runId) ?? [];
            entries.push(worker);
            repositories.set(runId, entries);
          }
          for (const block of blocks) {
            const entries = byRun.get(block.run_id) ?? [];
            entries.push({
              state: block.state,
              freshness: block.freshness,
              workingMessage: working.get(`${block.run_id}/${block.block_id}`)?.message ?? null,
            });
            byRun.set(block.run_id, entries);
          }
          const pending = yield* sql<{
            id: string;
            run_id: string;
            block_id: string | null;
            invocation_id: string | null;
            kind: RunAttention["kind"];
            occurrence_id: string | null;
            native_request_id: string | null;
            pending_request_count: number | null;
            block_name: string | null;
          }>`SELECT a.id,a.run_id,a.block_id,a.kind,a.occurrence_id,a.native_request_id,
          CASE WHEN a.kind='native-request' THEN b.pending_request_count END AS pending_request_count,b.name AS block_name,
          CASE WHEN a.kind='subflow-stop-unresolved' THEN a.execution_id ELSE b.invocation_id END AS invocation_id
          FROM run_attention a LEFT JOIN run_blocks b ON b.run_id=a.run_id AND b.block_id=a.block_id
          WHERE a.settled_at IS NULL ORDER BY a.appeared_at,a.id`;
          const mattersByRun = new Map<
            string,
            RunNavigationEntry["attention"]["matters"][number][]
          >();
          for (const matter of pending) {
            const matters = mattersByRun.get(matter.run_id) ?? [];
            matters.push({
              id: matter.id,
              kind: matter.kind,
              presentation: attentionPresentation(matter.kind),
              ...(matter.invocation_id ? { invocationId: matter.invocation_id } : {}),
              blockId: matter.block_id,
              occurrenceId: matter.occurrence_id,
              nativeRequestId: matter.native_request_id,
              pendingRequestCount: matter.pending_request_count,
              blockName: matter.block_name,
            });
            mattersByRun.set(matter.run_id, matters);
          }
          return {
            ok: true as const,
            value: rows.map((row) => {
              const matters = mattersByRun.get(row.id) ?? [];
              const lifecycle = runLifecycle(row);
              const active = lifecycle === "active";
              const settlement = settlements.get(row.id) ?? null;
              return {
                id: row.id,
                number: row.number,
                title: row.title,
                titleProvenance: row.title_provenance,
                titleGeneration: titleGenerations.get(row.id) ?? null,
                createdAt: row.created_at,
                lastActivityAt: row.last_activity_at,
                flowName: row.flow_name,
                origin: origins.get(row.id) ?? null,
                repositories: repositories.get(row.id) ?? [],
                boundBranch: row.bound_branch,
                result:
                  row.ending_name === null
                    ? null
                    : {
                        endingName: row.ending_name,
                        outputMissing: row.result_output_missing === 1,
                      },
                flowHasEndings: !!row.flow_has_endings,
                creationKey: row.creation_key,
                project: {
                  id: row.project_id,
                  title: row.project_title,
                  workspaceRoot: row.workspace_root,
                  availability: row.availability,
                  projectIcon: storedProjectIcon(row.project_icon_json),
                  faviconUrl: projectFaviconUrl(row.project_id, row.favicon_path),
                },
                lifecycle,
                settlement,
                settledCycle: row.settled_cycle,
                settledReason: row.settled_reason,
                endingName: row.ending_name,
                blocks: byRun.get(row.id) ?? [],
                presentation: {
                  snoozed: active && !!row.snoozed,
                  woke: active && !!row.woke,
                },
                pendingWork: !!row.pending_work,
                attention: {
                  needsInput:
                    active &&
                    settlement === null &&
                    (reviewInT3.has(row.id) ||
                      matters.some((matter) => matter.presentation === "needs-input")),
                  problem:
                    (active && row.workspace_state === "failed") ||
                    matters.some((matter) => matter.presentation === "problem"),
                  matters,
                },
              };
            }),
          };
        }),
      );
    },
    searchArchivedRuns(query: string): Effect.Effect<Result<readonly ArchivedRunMatch[]>, unknown> {
      const search = query.trim().toLowerCase();
      if (!search || search.startsWith(">")) return Effect.succeed({ ok: true, value: [] });
      const number = /^#?(\d+)$/.exec(search)?.[1];
      return database.transaction((sql) =>
        Effect.map(
          sql<ArchivedRunMatch>`SELECT r.id,r.number,r.title,p.title AS projectTitle
            FROM runs r JOIN tasks t ON t.id=r.task_id JOIN projects p ON p.id=t.project_id
            WHERE r.archived_at IS NOT NULL ${number === undefined ? sql`` : sql`AND CAST(r.number AS TEXT)=${number}`}
            ORDER BY r.created_at DESC,r.creation_key`,
          (rows) => ({
            ok: true as const,
            value:
              number === undefined
                ? rows.filter((row) => row.title.toLowerCase().includes(search))
                : rows,
          }),
        ),
      );
    },
    renameRun(id: string, title: string): Effect.Effect<Result<void>, unknown> {
      return Effect.gen(function* () {
        const outcome = yield* database.transaction((sql) =>
          Effect.gen(function* () {
            const [current] = yield* sql<{
              title: string;
              archived_at: string | null;
            }>`SELECT title,archived_at FROM runs WHERE id=${id}`;
            if (!current) return "missing" as const;
            if (current.archived_at) return "archived" as const;
            yield* sql`UPDATE runs SET title=${title},title_provenance='manual' WHERE id=${id}`;
            yield* dropTitleGeneration(sql, id);
            if (current.title !== title) yield* queueWorkerTitleSync(sql, id);
            return "renamed" as const;
          }),
        );
        if (outcome === "missing") return failure("not_found", "This Run does not exist.");
        if (outcome === "archived")
          return failure("conflict", "An Archived Run cannot be renamed.");
        database.changes.runChanged(id);
        return { ok: true as const, value: undefined };
      });
    },
  };
}
