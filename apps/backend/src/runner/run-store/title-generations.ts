import { randomUUID } from "node:crypto";
import type {
  FactoryProject,
  RunTitleDiagnostic,
  RunTitleGeneration,
  RunTitleModel,
} from "@agent-easel/contracts";
import type { StartPrompt } from "@agent-easel/domain-validation";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { now } from "../../time.ts";
import { appendTimelineEvent } from "./steps.ts";
import { queueWorkerTitleSync } from "./worker-titles.ts";

/**
 * Run title generation records. Like the generation itself, these transitions take no Run gate,
 * generation guard, settlement, attention or Block state; each is a conditional update of a
 * generation, so concurrent callers change nothing twice. Callers publish after commit.
 */

/** The window in which a title may be applied, counted from Start acceptance. */
const RUN_TITLE_DEADLINE_MS = 30_000;

export const TITLE_TIMED_OUT = "No valid title arrived within 30 seconds of Start.";

type SettingRow = {
  enabled: number;
  provider_instance_id: string | null;
  model_id: string | null;
  model_options_json: string | null;
  revision: number;
  diagnostic_run_id: string | null;
  diagnostic_run_number: number | null;
  diagnostic_outcome: RunTitleDiagnostic["outcome"] | null;
  diagnostic_message: string | null;
  diagnostic_at: string | null;
};

/** The setting as Start decides with it; `revision` changes with every save. */
type StoredTitleSetting = {
  enabled: boolean;
  model: RunTitleModel | null;
  revision: number;
};

const settingModel = (row: SettingRow): RunTitleModel | null =>
  row.provider_instance_id && row.model_id && row.model_options_json
    ? {
        providerInstanceId: row.provider_instance_id,
        modelId: row.model_id,
        modelOptions: JSON.parse(row.model_options_json) as RunTitleModel["modelOptions"],
      }
    : null;

/** Generate Run titles as stored, with the Run and outcome its latest diagnostic names. */
export function readTitleSetting(sql: SqlClient.SqlClient) {
  return Effect.map(
    sql<SettingRow>`SELECT s.*,r.number AS diagnostic_run_number,g.state AS diagnostic_outcome FROM run_title_settings s LEFT JOIN runs r ON r.id=s.diagnostic_run_id LEFT JOIN run_title_generations g ON g.run_id=s.diagnostic_run_id WHERE s.singleton=1`,
    ([row]) => {
      const setting = row!;
      return {
        stored: {
          enabled: setting.enabled === 1,
          model: settingModel(setting),
          revision: setting.revision,
        } satisfies StoredTitleSetting,
        diagnostic:
          setting.diagnostic_run_id &&
          setting.diagnostic_outcome &&
          setting.diagnostic_message &&
          setting.diagnostic_at
            ? ({
                runId: setting.diagnostic_run_id,
                runNumber: setting.diagnostic_run_number,
                outcome: setting.diagnostic_outcome,
                message: setting.diagnostic_message,
                recordedAt: setting.diagnostic_at,
              } satisfies RunTitleDiagnostic)
            : null,
      };
    },
  );
}

/** The accepted Run a title generation is recorded for. */
export type TitleGenerationRun = {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly time: string;
  readonly prompt: StartPrompt;
  readonly project: Pick<FactoryProject, "environmentId" | "projectId">;
};

/** What Start captures for an automatic Run, decided against the setting at `revision`. */
export type TitleGenerationPlan = {
  readonly revision: number;
  /** Null when the setting was off. */
  readonly capture: {
    readonly model: RunTitleModel;
    readonly modelLabel: string;
    /** Why no launch will happen; a diagnostic is recorded only for a failed eligibility check. */
    readonly skipped: { readonly reason: string; readonly diagnostic: boolean } | null;
    readonly derived: { readonly title: string; readonly reason: string } | null;
  } | null;
  /** The version of the title prompt `launch` writes. */
  readonly promptVersion: number;
  /** The title thread's serialized launch request for generation `generationId` of the Run. */
  readonly launch: (generationId: string, model: RunTitleModel, run: TitleGenerationRun) => string;
};

/** The Run's timeline event for its title generation's launch dispatch or its outcome, written in
 * the transaction that records it. */
function titleEvent(
  sql: SqlClient.SqlClient,
  runId: string,
  step: "started" | Exclude<RunTitleGeneration["state"], "pending">,
  observedAt: string,
) {
  return appendTimelineEvent(sql, { kind: `title-generation-${step}`, runId, observedAt });
}

/** The setting's latest diagnostic, naming the Run whose generation was skipped by a failed
 * eligibility check, failed or timed out. */
function recordDiagnostic(sql: SqlClient.SqlClient, runId: string, message: string, time: string) {
  return sql`UPDATE run_title_settings SET diagnostic_run_id=${runId},diagnostic_message=${message},diagnostic_at=${time} WHERE singleton=1`;
}

/**
 * Records an accepted Run's title generation in its acceptance transaction; a pending one carries
 * its title thread's launch request, so the launch intent is durable before any dispatch. The
 * setting as it stands now decides: a save since the plan's checks skips generation if the setting
 * is still on, and none is recorded once it is off.
 */
export function recordTitleGeneration(
  sql: SqlClient.SqlClient,
  plan: TitleGenerationPlan | undefined,
  run: TitleGenerationRun,
) {
  return Effect.gen(function* () {
    if (!plan) return;
    const { stored: setting } = yield* readTitleSetting(sql);
    if (!setting.enabled || !setting.model) return;
    const capture =
      setting.revision === plan.revision
        ? plan.capture
        : {
            model: setting.model,
            modelLabel: `${setting.model.providerInstanceId} · ${setting.model.modelId}`,
            skipped: {
              reason: "Generate Run titles changed while this Run started.",
              diagnostic: false,
            },
            derived: null,
          };
    if (!capture) return;
    const { model, skipped, derived } = capture;
    const deadline = new Date(Date.parse(run.time) + RUN_TITLE_DEADLINE_MS).toISOString();
    const id = randomUUID();
    if (derived) {
      yield* sql`INSERT INTO run_title_generations(id,run_id,state,reason,provider_instance_id,model_id,model_options_json,model_label,prompt_version,deadline_at,automatic_title,generated_title,created_at,ended_at) VALUES(${id},${run.id},'applied',${derived.reason},${model.providerInstanceId},${model.modelId},${JSON.stringify(model.modelOptions)},${capture.modelLabel},${plan.promptVersion},${deadline},${run.title},${derived.title},${run.time},${run.time})`;
      yield* sql`UPDATE runs SET title=${derived.title},title_provenance='generated' WHERE id=${run.id}`;
      return yield* titleEvent(sql, run.id, "applied", run.time);
    }
    const launch = skipped ? null : plan.launch(id, model, run);
    yield* sql`INSERT INTO run_title_generations(id,run_id,state,reason,provider_instance_id,model_id,model_options_json,model_label,prompt_version,deadline_at,automatic_title,launch_payload_json,created_at,ended_at) VALUES(${id},${run.id},${skipped ? "skipped" : "pending"},${skipped?.reason ?? null},${model.providerInstanceId},${model.modelId},${JSON.stringify(model.modelOptions)},${capture.modelLabel},${plan.promptVersion},${deadline},${run.title},${launch},${run.time},${skipped ? run.time : null})`;
    if (!skipped) return;
    yield* titleEvent(sql, run.id, "skipped", run.time);
    if (skipped.diagnostic) yield* recordDiagnostic(sql, run.id, skipped.reason, run.time);
  });
}

/** A Rename while the title is still pending drops the generation, in the Rename's transaction. */
export function dropTitleGeneration(sql: SqlClient.SqlClient, runId: string) {
  return Effect.gen(function* () {
    const time = yield* now;
    const [dropped] = yield* sql<{
      id: string;
    }>`UPDATE run_title_generations SET state='dropped',reason='The Run was renamed before a generated title arrived.',ended_at=${time} WHERE run_id=${runId} AND state='pending' RETURNING id`;
    if (dropped) yield* titleEvent(sql, runId, "dropped", time);
  });
}

const CANCELLED = {
  archive: "The Run was archived before a generated title arrived.",
  settle: "The Run was settled manually before a generated title arrived.",
  finish: "The Run reached an ending before a generated title arrived.",
} as const;

export function cancelTitleGeneration(
  sql: SqlClient.SqlClient,
  runId: string,
  time: string,
  cutoff: keyof typeof CANCELLED,
) {
  return Effect.gen(function* () {
    const [ended] = yield* sql<{
      state: "timed-out" | "cancelled";
    }>`UPDATE run_title_generations SET state=CASE WHEN deadline_at<=${time} THEN 'timed-out' ELSE 'cancelled' END,reason=CASE WHEN deadline_at<=${time} THEN ${TITLE_TIMED_OUT} ELSE ${CANCELLED[cutoff]} END,ended_at=${time} WHERE run_id=${runId} AND state='pending' RETURNING state`;
    if (!ended) return;
    yield* titleEvent(sql, runId, ended.state, time);
    if (ended.state === "timed-out") yield* recordDiagnostic(sql, runId, TITLE_TIMED_OUT, time);
  });
}

type GenerationRow = {
  run_id: string;
  state: RunTitleGeneration["state"];
  reason: string | null;
  model_label: string;
  deadline_at: string;
  automatic_title: string;
  generated_title: string | null;
  thread_link: string | null;
};

/** The title generations of these Runs, by Run id; Runs without one are absent. */
export function readTitleGenerations(sql: SqlClient.SqlClient, runIds: readonly string[]) {
  return Effect.gen(function* () {
    if (!runIds.length) return new Map<string, RunTitleGeneration>();
    const rows =
      yield* sql<GenerationRow>`SELECT run_id,state,reason,model_label,deadline_at,automatic_title,generated_title,thread_link FROM run_title_generations WHERE run_id IN ${sql.in(runIds)}`;
    return new Map(
      rows.map((row): [string, RunTitleGeneration] => [
        row.run_id,
        {
          state: row.state,
          reason: row.reason,
          modelLabel: row.model_label,
          deadlineAt: row.deadline_at,
          automaticTitle: row.automatic_title,
          generatedTitle: row.generated_title,
          threadLink: row.thread_link,
        },
      ]),
    );
  });
}

/** A generation that carries a launch request, with its Run's T3 context. */
export type LaunchedTitleGeneration = {
  id: string;
  run_id: string;
  state: RunTitleGeneration["state"];
  provider_instance_id: string;
  model_id: string;
  model_options_json: string;
  deadline_at: string;
  launch_payload_json: string;
  launch_sent_at: string | null;
  thread_id: string | null;
  ended_at: string | null;
  stop_requested_at: string | null;
  settle_requested_at: string | null;
  context_id: string;
  workspace_root: string;
  endpoint: string;
  environment_id: string;
};

/** The Run's generation when it carries a launch request; undefined otherwise. */
export function readLaunchedTitleGeneration(sql: SqlClient.SqlClient, runId: string) {
  return Effect.map(
    sql<LaunchedTitleGeneration>`SELECT g.id,g.run_id,g.state,g.provider_instance_id,g.model_id,g.model_options_json,g.deadline_at,g.launch_payload_json,g.launch_sent_at,g.thread_id,g.ended_at,g.stop_requested_at,g.settle_requested_at,r.context_id,r.workspace_root,c.endpoint,c.environment_id
      FROM run_title_generations g JOIN runs r ON r.id=g.run_id JOIN t3_authorization_contexts c ON c.id=r.context_id
      WHERE g.run_id=${runId} AND g.launch_payload_json IS NOT NULL`,
    ([row]) => row,
  );
}

/** Runs whose generation is pending, has a sent launch to bind before its deadline or may still
 * owe its thread's cleanup since `windowStart`. */
export function titleGenerationsToReconcile(
  sql: SqlClient.SqlClient,
  current: string,
  windowStart: string,
) {
  return sql<{
    run_id: string;
  }>`SELECT run_id FROM run_title_generations WHERE state='pending' OR (launch_sent_at IS NOT NULL AND thread_id IS NULL AND deadline_at>${current}) OR (thread_id IS NOT NULL AND settle_requested_at IS NULL AND ended_at>=${windowStart})`;
}

/** The absolute deadline of every pending generation, of one Run or of all. */
export function pendingTitleDeadlines(sql: SqlClient.SqlClient, runId?: string) {
  return sql<{
    id: string;
    runId: string;
    deadlineAt: string;
  }>`SELECT id,run_id AS "runId",deadline_at AS "deadlineAt" FROM run_title_generations WHERE state='pending' AND (${runId ?? null} IS NULL OR run_id=${runId ?? null})`;
}

/** Records an eligibility failure found just before dispatch; a sent launch is never skipped.
 * Answers whether the generation changed. */
export function skipTitleLaunch(
  sql: SqlClient.SqlClient,
  runId: string,
  generationId: string,
  reason: string,
) {
  return Effect.gen(function* () {
    const time = yield* now;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows =
          yield* sql`UPDATE run_title_generations SET state='skipped',reason=${reason},ended_at=${time} WHERE id=${generationId} AND state='pending' AND launch_sent_at IS NULL RETURNING id`;
        if (!rows.length) return false;
        yield* titleEvent(sql, runId, "skipped", time);
        yield* recordDiagnostic(sql, runId, reason, time);
        return true;
      }),
    );
  });
}

/** Records `state` and its diagnostic for a generation still pending; any earlier outcome is
 * final. Answers whether the generation changed. */
export function endPendingTitleGeneration(
  sql: SqlClient.SqlClient,
  generation: Pick<LaunchedTitleGeneration, "id" | "run_id">,
  state: "timed-out" | "failed",
  reason: string,
) {
  return Effect.gen(function* () {
    const time = yield* now;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows =
          yield* sql`UPDATE run_title_generations SET state=${state},reason=${reason},ended_at=${time} WHERE id=${generation.id} AND state='pending' RETURNING id`;
        if (!rows.length) return false;
        yield* titleEvent(sql, generation.run_id, state, time);
        yield* recordDiagnostic(sql, generation.run_id, reason, time);
        return true;
      }),
    );
  });
}

/** Marks a pending generation's launch sent, once, before T3 is asked; false when it was already
 * sent or the generation ended. */
export function markTitleLaunchSent(
  sql: SqlClient.SqlClient,
  generation: Pick<LaunchedTitleGeneration, "id" | "run_id">,
) {
  return Effect.gen(function* () {
    const time = yield* now;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const rows =
          yield* sql`UPDATE run_title_generations SET launch_sent_at=${time} WHERE id=${generation.id} AND state='pending' AND launch_sent_at IS NULL RETURNING id`;
        if (rows.length) yield* titleEvent(sql, generation.run_id, "started", time);
        return rows.length > 0;
      }),
    );
  });
}

/** Binds the title thread T3 launched, also when the generation ended meanwhile, so the thread is
 * still cleaned up. Answers whether it was bound now. */
export function bindTitleThread(
  sql: SqlClient.SqlClient,
  generationId: string,
  thread: { readonly threadId: string; readonly link: string },
) {
  return Effect.map(
    sql`UPDATE run_title_generations SET thread_id=${thread.threadId},thread_link=${thread.link} WHERE id=${generationId} AND thread_id IS NULL RETURNING id`,
    (rows) => rows.length > 0,
  );
}

/** Records a cleanup request before it is sent; false when it was already claimed. */
export function claimTitleCleanup(
  sql: SqlClient.SqlClient,
  generationId: string,
  request: "stop" | "settle",
) {
  return Effect.gen(function* () {
    const time = yield* now;
    const claimed =
      request === "stop"
        ? yield* sql`UPDATE run_title_generations SET stop_requested_at=${time} WHERE id=${generationId} AND stop_requested_at IS NULL RETURNING id`
        : yield* sql`UPDATE run_title_generations SET settle_requested_at=${time} WHERE id=${generationId} AND settle_requested_at IS NULL RETURNING id`;
    return claimed.length > 0;
  });
}

/** The generation a title submission names, read in the submission's transaction. */
export function readSubmittedTitleGeneration(sql: SqlClient.SqlClient, generationId: string) {
  return Effect.map(
    sql<{
      run_id: string;
      state: RunTitleGeneration["state"];
      generated_title: string | null;
      deadline_at: string;
    }>`SELECT run_id,state,generated_title,deadline_at FROM run_title_generations WHERE id=${generationId}`,
    ([row]) => row,
  );
}

/** Applies a valid title to the pending generation's Run, which is still automatic: Rename drops
 * the generation in the same transaction. An applied title shows the setting works, so an earlier
 * diagnostic is cleared. */
export function applyGeneratedTitle(
  sql: SqlClient.SqlClient,
  generation: { readonly id: string; readonly runId: string },
  title: string,
  appliedAt: string,
) {
  return Effect.gen(function* () {
    const [current] = yield* sql<{
      title: string;
    }>`SELECT title FROM runs WHERE id=${generation.runId}`;
    yield* sql`UPDATE runs SET title=${title},title_provenance='generated' WHERE id=${generation.runId}`;
    if (current && current.title !== title) yield* queueWorkerTitleSync(sql, generation.runId);
    yield* sql`UPDATE run_title_generations SET state='applied',generated_title=${title},ended_at=${appliedAt} WHERE id=${generation.id}`;
    yield* titleEvent(sql, generation.runId, "applied", appliedAt);
    yield* sql`UPDATE run_title_settings SET diagnostic_run_id=NULL,diagnostic_message=NULL,diagnostic_at=NULL WHERE singleton=1`;
  });
}
