import { randomUUID } from "node:crypto";
import type {
  FactoryProject,
  FlowClosureDefinition,
  Result,
  RunDefinitions,
  StartRunInput,
} from "@t3-factory/contracts";
import {
  compositionReadiness,
  mayPlaceAgent,
  type StartPrompt,
} from "@t3-factory/domain-validation";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { currentAgentRevisionNumber } from "../../agent-revisions.ts";
import { readCompositionDefinitions } from "../../composition-definitions.ts";
import { currentFlowRevisionNumber, readFlowRevision } from "../../flow-revisions.ts";
import { failure } from "../../result.ts";
import {
  attachRunImages,
  stagedManifestProblem,
  workerPromptText,
  type RunImages,
} from "../../run-images.ts";
import { recordTitleGeneration, type TitleGenerationPlan } from "./title-generations.ts";
import { worktreeBranch, type RunWorkspace } from "../run-workspace.ts";
import { arriveAtEntries } from "./invocation-entry.ts";
import { createEntryLaunches } from "./activations.ts";
import type { RunnerDatabase } from "./database.ts";
import { createConditionCounters } from "./conditions.ts";
import { appendTimelineEvent } from "./steps.ts";

/** The workspace a Start accepts: worktree Runs carry the base ref resolved before acceptance. */
export type StartWorkspace = { mode: "checkout" } | { mode: "worktree"; baseRef: string };

/** A validated Start, with the ids and time its records are created with. */
export type StartPlan = {
  input: Pick<StartRunInput, "requestId" | "title" | "titleProvenance" | "createdAt">;
  prompt: StartPrompt;
  requestFingerprint: string;
  project: FactoryProject;
  definitions: RunDefinitions;
  closureStamp: string | undefined;
  workspace: StartWorkspace;
  runId: string;
  taskId: string;
  time: string;
  contextId: string;
  retryScope: string | null;
  /** Decided before acceptance for an automatic Run; undefined for manual and legacy Runs. */
  titleGeneration: TitleGenerationPlan | undefined;
};

/** A trusted caller's last local check and writes, given the Run being accepted. */
export type AcceptanceCommit = (runId: string) => Effect.Effect<Result<undefined>, unknown>;

/** Fails the acceptance transaction so a caller's refusal after the Run's writes rolls them back. */
class AcceptanceRefused {
  readonly refusal: Extract<Result<undefined>, { ok: false }>;
  constructor(refusal: AcceptanceRefused["refusal"]) {
    this.refusal = refusal;
  }
}

/**
 * Rechecks ownership inside the acceptance transaction: the Flow is global or owned by the Start's
 * Project, and the placement rule holds for every captured Agent's current owner.
 */
function ownershipConflict(sql: SqlClient.SqlClient, plan: StartPlan) {
  return Effect.gen(function* () {
    const { flow, agents } = plan.definitions;
    const [owner] = yield* sql<{
      project_id: string | null;
    }>`SELECT project_id FROM flows WHERE id=${flow.id}`;
    const flowProject = owner?.project_id ?? null;
    const placed = agents.length
      ? yield* sql<{ project_id: string | null }>`SELECT project_id FROM agents
          WHERE id IN ${sql.in(agents.map((agent) => agent.id))}`
      : [];
    if (
      (flowProject === null || flowProject === plan.project.id) &&
      placed.every((agent) => mayPlaceAgent(flowProject, agent.project_id))
    )
      return undefined;
    return failure(
      "conflict",
      "A Flow or Agent owner changed while validating. Check setup and retry this Start.",
    );
  });
}

/** Rechecks saved revisions, context and project inside the acceptance transaction. */
function startConfigurationConflict(sql: SqlClient.SqlClient, plan: StartPlan) {
  return Effect.gen(function* () {
    const [current] = yield* sql<{
      context_id: string;
    }>`SELECT context_id FROM t3_connection WHERE singleton=1`;
    const flowRevision = yield* currentFlowRevisionNumber(sql, plan.definitions.flow.id);
    const [project] = yield* sql<{
      workspace_root: string;
      availability: string;
    }>`SELECT workspace_root,availability FROM projects WHERE id=${plan.project.id}`;
    if (
      current?.context_id !== plan.contextId ||
      flowRevision !== plan.definitions.flow.revision ||
      project?.workspace_root !== plan.project.workspaceRoot ||
      project.availability !== "available"
    )
      return failure(
        "conflict",
        "Configuration changed while validating. Check setup and retry this Start.",
      );
    if (plan.closureStamp !== undefined) {
      const current = yield* readCompositionDefinitions(sql);
      const root = current.flows.get(plan.definitions.flow.id)!;
      const { readiness } = compositionReadiness(root, current);
      if (
        (root.projectId !== null && root.projectId !== plan.project.id) ||
        !readiness.ready ||
        readiness.closure?.stamp !== plan.closureStamp
      )
        return failure(
          "conflict",
          "The Flow composition changed while validating. Check readiness and retry.",
          readiness.issues,
        );
    }
    for (const agent of plan.definitions.agents) {
      if ((yield* currentAgentRevisionNumber(sql, agent.id)) !== agent.revision)
        return failure("conflict", "An Agent changed while validating. Check setup and retry.");
    }
    return undefined;
  });
}

/** Only blocks a worker reports for get a public Block id; a Human step and a Condition have none. */
const workerless = (block: RunDefinitions["flow"]["graph"]["blocks"][number]) =>
  block.kind === "human" || block.kind === "condition";

/** A worktree Run's first Flow-input target creates the worktree on the Run's own branch. */
function runWorkspace(plan: StartPlan, number: number, creatorBlockId: string): RunWorkspace {
  if (plan.workspace.mode === "checkout") return { mode: "checkout" };
  return {
    mode: "worktree",
    baseRef: plan.workspace.baseRef,
    plannedBranch: worktreeBranch(number, plan.runId),
    creatorBlockId,
    state: "preparing",
  };
}

function startLaunchTargets(definitions: RunDefinitions, workspace: RunWorkspace) {
  const targets = definitions.flow.graph.flowInput.targetBlockIds;
  return workspace.mode === "checkout" ? targets : [workspace.creatorBlockId];
}

/** Deduplicates, creates the Run's Task and records one Factory launch per Flow input target. */
function captureStartScope(sql: SqlClient.SqlClient, plan: StartPlan, number: number) {
  return Effect.gen(function* () {
    const { flow, agents } = plan.definitions;
    const {
      project,
      prompt: { segments, images },
    } = plan;
    for (const agent of agents)
      yield* sql`INSERT INTO run_agent_revisions(run_id,agent_id,agent_revision_id) SELECT ${plan.runId},agent_id,id FROM agent_revisions WHERE agent_id=${agent.id} AND revision=${agent.revision}`;
    for (const child of plan.definitions.subflows ?? [])
      yield* sql`INSERT INTO run_subflow_revisions(run_id,flow_id,flow_revision_id) SELECT ${plan.runId},flow_id,id FROM flow_revisions WHERE flow_id=${child.id} AND revision=${child.revision}`;
    for (const block of plan.definitions.flow.graph.blocks)
      yield* sql`INSERT INTO run_blocks(run_id,block_id,template_block_id,name,public_id) VALUES(${plan.runId},${block.id},${block.id},${block.name},${workerless(block) ? null : randomUUID()})`;
    yield* createConditionCounters(sql, plan.runId, plan.definitions);
    const starters = plan.definitions.subflows?.length
      ? yield* arriveAtEntries(
          sql,
          {
            runId: plan.runId,
            definitions: plan.definitions,
            target: project,
            contextId: plan.contextId,
            time: plan.time,
            input: workerPromptText(segments, images),
            carriesStart: true,
          },
          flow,
        )
      : [];
    const first = starters[0];
    const workspace = runWorkspace(
      plan,
      number,
      first?.blockId ?? flow.graph.flowInput.targetBlockIds[0]!,
    );
    if (workspace.mode === "worktree")
      yield* sql`INSERT INTO run_workspaces(run_id,base_ref,planned_branch,creator_block_id,creator_placement_path) VALUES(${plan.runId},${workspace.baseRef},${workspace.plannedBranch},${workspace.creatorBlockId},${first ? JSON.stringify(first.placementPath) : null})`;
    if (!starters.length)
      yield* createEntryLaunches(
        sql,
        {
          runId: plan.runId,
          definitions: plan.definitions,
          workspace,
          project,
          contextId: plan.contextId,
          retryScope: plan.retryScope,
          time: plan.time,
        },
        startLaunchTargets(plan.definitions, workspace),
      );
  });
}

function acceptStartRecords(
  sql: SqlClient.SqlClient,
  plan: StartPlan,
  hasFile: RunImages["hasFile"],
  commit?: AcceptanceCommit,
) {
  return Effect.gen(function* () {
    const [duplicate] = yield* sql<{
      id: string;
      request_fingerprint: string;
    }>`SELECT id,request_fingerprint FROM runs WHERE request_id=${plan.input.requestId}`;
    if (duplicate)
      return duplicate.request_fingerprint === plan.requestFingerprint
        ? { ok: true as const, value: duplicate.id }
        : failure("conflict", "Start key content conflicts.", [
            {
              code: "start_key_conflict",
              path: "requestId",
              message: "This Start request was accepted with other content.",
            },
          ]);
    const conflict =
      (yield* startConfigurationConflict(sql, plan)) ??
      (plan.closureStamp === undefined ? yield* ownershipConflict(sql, plan) : undefined);
    if (conflict) return conflict;
    const unstaged = yield* stagedManifestProblem(sql, plan.prompt.images, hasFile);
    if (unstaged) return unstaged;
    const title = plan.input.title.trim();
    yield* sql`INSERT INTO tasks(id,project_id,title,created_at) VALUES(${plan.taskId},${plan.project.id},${title},${plan.time})`;
    const project = plan.project;
    const [allocated] = yield* sql<{
      n: number;
    }>`SELECT COALESCE(MAX(number),0)+1 AS n FROM runs`;
    const number = allocated!.n;
    const { flow } = plan.definitions;
    const { segments, images } = plan.prompt;
    yield* sql`INSERT INTO runs(id,task_id,request_id,request_fingerprint,input,prompt_segments_json,context_id,workspace_root,started_at,created_at,creation_key,title,title_provenance,number,block_settlement_enabled,flow_revision_id) VALUES(${plan.runId},${plan.taskId},${plan.input.requestId},${plan.requestFingerprint},${workerPromptText(segments, images)},${JSON.stringify(segments)},${plan.contextId},${project.workspaceRoot},${plan.time},${plan.input.createdAt},${plan.input.requestId},${title},${plan.input.titleProvenance},${number},1,(SELECT id FROM flow_revisions WHERE flow_id=${flow.id} AND revision=${flow.revision}))`;
    yield* attachRunImages(sql, plan.runId, images);
    yield* appendTimelineEvent(sql, { kind: "started", runId: plan.runId, observedAt: plan.time });
    // After "started", so a generation skipped at Start follows it on the timeline.
    yield* recordTitleGeneration(sql, plan.titleGeneration, {
      id: plan.runId,
      number,
      title,
      time: plan.time,
      prompt: plan.prompt,
      project,
    });
    yield* captureStartScope(sql, plan, number);
    if (commit) {
      const permitted = yield* commit(plan.runId);
      if (!permitted.ok) return yield* Effect.fail(new AcceptanceRefused(permitted));
    }
    return { ok: true as const, value: plan.runId };
  });
}

export function openRunStart(database: RunnerDatabase) {
  /** Accepts a Start in one transaction outside any Run's lane (no Run exists yet; the Runner's
   * Start permit serializes it). A replayed key with the same content answers its existing Run; a
   * changed key, changed configuration or an unstaged image refuses. The staged image manifest is
   * checked and Run image records are written through the Run images module. A caller's `commit`
   * refusal rolls the acceptance back. Publishes the Run's live change after the commit when
   * accepted. */
  const acceptStart = (plan: StartPlan, hasFile: RunImages["hasFile"], commit?: AcceptanceCommit) =>
    database
      .transaction((sql) => acceptStartRecords(sql, plan, hasFile, commit))
      .pipe(
        Effect.catchIf(
          (error) => error instanceof AcceptanceRefused,
          (refused) => Effect.succeed(refused.refusal),
        ),
        Effect.tap((accepted) =>
          Effect.sync(() => {
            if (accepted.ok) database.changes.runChanged(accepted.value);
          }),
        ),
      );
  const startSubflows = (rootId: string, definitions: readonly FlowClosureDefinition[]) =>
    database.transaction((sql) =>
      Effect.gen(function* () {
        const captured: RunDefinitions["flow"][] = [];
        for (const entry of definitions) {
          if (entry.kind !== "flow" || entry.id === rootId) continue;
          const [revision] = yield* sql<{
            id: string;
          }>`SELECT id FROM flow_revisions WHERE flow_id=${entry.id} AND revision=${entry.revision}`;
          if (!revision) return failure("conflict", "A saved Subflow revision is unavailable.");
          captured.push(yield* readFlowRevision(sql, revision.id));
        }
        return { ok: true as const, value: captured };
      }),
    );
  return { acceptStart, startSubflows };
}
