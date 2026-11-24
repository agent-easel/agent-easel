import { completedStartIssues, type StartIssue } from "./start-issues.ts";
import { entryMessagesTooLong } from "./runner-block-workers.ts";
import type { EffectOperations } from "../effect-operations.ts";
import { newId } from "../ids.ts";
import type {
  AgentDefinition,
  CapturedAgent,
  FactoryOperations,
  FactoryProject,
  FlowDraft,
  ProjectCatalog,
  Result,
  RunDetail,
  RunDefinitions,
  RunImage,
  StartRunInput,
  T3Connection,
  ValidationIssue,
} from "@agent-easel/contracts";
import {
  executionForProject,
  flowReadiness,
  isCanonicalTimestamp,
  isSha256Hex,
  isStartTitleProvenance,
  promptText,
  promptTitle,
  readinessAgent,
  RUN_IMAGE_LIMIT,
  TASK_TITLE_LIMIT,
  validateStartPrompt,
  type StartPrompt,
} from "@agent-easel/domain-validation";
import * as Effect from "effect/Effect";
import type { GitHubAdapter } from "../adapters/github.ts";
import type { GitAdapter } from "../adapters/git.ts";
import { attachmentSupport, type T3ContractSnapshot } from "../t3/contract.ts";
import type { ContractSnapshots } from "../connection.ts";
import { failure } from "../result.ts";
import type {
  AcceptanceCommit,
  RunStore,
  StartPlan,
  StartWorkspace,
} from "./run-store/run-store.ts";
import type { RunnerLifecycle, RunnerOptions } from "./runner-types.ts";
import { catalogProject } from "./runner-utils.ts";
import { projectUnavailableIssue } from "../projects.ts";
import { fingerprint } from "../fingerprint.ts";
import { isLocalEndpoint } from "../endpoint-local.ts";
import { now } from "../time.ts";
import { workerPromptText, type RunImages } from "../run-images.ts";
import { telemetryCount, type Telemetry } from "../telemetry.ts";
import type { RunnerTitleGeneration } from "../run-titles.ts";
/** A trusted caller's authority, refreshed after preflight and fenced with local acceptance. */
export interface StartAuthorization {
  readonly triggerIssue?: StartIssue;
  readonly check: Effect.Effect<Result<undefined>, unknown>;
  /**
   * Local state only: this runs inside the Run acceptance transaction after the accepted Run's
   * records are written, so its own writes may reference `runId`. A refusal rolls back the whole
   * acceptance, including those writes.
   */
  readonly commit: AcceptanceCommit;
}

/** Request identity and choices; the prompt itself is validated by `validateStartPrompt`. */
function validStartKeys(input: unknown): input is Omit<StartRunInput, "segments" | "images"> {
  if (!input || typeof input !== "object") return false;
  const { requestId, projectId, flowId } = input as Record<string, unknown>;
  return (
    [requestId, projectId, flowId].every(
      (candidate) => typeof candidate === "string" && candidate.trim(),
    ) && (requestId as string).length <= 256
  );
}
/**
 * The accepted key's content. A text-only prompt keeps the earlier `[project, Flow, input, title,
 * creation time]` form, so a request accepted before images still recovers its Run; images add the
 * ordered segments and every manifest field. Only manual provenance, the owner's own title, is
 * appended: automatic and legacy keep the historical identity, so a request accepted before
 * provenance existed, such as a `factory_start_run` retried after an upgrade, still recovers its Run.
 */
function startFingerprint(
  input: Pick<StartRunInput, "projectId" | "flowId" | "title" | "titleProvenance" | "createdAt">,
  prompt: StartPrompt,
) {
  const text = promptText(prompt.segments);
  const content: unknown[] = [input.projectId, input.flowId, text, input.title, input.createdAt];
  if (prompt.images.length) content.push(prompt.segments, prompt.images);
  if (input.titleProvenance === "manual") content.push({ titleProvenance: input.titleProvenance });
  return fingerprint(JSON.stringify(content));
}
/**
 * A request sent before provenance existed, such as a composer's stored pending Start, has no
 * `titleProvenance`; it is legacy and never guessed from its title.
 */
function startTitleProvenance(input: object) {
  return "titleProvenance" in input ? input.titleProvenance : "legacy";
}
function startPresentationIssues(
  input: Pick<StartRunInput, "title" | "titleProvenance" | "createdAt">,
): ValidationIssue[] {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  return [
    ...(isStartTitleProvenance(input.titleProvenance)
      ? []
      : [
          {
            code: "run_title_provenance",
            path: "titleProvenance",
            message: "Title provenance must be automatic, manual or legacy.",
          },
        ]),
    ...(title && title.length <= TASK_TITLE_LIMIT
      ? []
      : [
          {
            code: "run_title",
            path: "title",
            message: `Run title is required and must fit ${TASK_TITLE_LIMIT} characters.`,
          },
        ]),
    ...(isCanonicalTimestamp(input.createdAt)
      ? []
      : [
          {
            code: "run_created_at",
            path: "createdAt",
            message:
              "The draft creation time must use the Date.toISOString() format, such as 2026-11-07T08:00:00.000Z.",
          },
        ]),
  ];
}
/** The snapshot's T3 context and an available project on the same endpoint and environment. */
function startTarget(
  snapshot: T3ContractSnapshot,
  connection: Result<T3Connection>,
  catalog: Result<ProjectCatalog>,
  projectId: string,
) {
  const project = catalogProject(catalog, projectId);
  if (
    !connection.ok ||
    connection.value.state !== "ready" ||
    !snapshot.contextId ||
    connection.value.authorizationContext?.id !== snapshot.contextId ||
    !project ||
    project.availability !== "available" ||
    project.endpoint !== connection.value.endpoint ||
    project.environmentId !== connection.value.authorizationContext.environmentId
  )
    return undefined;
  return { project, context: connection.value.authorizationContext };
}
/**
 * A Project Flow starts only in its owning Project, and only while that Project is available; the
 * refusal names the owning Project's availability reason. A global Flow starts in any Project.
 */
function ownershipRefusal(flow: FlowDraft, catalog: Result<ProjectCatalog>, projectId: string) {
  if (flow.projectId === null) return undefined;
  if (flow.projectId !== projectId)
    return failure(
      "validation",
      "This Flow belongs to another Project. Choose its Project, or a global Flow.",
      [
        {
          code: "flow_project_mismatch",
          path: "flowId",
          message: "Choose a global Flow or a Flow of the selected Project.",
        },
      ],
    );
  const owner = catalogProject(catalog, projectId);
  if (owner?.availability === "available") return undefined;
  const issue = projectUnavailableIssue(owner, "projectId");
  return failure("validation", issue.message, [issue]);
}
type WorkspaceCheck =
  | { ok: true; workspace: StartWorkspace }
  | { ok: false; issues: ValidationIssue[] };
const workspaceIssue = (code: string, path: string, message: string): WorkspaceCheck => ({
  ok: false,
  issues: [{ code, path, message }],
});
/** Resolves a worktree Flow's base against the selected Project's repository on this host. */
function resolveStartWorkspace(
  git: GitAdapter,
  flow: FlowDraft,
  project: FactoryProject,
): Effect.Effect<WorkspaceCheck> {
  return Effect.gen(function* () {
    const { workspace } = flow;
    if (workspace.mode === "checkout") return { ok: true, workspace: { mode: "checkout" } };
    if (!isLocalEndpoint(project.endpoint))
      return workspaceIssue(
        "workspace_remote_host",
        "workspace.mode",
        "A new worktree needs T3 on this computer. Choose the project checkout for this Flow.",
      );
    const resolved = yield* Effect.tryPromise({
      try: () => git.resolveBaseRef(project.endpoint, project.workspaceRoot, workspace.base),
      catch: (error) => error,
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (resolved === undefined)
      return workspaceIssue(
        "workspace_ref_unreadable",
        "workspace.base",
        `Git refs in ${project.title} could not be read. Check the repository and retry.`,
      );
    if (resolved === null)
      return workspace.base.kind === "default"
        ? workspaceIssue(
            "workspace_default_branch_missing",
            "workspace.base",
            `${project.title} has no default branch (origin/HEAD). Set it in the repository or choose a custom ref.`,
          )
        : workspaceIssue(
            "workspace_ref_missing",
            "workspace.base.ref",
            `${workspace.base.ref} is not a commit in ${project.title}. Choose an existing ref.`,
          );
    return { ok: true, workspace: { mode: "worktree", baseRef: resolved } };
  });
}
/** An image-bearing Start needs T3 to accept uploads and launch attachments for every image. */
function attachmentIssues(snapshot: T3ContractSnapshot, count: number): ValidationIssue[] {
  if (!count) return [];
  const support = attachmentSupport(snapshot.support, count);
  if (support.supported) return [];
  return [
    {
      code: "attachments_unsupported",
      path: "images",
      message: `This T3 cannot receive image attachments: update T3 or remove the images. ${support.explanation}`,
    },
  ];
}
/** The first worker message is checked before the acceptance transaction commits. */
function prepareStartWork(definitions: RunDefinitions, prompt: StartPrompt) {
  if (
    entryMessagesTooLong(
      definitions,
      prompt.images,
      workerPromptText(prompt.segments, prompt.images),
    )
  )
    return failure("validation", "The Agent prompt exceeds T3's first-message limit.");
  return { ok: true as const };
}
type RunSource = "manual" | "trigger" | "chat_control" | "mcp";

export function openRunnerStart(
  store: RunStore,
  ops: EffectOperations<FactoryOperations>,
  freshSnapshot: ContractSnapshots["fresh"],
  refreshProjects: EffectOperations<FactoryOperations>["recheckProjects"],
  git: GitAdapter,
  github: GitHubAdapter,
  lifecycle: RunnerLifecycle,
  checkAgent: RunnerOptions["checkAgent"],
  planTitleGeneration: RunnerTitleGeneration["planTitleGeneration"],
  followTitleGeneration: (runId: string) => Effect.Effect<void, unknown>,
  images: RunImages,
  telemetry: Telemetry,
) {
  const { isClosed, drive, getRun } = lifecycle;
  const recordStarted = Effect.fn(function* (
    flow: FlowDraft,
    source: RunSource,
    hasImages: boolean,
  ) {
    if (telemetry.enabled) {
      const { blocks } = flow.graph;
      const blockTypes = (["agent", "condition", "join", "wait", "subflow"] as const).filter(
        (kind) => blocks.some((block) => block.kind === kind),
      );
      yield* telemetry.record("run.started", {
        source,
        flowScope: flow.projectId === null ? "global" : "project",
        blockCount: telemetryCount(blocks.length + 1),
        hasImages: hasImages,
        blockTypes: [...blockTypes, "finish"],
      });
    }
  });
  function start(
    rawInput: unknown,
    authorization?: StartAuthorization,
    source: RunSource = "manual",
  ): Effect.Effect<Result<RunDetail>, unknown> {
    return Effect.gen(function* () {
      if (isClosed())
        return failure(
          "conflict",
          "Factory is shutting down. Retry this same Start request after restart.",
        );
      if (!validStartKeys(rawInput))
        return failure("validation", "Choose a project and Flow before starting.", [
          {
            code: "start_request",
            path: "projectId",
            message: "Project, Flow and a stable Start request ID are required.",
          },
        ]);
      const input = {
        ...(rawInput as typeof rawInput & Pick<StartRunInput, "title" | "createdAt">),
        titleProvenance: startTitleProvenance(rawInput) as StartRunInput["titleProvenance"],
      };
      const prompt = validateStartPrompt(rawInput);
      if (!prompt.ok) return prompt;
      const presentationIssues = startPresentationIssues(input);
      if (presentationIssues.length)
        return failure(
          "validation",
          "Give the Run a title, its title provenance and a valid creation time.",
          presentationIssues,
        );
      const content = startFingerprint(input, prompt.value);
      const existing = yield* store.acceptedStart(input.requestId);
      if (existing)
        return existing.request_fingerprint === content
          ? yield* getRun(existing.id)
          : failure("conflict", "This Start key was already accepted with different content.", [
              {
                code: "start_key_conflict",
                path: "requestId",
                message: "This Start request was accepted with other content.",
              },
            ]);
      const [checked, titleGeneration] = yield* startChecks(input, prompt.value);
      if (!checked.ok) return checked;
      const { project, context, definitions, closureStamp, retryScope, workspace } = checked.value;
      const ready = prepareStartWork(definitions, prompt.value);
      if (!ready.ok) return ready;

      const warnings = yield* Effect.promise(() =>
        completedStartIssues(
          github,
          project,
          promptText(prompt.value.segments),
          input.confirmCompletedIssues === true,
          authorization?.triggerIssue,
        ),
      );
      if (warnings.length)
        return failure("validation", "Review completed GitHub work before starting.", warnings);
      const runId = yield* newId,
        taskId = yield* newId;
      const plan: StartPlan = {
        input,
        prompt: prompt.value,
        requestFingerprint: content,
        project,
        definitions,
        closureStamp,
        workspace,
        runId,
        taskId,
        time: yield* now,
        contextId: context.id,
        retryScope,
        titleGeneration,
      };
      if (authorization) {
        const permitted = yield* authorization.check;
        if (!permitted.ok) return permitted;
      }
      const accepted = yield* store.acceptStart(plan, images.hasFile, authorization?.commit);
      if (!accepted.ok) return accepted;
      yield* recordStarted(definitions.flow, source, prompt.value.images.length > 0).pipe(
        Effect.when(Effect.succeed(accepted.value === runId)),
      );
      // Deliberately detached from the response. The accepted Run survives a lost HTTP reply.
      // The title thread launches beside the Flow and never gates its dispatch.
      if (!isClosed()) {
        yield* lifecycle.fork(drive(accepted.value));
        yield* followTitleGeneration(accepted.value);
      }
      return yield* getRun(accepted.value);
    });
  }
  function stagedManifest(
    references: unknown,
    alreadyAccepted: boolean,
  ): Effect.Effect<Result<RunImage[]>, unknown> {
    return Effect.gen(function* () {
      if (references === undefined) return { ok: true as const, value: [] };
      const issue = (code: string, path: string, message: string) =>
        failure("validation", "Check the Run's images.", [{ code, path, message }]);
      if (!Array.isArray(references))
        return issue("start_images", "images", "Send images as a list of {sha256, name}.");
      if (references.length > RUN_IMAGE_LIMIT)
        return issue("image_count", "images", `Attach at most ${RUN_IMAGE_LIMIT} images.`);
      const manifest: RunImage[] = [];
      for (const [index, reference] of references.entries()) {
        const { sha256, name } = (reference ?? {}) as Record<string, unknown>;
        if (typeof name !== "string" || !isSha256Hex(sha256))
          return issue(
            "start_images",
            `images.${index}`,
            "Each image needs its lowercase hex sha256 and a name.",
          );
        const staged = yield* alreadyAccepted
          ? images.getStagedImageRecord(sha256)
          : images.getRunImageInfo(sha256);
        if (!staged.ok && alreadyAccepted)
          return failure(
            "conflict",
            "This Start key was already accepted with different content.",
            [
              {
                code: "start_key_conflict",
                path: "requestId",
                message: "This Start request was accepted with other content.",
              },
            ],
          );
        if (!staged.ok)
          return issue(
            "image_not_staged",
            `images.${index}`,
            `${name} is not staged in Factory. Stage it with factory_stage_run_image and retry.`,
          );
        manifest.push({ imageId: `image-${index + 1}`, name, ...staged.value });
      }
      return { ok: true as const, value: manifest };
    });
  }
  /**
   * A text-only Start whose title and creation time are derived as the Start form derives them.
   * A retry of an accepted request reuses its stored creation time, so it keeps the same content.
   */
  function startText(
    rawInput: unknown,
    authorization?: StartAuthorization,
  ): Effect.Effect<Result<RunDetail>, unknown> {
    return Effect.gen(function* () {
      const {
        requestId,
        projectId,
        flowId,
        input,
        confirmCompletedIssues,
        title: manualTitle,
        images: references,
      } = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
      if (typeof input !== "string")
        return failure("validation", "Send the Run's prompt as text.", [
          { code: "start_input", path: "input", message: "Send the prompt as text." },
        ]);
      if (manualTitle !== undefined && (typeof manualTitle !== "string" || !manualTitle.trim()))
        return failure("validation", "Give the Run a title or omit it.", [
          { code: "run_title", path: "title", message: "Send a non-empty title or omit it." },
        ]);
      const accepted =
        typeof requestId === "string" ? yield* store.acceptedStart(requestId) : undefined;
      const manifest = yield* stagedManifest(references, accepted !== undefined);
      if (!manifest.ok) return manifest;
      return yield* start(
        {
          requestId,
          projectId,
          flowId,
          confirmCompletedIssues,
          segments: [{ type: "text", text: input }],
          images: manifest.value,
          title: manualTitle?.trim() ?? promptTitle(input) ?? "",
          titleProvenance: manualTitle === undefined ? "automatic" : "manual",
          createdAt: accepted?.created_at ?? (yield* now),
        },
        authorization,
        authorization?.triggerIssue ? "trigger" : authorization ? "chat_control" : "mcp",
      );
    });
  }
  /**
   * One T3 contract snapshot, then Start preconditions and, alongside them so it adds no wait of
   * its own, the title generation decision. The decision is used only if Start accepts.
   */
  function startChecks(
    input: Pick<StartRunInput, "projectId" | "flowId" | "titleProvenance">,
    prompt: StartPrompt,
  ) {
    return Effect.gen(function* () {
      const snapshot = yield* freshSnapshot();
      return yield* Effect.all(
        [
          startPreconditions(input, prompt.images.length, snapshot),
          planTitleGeneration({ titleProvenance: input.titleProvenance, prompt }, snapshot),
        ],
        { concurrency: "unbounded" },
      );
    });
  }
  /** Before Start: the catalog reconciled under Start's snapshot, then every launch precondition. */
  function startPreconditions(
    input: Pick<StartRunInput, "projectId" | "flowId">,
    imageCount: number,
    snapshot: T3ContractSnapshot,
  ) {
    return Effect.gen(function* () {
      yield* refreshProjects();
      return yield* launchPreconditions(input, imageCount, snapshot);
    });
  }
  /**
   * What Start's preflight refuses for every prompt to this Project and Flow, without Start's
   * catalog refresh first. It accepts nothing, so a caller can learn of a launch blocker without
   * attempting a Start.
   */
  function startBlockers(projectId: string, flowId: string) {
    return Effect.gen(function* () {
      const checked = yield* launchPreconditions({ projectId, flowId }, 0, yield* freshSnapshot());
      return checked.ok ? { ok: true as const, value: undefined } : checked;
    });
  }
  function startPreflight(projectId: string, flowId: string) {
    return Effect.gen(function* () {
      const checked = yield* startPreconditions({ projectId, flowId }, 0, yield* freshSnapshot());
      return checked.ok ? { ok: true as const, value: undefined } : checked;
    });
  }
  /** Connection/project, Flow readiness, every referenced Agent's runtime and launch schema. */
  function launchPreconditions(
    input: Pick<StartRunInput, "projectId" | "flowId">,
    imageCount: number,
    snapshot: T3ContractSnapshot,
  ) {
    return Effect.gen(function* () {
      const [connection, projects, savedFlow] = yield* Effect.all(
        [ops.getConnection(), ops.listProjects(), ops.getFlow(input.flowId)],
        { concurrency: "unbounded" },
      );
      const owned = savedFlow.ok
        ? ownershipRefusal(savedFlow.value, projects, input.projectId)
        : undefined;
      if (owned) return owned;
      const target = startTarget(snapshot, connection, projects, input.projectId);
      if (!target)
        return failure(
          "validation",
          "Connect T3 and restore this project's repository before starting.",
          [
            {
              code: "project_connection",
              path: "projectId",
              message: "Check project and T3 connection settings.",
            },
          ],
        );
      if (!savedFlow.ok) return savedFlow;
      return yield* flowLaunchPreconditions(savedFlow.value, target, imageCount, snapshot);
    });
  }

  function flowLaunchPreconditions(
    flow: FlowDraft,
    target: NonNullable<ReturnType<typeof startTarget>>,
    imageCount: number,
    snapshot: T3ContractSnapshot,
  ) {
    return Effect.gen(function* () {
      if (!flow.readiness.ready)
        return failure("validation", "Fix Flow readiness before starting.", flow.readiness.issues);
      const closure = flow.readiness.closure;
      const subflows = yield* store.startSubflows(flow.id, closure?.definitions ?? []);
      if (!subflows.ok) return subflows;
      const agents = yield* readyAgents(flow, closure, target.project.id, snapshot);
      const support = snapshot.support.launch[flow.workspace.mode];
      const workspace = yield* resolveStartWorkspace(git, flow, target.project);
      const attachments = attachmentIssues(snapshot, imageCount);
      const freshContextMissing =
        [flow, ...subflows.value].some((entry) =>
          entry.graph.blocks.some(
            (block) => block.kind === "agent" && block.revisitContext === "fresh",
          ),
        ) && !snapshot.support.freshContextSend;
      const issues: ValidationIssue[] = [
        ...attachments,
        ...(!workspace.ok ? workspace.issues : []),
        ...(!agents.ok ? agents.error.issues : []),
        ...(!support.supported
          ? [
              {
                code: "launch_unsupported",
                path: "connection.contract",
                message:
                  support.explanation ??
                  "T3 launch capabilities are unavailable. Recheck the connection and retry this Start.",
              },
            ]
          : []),
        ...(freshContextMissing
          ? [
              {
                code: "fresh_context_unsupported",
                path: "connection.contract",
                message:
                  "This T3 does not support fresh-context revisits. Update T3 or set Agent blocks to keep context on revisit.",
              },
            ]
          : []),
      ];
      if (issues.length || !workspace.ok || !agents.ok)
        return failure(
          "validation",
          "Flow execution setup is incomplete. No Run was created.",
          issues,
        );
      return {
        ok: true as const,
        value: {
          ...target,
          definitions: {
            flow,
            agents: agents.value,
            ...(subflows.value.length ? { subflows: subflows.value } : {}),
          },
          closureStamp: closure?.stamp,
          retryScope: support.retryScope,
          workspace: workspace.workspace,
        },
      };
    });
  }
  function readyAgents(
    flow: FlowDraft,
    closure: FlowDraft["readiness"]["closure"],
    projectId: string,
    snapshot: T3ContractSnapshot,
  ): Effect.Effect<Result<CapturedAgent[]>, unknown> {
    return Effect.gen(function* () {
      const read: AgentDefinition[] = [];
      const agents: CapturedAgent[] = [];
      const issues: ValidationIssue[] = [];
      const ids = new Set(
        closure
          ? closure.definitions.filter((entry) => entry.kind === "agent").map((entry) => entry.id)
          : flow.graph.blocks.flatMap((block) =>
              block.kind === "agent" && block.agentId ? [block.agentId] : [],
            ),
      );
      for (const id of ids) {
        const agent = yield* ops.getAgent(id);
        if (agent.ok) read.push(agent.value);
        else
          issues.push({
            code: "agent_unavailable",
            path: `agents.${id}`,
            message: `Agent ${id}: ${agent.error.message}`,
          });
      }
      // Recheck the graph against the Agents this Start could read. A model-less Agent reports
      // `agent_model_required` even when another referenced Agent could not be read. An unread
      // Agent stays the single `agent_unavailable` above; its block's "choose a saved Agent"
      // finding would only repeat that.
      const readIds = new Set(read.map((agent) => agent.id));
      if (!closure)
        issues.push(
          ...flowReadiness(
            flow.graph,
            read.map((agent) => readinessAgent(agent, new Map())),
            flow.projectId,
          ).issues.filter((issue) => !unreadAgentIssue(flow, issue.path, readIds)),
        );
      for (const saved of read) {
        // A model-less Agent has no settings to check, so it never also reports them unavailable.
        // It has no Project overrides either, so its own null settings decide that.
        if (saved.execution === null) {
          if (closure)
            issues.push({
              code: "agent_model_required",
              path: "agents." + saved.id,
              message: saved.name + " needs a model.",
            });
          continue;
        }
        const agent = { ...saved, execution: executionForProject(saved, projectId) };
        const check = yield* checkAgent(projectId, agent, snapshot);
        const problems = !check.ok
          ? [
              { code: "agent_readiness", path: "runtime", message: check.error.message },
              ...check.error.issues,
            ]
          : check.value.issues;
        issues.push(
          ...problems.map((issue) => ({
            ...issue,
            path: `agents.${agent.id}.${issue.path}`,
            message: `${agent.name}: ${issue.message}`,
          })),
        );
        agents.push(agent);
      }
      return issues.length
        ? failure("validation", "Flow Agent setup is incomplete.", issues)
        : { ok: true, value: agents };
    });
  }
  return { start, startText, startBlockers, startPreflight };
}

/** A graph issue on an Agent block this Start could not read. Those blocks already report
 * `agent_unavailable`. */
function unreadAgentIssue(flow: FlowDraft, path: string, readIds: ReadonlySet<string>) {
  const index = /^graph\.blocks\.(\d+)(?:\.|$)/.exec(path);
  if (!index) return false;
  const block = flow.graph.blocks[Number(index[1])];
  return block?.kind === "agent" && block.agentId !== null && !readIds.has(block.agentId);
}
