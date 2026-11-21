import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  arrangeFlow,
  defaultFinishPosition,
  AUTHORING_DIMENSIONS,
  canvasGraph,
  createFlowLayoutDimensions,
  FlowLayoutLimitError,
} from "@t3-factory/flow-layout";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import {
  AGENT_CREATE_WINDOW_MS,
  PORTABLE_DOCUMENT_FORMAT,
  PORTABLE_DOCUMENT_VERSION,
  type AgentCapabilities,
  type AgentCreateOutcome,
  type AgentDefinition,
  type CommitImportInput,
  type AgentProjectOverride,
  type FactoryOperations,
  type FlowBlock,
  type FlowDraft,
  type FlowDuplicate,
  type DuplicateFlowInput,
  type FlowDuplicateAgentChoice,
  type FlowDuplicatePlan,
  type FlowFindingsPage,
  type FlowGraph,
  type FlowGraphInput,
  type FlowValidation,
  type ImportResult,
  type PortableFlow,
  type ProjectCatalog,
  type Result,
  type StudioDefinitions,
  type UpdateFlowInput,
} from "@t3-factory/contracts";
import {
  CANVAS_COORD_MESSAGE,
  bindPortableBlocks,
  compositionReadiness,
  duplicateTreatment,
  executionForProject,
  flowAgentRevisions,
  findingsPage,
  flowEditSizeRefusal,
  mayPlaceAgent,
  mayPlaceFlow,
  parsePortableFile,
  placementIssues,
  type CompositionDefinitions,
  type OwningProject,
  type ReadinessFlow,
  validateChangeOwner,
  validateCommitImport,
  validateCreateAgent,
  validateCreateFlow,
  validateDuplicateAgent,
  validateDuplicateFlow,
  validateListFlowFindings,
  validatePreviewFlowDuplicate,
  validateUpdateAgent,
  validateUpdateFlow,
} from "@t3-factory/domain-validation";
import { emptyCapabilities, readyCapabilities, unsupportedReportingFailure } from "./agents.ts";
import { readVibeReportingInstances } from "./reporting-discovery.ts";
import type { T3Projects } from "./t3/projects.ts";
import type { EffectOperations } from "./effect-operations.ts";
import { telemetryBuiltInDriver, telemetryCount, type Telemetry } from "./telemetry.ts";
import type { LiveChanges } from "./live-changes.ts";
import { failure } from "./result.ts";
import { projectUnavailableIssue } from "./projects.ts";
import { now as currentTime, nowAfter } from "./time.ts";
import { newId } from "./ids.ts";
import {
  appendFlowRevision,
  currentFlowsPlacingFlow,
  currentFlowsReferencingAgent,
  readCurrentFlows,
  type CurrentFlow,
} from "./flow-revisions.ts";
import { readCompositionDefinitions } from "./composition-definitions.ts";
import { appendAgentRevision, readCurrentAgents } from "./agent-revisions.ts";
import {
  definitionExport,
  importReview,
  portableAgent,
  portableComposition,
  unsupportedSelections,
} from "./portable-definitions.ts";
import { readImportReceipt, replayedImport, writeImportReceipt } from "./import-receipts.ts";
/** A new Flow starts with its Flow input block at the top-left of the canvas. */
const NEW_FLOW_INPUT_POSITION = { x: 40, y: 50 };
const unplacedFinishPosition = (graph: Pick<FlowGraph, "blocks" | "flowInput">) =>
  defaultFinishPosition(graph, {
    flowInputWidth: AUTHORING_DIMENSIONS.flowInput.width,
    blockWidth: AUTHORING_DIMENSIONS.block.width,
  });

const toDraft = (flow: CurrentFlow, definitions: CompositionDefinitions): FlowDraft => ({
  ...flow,
  readiness: compositionReadiness(flow, definitions).readiness,
});
const clearRemovedValue = (result: Result<unknown>): Result<void> =>
  result.ok ? { ok: true, value: undefined } : result;
const FINDINGS_PAGE_SIZE = 100;
const flowNotFound = () => failure("not_found", "This Flow does not exist.");
/** A refusal about one Project override, its issues addressed under that override. */
function underOverride(refusal: Result<never>, index: number): Result<never> {
  if (refusal.ok) return refusal;
  return {
    ok: false,
    error: {
      ...refusal.error,
      issues: refusal.error.issues.map((issue) => ({
        ...issue,
        path: `projectOverrides.${index}.${issue.path}`,
      })),
    },
  };
}

const staleRevision = (kind: "Agent" | "Flow") =>
  failure(
    "conflict",
    `A newer ${kind} revision exists. Keep your edits and reconcile before saving again.`,
    [
      {
        code: "stale_revision",
        path: "expectedRevision",
        message: `Compare the latest saved ${kind} with your local draft.`,
      },
    ],
  );

/** Saves and Change owner name the owning Project the client saw; another client moved it since. */
const staleOwner = (kind: "Agent" | "Flow") =>
  failure(
    "conflict",
    `This ${kind}'s owning Project changed elsewhere, so nothing was written. Review its current owner before trying again.`,
    [
      {
        code: "stale_owner",
        path: "expectedProjectId",
        message: `Compare the ${kind}'s current owning Project with the one you opened.`,
      },
    ],
  );

const staleDuplicatePlan = (path: "expectedRevision" | "agents" | "flows") =>
  failure(
    "conflict",
    "The Flow or an Agent it places changed after this Duplicate was previewed.",
    [{ code: "stale_duplicate_plan", path, message: "Preview the Duplicate again." }],
  );

function placedAgents(flows: readonly CurrentFlow[], agents: readonly AgentDefinition[]) {
  const current = new Map(agents.map((agent) => [agent.id, agent]));
  const placed = new Map<string, AgentDefinition>();
  for (const block of flows.flatMap((flow) => flow.graph.blocks)) {
    const agent = block.kind === "agent" && block.agentId !== null && current.get(block.agentId);
    if (agent) placed.set(agent.id, agent);
  }
  return [...placed.values()];
}

function duplicatePlan(
  source: CurrentFlow,
  target: OwningProject,
  flows: ReadonlyMap<string, CurrentFlow>,
  agents: readonly AgentDefinition[],
) {
  const copied = new Map([[source.id, source]]);
  const pending = [source];
  for (let at = 0; at < pending.length; at++)
    for (const block of pending[at]!.graph.blocks) {
      if (block.kind !== "subflow" || block.flowId === null || copied.has(block.flowId)) continue;
      const child = flows.get(block.flowId);
      if (!child || mayPlaceFlow(target, child.projectId)) continue;
      copied.set(child.id, child);
      pending.push(child);
    }
  return { flows: pending, agents: placedAgents(pending, agents) };
}

const sameCopiedFlows = (
  planned: readonly CurrentFlow[],
  named: NonNullable<DuplicateFlowInput["flows"]>,
) =>
  planned.length === named.length &&
  planned.every((flow) =>
    named.some(
      (entry) =>
        entry.flowId === flow.id &&
        entry.revision === flow.revision &&
        entry.projectId === flow.projectId,
    ),
  );

/**
 * The Agents a Flow Duplicate commit copies: refused as stale unless the choices name exactly the
 * placed Agents at their current revision and owner, and refused where a choice the plan fixes
 * was changed.
 */
function agentsToCopy(
  placed: readonly AgentDefinition[],
  target: OwningProject,
  choices: readonly FlowDuplicateAgentChoice[],
): Result<AgentDefinition[]> {
  const chosen = new Map(choices.map((choice, index) => [choice.agentId, { ...choice, index }]));
  const matched = placed.flatMap((agent) => {
    const choice = chosen.get(agent.id);
    return choice?.revision === agent.revision && choice.projectId === agent.projectId
      ? [{ agent, choice }]
      : [];
  });
  if (
    matched.length !== placed.length ||
    chosen.size !== choices.length ||
    chosen.size !== placed.length
  )
    return staleDuplicatePlan("agents");
  const issues = matched.flatMap(({ agent, choice }) => {
    const treatment = duplicateTreatment(target, agent.projectId);
    if (treatment.changeable || choice.choice === treatment.choice) return [];
    return [
      {
        code: "duplicate_choice_not_allowed",
        path: `agents.${choice.index}.choice`,
        message:
          treatment.choice === "copy"
            ? `${agent.name} cannot be placed in the target, so the Duplicate must copy it.`
            : `${agent.name} belongs to the target Project, so the Duplicate keeps it.`,
      },
    ];
  });
  if (issues.length) return failure("validation", issues[0]!.message, issues);
  return {
    ok: true,
    value: matched.filter(({ choice }) => choice.choice === "copy").map(({ agent }) => agent),
  };
}

function copiedBlock(
  block: FlowBlock,
  agentIds: ReadonlyMap<string, string>,
  flowIds: ReadonlyMap<string, string>,
): FlowBlock {
  if (block.kind === "agent" && block.agentId !== null)
    return { ...block, agentId: agentIds.get(block.agentId) ?? block.agentId };
  if (block.kind === "subflow" && block.flowId !== null)
    return { ...block, flowId: flowIds.get(block.flowId) ?? block.flowId };
  return block;
}

type DefinitionOperations = Pick<
  EffectOperations<FactoryOperations>,
  | "createFlow"
  | "validateFlow"
  | "updateFlow"
  | "changeFlowOwner"
  | "removeFlow"
  | "previewFlowDuplicate"
  | "duplicateFlow"
  | "listFlows"
  | "getFlow"
  | "listFlowFindings"
  | "getAgentCapabilities"
  | "listAgents"
  | "getAgent"
  | "reserveAgentCreate"
  | "getAgentCreateOutcome"
  | "createAgent"
  | "updateAgent"
  | "changeAgentOwner"
  | "duplicateAgent"
  | "removeAgent"
  | "exportAgent"
  | "exportFlow"
  | "reviewImport"
  | "commitImport"
>;
/** The definition writes whose success publishes a live Studio change. */
const LIVE_PUBLISHING_OPERATIONS: ReadonlySet<keyof DefinitionOperations> = new Set([
  "createFlow",
  "updateFlow",
  "changeFlowOwner",
  "removeFlow",
  "duplicateFlow",
  "createAgent",
  "updateAgent",
  "changeAgentOwner",
  "duplicateAgent",
  "removeAgent",
  "commitImport",
]);

const createClockMillis = Clock.monotonicTimeNanos.pipe(
  Effect.map((now) => Number(now / 1_000_000n)),
);

export const makeDefinitions = (
  t3: T3Projects,
  connection: Pick<EffectOperations<FactoryOperations>, "getConnection">,
  projects: { readCatalog(): Effect.Effect<Result<ProjectCatalog>, unknown> },
  changes: LiveChanges,
  t3StateDirectory: string,
  /** Recorded in exported files for information only. */
  factoryVersion: string,
  telemetry: Telemetry,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // Only this backend lifetime can accept its reservations. After restart the Agent row still
    // resolves a committed attempt, and an unused reservation from the stopped host cannot write.
    const createKey = randomBytes(32);
    const signCreate = (payload: string) =>
      createHmac("sha256", createKey).update(payload).digest("base64url");
    const createDeadline = (id: string) => {
      const ticket = /^([0-9a-f-]{36}\.([0-9]{1,16}))\.([\w-]{43})$/.exec(id);
      if (!ticket || !timingSafeEqual(Buffer.from(signCreate(ticket[1]!)), Buffer.from(ticket[3]!)))
        return undefined;
      return Number(ticket[2]);
    };
    /** Publishes after a write's transaction committed; a refused write changed nothing. */
    const publishOnSuccess = <A, E>(write: Effect.Effect<Result<A>, E>) =>
      write.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result.ok) changes.definitionsChanged();
          }),
        ),
      );
    const provideSql = <A>(operation: Effect.Effect<Result<A>, unknown, SqlClient.SqlClient>) =>
      operation.pipe(Effect.provideService(SqlClient.SqlClient, sql));
    const transaction = <A>(operation: Effect.Effect<Result<A>, unknown, SqlClient.SqlClient>) =>
      provideSql(sql.withTransaction(operation));
    const readinessDefinitions = readCompositionDefinitions(sql);
    const positionGraph = (input: FlowGraphInput) =>
      Effect.gen(function* () {
        const placed = {
          flowInput: { ...input.flowInput, position: input.flowInput.position ?? { x: 0, y: 0 } },
          blocks: input.blocks.map((block): FlowBlock => {
            const position = block.position ?? { x: 0, y: 0 };
            return block.kind === "agent"
              ? {
                  ...block,
                  position,
                  revisitInstruction: block.revisitInstruction ?? "",
                  revisitContext: block.revisitContext ?? "keep",
                }
              : { ...block, position };
          }),
        };
        const graph: FlowGraph = {
          connections: input.connections,
          ...placed,
          ...(input.finish && {
            finish: {
              endings: input.finish.endings,
              position: input.finish.position ?? unplacedFinishPosition(placed),
            },
          }),
        };
        if (
          input.flowInput.position !== undefined &&
          input.blocks.every((block) => block.position !== undefined) &&
          (input.finish === undefined || input.finish.position !== undefined)
        )
          return { ok: true as const, value: graph };
        const definitions = yield* readinessDefinitions;
        const resolved = canvasGraph(graph, definitions.agents, definitions.flows);
        return yield* Effect.tryPromise({
          try: async (): Promise<Result<FlowGraph>> => {
            const positions = await arrangeFlow(
              resolved,
              createFlowLayoutDimensions(resolved, AUTHORING_DIMENSIONS),
            );
            const blocks = graph.blocks.map((block) => {
              const position = positions.blocks.get(block.id);
              if (!position) throw new Error("Auto-arrange returned no position for a block.");
              return { ...block, position };
            });
            return {
              ok: true,
              value: {
                ...graph,
                flowInput: { ...graph.flowInput, position: positions.flowInput },
                ...(graph.finish && {
                  finish: { ...graph.finish, position: positions.finish ?? graph.finish.position },
                }),
                blocks,
              },
            };
          },
          catch: (cause) => cause,
        }).pipe(
          // Only the canvas-limit outcome is the caller's to fix; any other layout failure is a
          // defect and surfaces as an internal error rather than a misleading validation issue.
          Effect.catch((error) =>
            error instanceof FlowLayoutLimitError
              ? Effect.succeed(
                  failure("validation", error.message, [
                    {
                      code: "layout_failed",
                      path: "graph",
                      message: `${CANVAS_COORD_MESSAGE} Supply every position, or simplify the graph.`,
                    },
                  ]),
                )
              : Effect.die(error),
          ),
        );
      });
    /**
     * Refuses a new or changed owning Project unless it is global or a Factory Project available
     * for new Runs, so a definition never moves where it could not start. Called inside the
     * committing transaction.
     */
    const ownerRefusal = (projectId: OwningProject) =>
      Effect.gen(function* () {
        if (projectId === null) return undefined;
        const catalog = yield* projects.readCatalog();
        const project = catalog.ok
          ? catalog.value.projects.find((candidate) => candidate.id === projectId)
          : undefined;
        if (project?.availability === "available") return undefined;
        const issue = projectUnavailableIssue(project, "projectId");
        return failure("validation", issue.message, [issue]);
      });
    /**
     * Refuses Project overrides on a Project Agent, and a newly added override whose Project is not
     * available for new Runs; one `kept` from the saved revision stays while its Project is unavailable.
     */
    const overridesRefusal = (
      owner: OwningProject,
      input: Pick<AgentDefinition, "execution" | "projectOverrides">,
      capabilities: AgentCapabilities,
      kept: readonly AgentProjectOverride[] = [],
    ) =>
      Effect.gen(function* () {
        if (!input.projectOverrides.length) return undefined;
        if (owner !== null)
          return failure(
            "validation",
            "Only a global Agent has Project overrides; a Project Agent's own settings already apply to its Project.",
            [
              {
                code: "override_global_only",
                path: "projectOverrides",
                message: "Remove the Project overrides of this Project Agent.",
              },
            ],
          );
        for (const [index, override] of input.projectOverrides.entries()) {
          const unsupported = unsupportedReportingFailure(override.execution, capabilities);
          if (unsupported) return underOverride(unsupported, index);
          if (kept.some((saved) => saved.projectId === override.projectId)) continue;
          const refused = yield* ownerRefusal(override.projectId);
          if (refused) return underOverride(refused, index);
        }
        return undefined;
      });
    const placementRefusal = (graph: FlowGraphInput, flowProject: OwningProject) =>
      Effect.gen(function* () {
        const { agents, flows } = yield* readinessDefinitions;
        const issues = placementIssues(graph, agents, flows, flowProject);
        if (!issues.length) return undefined;
        return failure(
          "validation",
          issues[0]!.code === "flow_scope_mismatch"
            ? "This Flow places a Flow it may not use. Place a global Flow or a Flow of this Flow's owning Project."
            : "This Flow places an Agent it may not use. Place a global Agent or an Agent of the Flow's owning Project.",
          issues,
        );
      });
    const draftRoot = (flow: CurrentFlow, draft: UpdateFlowInput): ReadinessFlow => ({
      ...flow,
      name: draft.name,
      graph: draft.graph,
      workspace: draft.workspace ?? flow.workspace,
    });
    const currentFlowsById = readCurrentFlows(sql).pipe(
      Effect.map((flows) => new Map(flows.map((flow) => [flow.id, flow]))),
    );
    const ownerBlockers = (flow: CurrentFlow, projectId: OwningProject) =>
      Effect.gen(function* () {
        const flows = yield* currentFlowsById;
        const agents = placedAgents([flow], yield* readCurrentAgents(sql)).filter(
          (agent) => !mayPlaceAgent(projectId, agent.projectId),
        );
        const children = [
          ...new Set(
            flow.graph.blocks.flatMap((block) =>
              block.kind === "subflow" && block.flowId !== null && block.flowId !== flow.id
                ? [block.flowId]
                : [],
            ),
          ),
        ].flatMap((childId) => {
          const child = flows.get(childId);
          return child && !mayPlaceFlow(projectId, child.projectId) ? [child] : [];
        });
        const parents = (yield* currentFlowsPlacingFlow(sql, flow.id)).filter(
          (parent) => !mayPlaceFlow(parent.project_id, projectId),
        );
        return [
          ...agents.map((agent) => ({
            code: "owner_change_blocked",
            path: "projectId",
            message: `This Flow places Agent "${agent.name}" (${agent.id}), which the new owner may not place.`,
          })),
          ...children.map((child) => ({
            code: "owner_change_blocked",
            path: "projectId",
            message: `This Flow places Flow "${child.name}" (${child.id}), which the new owner may not place.`,
          })),
          ...parents.map((parent) => ({
            code: "owner_change_blocked",
            path: "projectId",
            message: `Flow "${parent.name}" (${parent.id}) places this Flow and may not place it under the new owner.`,
          })),
        ];
      });
    /** The saved Flow a save may replace, or the refusal that stops the save. */
    const savedFlowFor = (
      id: string,
      expected: { readonly revision: number; readonly projectId: OwningProject },
    ) =>
      Effect.gen(function* () {
        const [saved] = yield* readCurrentFlows(sql, id);
        if (!saved) return flowNotFound();
        if (saved.revision !== expected.revision) return staleRevision("Flow");
        if (saved.projectId !== expected.projectId) return staleOwner("Flow");
        return { ok: true as const, value: saved };
      });
    const loadCapabilities = Effect.fn("Definitions.loadCapabilities")(function* () {
      const status = yield* connection.getConnection();
      if (!status.ok || status.value.state !== "ready" || !status.value.endpoint) {
        return emptyCapabilities(
          status.ok
            ? status.value.explanation
            : "Connect to T3 before loading provider and model options.",
          yield* currentTime,
        );
      }
      const endpoint = status.value.endpoint;
      return yield* Effect.gen(function* () {
        const environment = yield* Effect.tryPromise(() => t3.readEnvironment({ endpoint }));
        const providers = yield* Effect.tryPromise(() => t3.orchestratorCapabilities({ endpoint }));
        const vibe = providers.some(({ driverKind }) => driverKind === "acpRegistry")
          ? yield* readVibeReportingInstances(t3StateDirectory, status.value)
          : undefined;
        return readyCapabilities([environment], providers, yield* currentTime, vibe);
      }).pipe(
        Effect.catch(() =>
          currentTime.pipe(
            Effect.map((time) =>
              emptyCapabilities(
                "T3 capabilities are unavailable right now. Your saved settings are kept.",
                time,
              ),
            ),
          ),
        ),
      );
    });
    /** Runs `operation` on the current revision of Agent `id`, refusing a missing Agent. */
    const withSavedAgent = <A>(
      id: string,
      operation: (agent: AgentDefinition) => Effect.Effect<Result<A>, unknown, SqlClient.SqlClient>,
    ) =>
      Effect.gen(function* () {
        const [agent] = yield* readCurrentAgents(sql, id);
        if (!agent) return failure("not_found", "This Agent does not exist.");
        return yield* operation(agent);
      });
    const readCreateOutcome = (id: string, deadline: number | undefined) =>
      transaction<AgentCreateOutcome | { status: "pending"; remaining: number }>(
        Effect.gen(function* () {
          const [identity] = yield* sql<{ removed_at: string | null }>`
            SELECT removed_at FROM agents WHERE id = ${id}`;
          if (identity?.removed_at) return { ok: true, value: { status: "removed" } };
          if (identity)
            return yield* withSavedAgent(id, (agent) =>
              Effect.succeed({ ok: true, value: { status: "created" as const, agent } }),
            );
          const remaining = deadline === undefined ? 0 : deadline - (yield* createClockMillis);
          return {
            ok: true,
            value: remaining > 0 ? { status: "pending", remaining } : { status: "absent" },
          };
        }),
      );
    /** Runs `operation` on the current revision of Flow `id`, refusing a missing Flow. */
    const withSavedFlow = <A>(
      id: string,
      operation: (flow: CurrentFlow) => Effect.Effect<Result<A>, unknown, SqlClient.SqlClient>,
    ) =>
      Effect.gen(function* () {
        const [flow] = yield* readCurrentFlows(sql, id);
        if (!flow) return flowNotFound();
        return yield* operation(flow);
      });
    /**
     * Creates a new Agent at revision 1 from `source`'s latest saved revision, owned by `projectId`.
     * A copy into a Project takes the settings `source` uses there and no overrides, because only a
     * global Agent has them.
     */
    const insertAgentCopy = Effect.fnUntraced(function* (
      source: AgentDefinition,
      projectId: OwningProject,
      name: string,
      now: string,
    ) {
      const copy: AgentDefinition = {
        ...source,
        ...(projectId === null
          ? {}
          : { execution: executionForProject(source, projectId), projectOverrides: [] }),
        id: yield* newId,
        projectId,
        name,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      yield* sql`INSERT INTO agents (id, created_at, project_id) VALUES (${copy.id}, ${now}, ${projectId})`;
      yield* appendAgentRevision(sql, copy);
      return copy;
    });
    const importFlow = Effect.fnUntraced(function* (
      id: string,
      flow: PortableFlow,
      agentIds: ReadonlyMap<string, string>,
      flowIds: ReadonlyMap<string, string>,
      projectId: OwningProject,
      now: string,
    ) {
      const blocks = bindPortableBlocks(
        flow.graph.blocks,
        (key) => agentIds.get(key)!,
        (key) => flowIds.get(key)!,
      );
      yield* sql`INSERT INTO flows (id, created_at, project_id) VALUES (${id}, ${now}, ${projectId})`;
      yield* appendFlowRevision(sql, {
        id,
        revision: 1,
        name: flow.name,
        graph: { ...flow.graph, blocks },
        workspace: flow.workspace,
        savedAt: now,
      });
    });
    const insertImportedDefinitions = Effect.fnUntraced(function* (
      commit: CommitImportInput,
      projectId: OwningProject,
      now: string,
    ) {
      const document = commit.document;
      const agents = yield* Effect.forEach(document.agents, (entry) =>
        newId.pipe(Effect.map((id) => ({ key: entry.key, id }))),
      );
      const flowEntries = document.kind === "flow" && "flows" in document ? document.flows : [];
      const flows = yield* Effect.forEach(flowEntries, (entry) =>
        newId.pipe(Effect.map((id) => ({ key: entry.key, id }))),
      );
      const legacyFlowId = document.kind === "flow" && !("flows" in document) ? yield* newId : null;
      const agentIds = new Map(agents.map(({ key, id }) => [key, id]));
      const flowIds = new Map(flows.map(({ key, id }) => [key, id]));
      for (const entry of document.agents) {
        const id = agentIds.get(entry.key)!;
        yield* sql`INSERT INTO agents (id, created_at, project_id) VALUES (${id}, ${now}, ${projectId})`;
        yield* appendAgentRevision(sql, {
          id,
          name: entry.name,
          prompt: entry.prompt,
          execution: commit.selections[entry.key] ?? null,
          exits: entry.exits,
          projectOverrides: [],
          revision: 1,
          updatedAt: now,
        });
      }
      let flowId = legacyFlowId;
      if (document.kind === "flow") {
        if ("flows" in document) {
          for (const entry of document.flows)
            yield* importFlow(flowIds.get(entry.key)!, entry, agentIds, flowIds, projectId, now);
          flowId = flowIds.get(document.rootFlowKey)!;
        } else {
          yield* importFlow(legacyFlowId!, document.flow, agentIds, flowIds, projectId, now);
        }
      }
      return { agents, flowId, ...(flows.length ? { flows } : {}) };
    });
    const saveFlowDraft = Effect.fnUntraced(function* (flow: CurrentFlow) {
      yield* appendFlowRevision(sql, { ...flow, savedAt: flow.updatedAt });
      return { ok: true as const, value: toDraft(flow, yield* readinessDefinitions) };
    });
    const recordSuccess =
      <A>(record: (value: A) => Effect.Effect<void>) =>
      <E, R>(operation: Effect.Effect<Result<A>, E, R>) =>
        operation.pipe(Effect.tap((result) => (result.ok ? record(result.value) : Effect.void)));
    const recordFlow = (
      event: "flow.created" | "flow.saved" | "flow.duplicated" | "flow.removed",
      { projectId, graph }: Pick<FlowDraft, "projectId" | "graph">,
    ) =>
      telemetry.record(event, {
        scope: projectId === null ? "global" : "project",
        blockCount: telemetryCount(graph.blocks.length + 1),
        blockTypes: [
          ...new Set([...graph.blocks.map((block) => block.kind), "finish" as const]),
        ].sort(),
        usesSubflows: graph.blocks.some((block) => block.kind === "subflow"),
      });
    const recordAgent = (
      event: "agent.created" | "agent.saved" | "agent.removed",
      agent: AgentDefinition,
      capabilities?: AgentCapabilities,
    ) => {
      const driverKind = telemetryBuiltInDriver(
        capabilities?.environments.some(
          ({ environmentId }) => environmentId === agent.execution?.environmentId,
        )
          ? capabilities.providers.find(
              (provider) => provider.providerInstanceId === agent.execution?.providerInstanceId,
            )?.driverKind
          : undefined,
      );
      return telemetry.record(event, {
        scope: agent.projectId === null ? "global" : "project",
        ...(driverKind === undefined ? {} : { driverKind }),
        hasProjectOverrides: agent.projectOverrides.length > 0,
      });
    };
    const recordOwner = (kind: "flow" | "agent", expected: OwningProject, target: OwningProject) =>
      expected === target
        ? Effect.void
        : telemetry.record("owner.changed", {
            kind,
            direction: target === null ? "to_global" : "to_project",
          });
    const operations: DefinitionOperations = {
      createFlow(input) {
        const validated = validateCreateFlow(input);
        if (!validated.ok) return Effect.succeed(validated);
        return provideSql<FlowDraft>(
          Effect.gen(function* () {
            const positioned = yield* positionGraph(
              validated.value.graph ?? {
                blocks: [],
                connections: [],
                flowInput: { position: NEW_FLOW_INPUT_POSITION, targetBlockIds: [] },
              },
            );
            if (!positioned.ok) return positioned;
            const projectId = validated.value.projectId ?? null;
            return yield* sql.withTransaction(
              Effect.gen(function* () {
                const refused =
                  (yield* ownerRefusal(projectId)) ??
                  (yield* placementRefusal(positioned.value, projectId));
                if (refused) return refused;
                const id = yield* newId;
                const now = yield* currentTime;
                const flow: CurrentFlow = {
                  id,
                  projectId,
                  name: validated.value.name,
                  revision: 1,
                  graph: positioned.value,
                  workspace: validated.value.workspace ?? {
                    mode: "worktree",
                    base: { kind: "default" },
                  },
                  createdAt: now,
                  updatedAt: now,
                };
                yield* sql`INSERT INTO flows (id, created_at, project_id) VALUES (${id}, ${now}, ${projectId})`;
                return yield* saveFlowDraft(flow);
              }),
            );
          }),
        ).pipe(recordSuccess((flow) => recordFlow("flow.created", flow)));
      },
      validateFlow(id, input) {
        const validated = validateUpdateFlow(input);
        if (!validated.ok) return Effect.succeed(validated);
        return transaction(
          withSavedFlow<FlowValidation>(id, (flow) =>
            Effect.gen(function* () {
              // Readiness depends on the owner, so an answer judged under another one is stale.
              if (flow.projectId !== validated.value.expectedProjectId) return staleOwner("Flow");
              const { graph } = validated.value;
              const sizeRefusal = flowEditSizeRefusal(graph, flow.graph);
              if (sizeRefusal) return sizeRefusal;
              const definitions = yield* readinessDefinitions;
              return {
                ok: true as const,
                value: {
                  ...compositionReadiness(draftRoot(flow, validated.value), definitions).readiness,
                  agentRevisions: flowAgentRevisions(graph, definitions.agents),
                },
              };
            }),
          ),
        );
      },
      updateFlow(id, input) {
        const validated = validateUpdateFlow(input);
        if (!validated.ok) return Effect.succeed(validated);
        return provideSql<FlowDraft>(
          Effect.gen(function* () {
            const expected = {
              revision: validated.value.expectedRevision,
              projectId: validated.value.expectedProjectId,
            };
            // Refuse a missing or stale Flow before any layout, so the refusal names the real cause.
            const current = yield* savedFlowFor(id, expected);
            if (!current.ok) return current;
            const sizeRefusal = flowEditSizeRefusal(validated.value.graph, current.value.graph);
            if (sizeRefusal) return sizeRefusal;
            const positioned = yield* positionGraph(validated.value.graph);
            if (!positioned.ok) return positioned;
            return yield* sql.withTransaction(
              Effect.gen(function* () {
                // Checked again: another save may have landed while the graph was arranged.
                const latest = yield* savedFlowFor(id, expected);
                if (!latest.ok) return latest;
                const saved = latest.value;
                const refused = yield* placementRefusal(positioned.value, saved.projectId);
                if (refused) return refused;
                const now = yield* currentTime;
                const flow: CurrentFlow = {
                  ...saved,
                  name: validated.value.name,
                  revision: saved.revision + 1,
                  graph: positioned.value,
                  workspace: validated.value.workspace ?? saved.workspace,
                  updatedAt: now,
                };
                return yield* saveFlowDraft(flow);
              }),
            );
          }),
        ).pipe(recordSuccess((flow) => recordFlow("flow.saved", flow)));
      },
      changeFlowOwner(id, input) {
        const validated = validateChangeOwner(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { expectedProjectId, projectId } = validated.value;
        return transaction<FlowDraft>(
          Effect.gen(function* () {
            const [flow] = yield* readCurrentFlows(sql, id);
            if (!flow) return flowNotFound();
            if (flow.projectId !== expectedProjectId) return staleOwner("Flow");
            if (projectId === flow.projectId)
              return { ok: true as const, value: toDraft(flow, yield* readinessDefinitions) };
            const refused = yield* ownerRefusal(projectId);
            if (refused) return refused;
            const blockers = yield* ownerBlockers(flow, projectId);
            if (blockers.length)
              return failure(
                "conflict",
                "This Flow places, or is placed by, definitions its new owner may not share. Change those definitions, or Duplicate it into the target instead.",
                blockers,
              );
            // Strictly later, so a move away and back between two live reads still differs.
            const updatedAt = yield* nowAfter(flow.updatedAt);
            yield* sql`UPDATE flows SET project_id=${projectId}, owner_changed_at=${updatedAt} WHERE id=${id}`;
            return {
              ok: true as const,
              value: toDraft({ ...flow, projectId, updatedAt }, yield* readinessDefinitions),
            };
          }),
        ).pipe(recordSuccess(() => recordOwner("flow", expectedProjectId, projectId)));
      },
      removeFlow(id) {
        return transaction<CurrentFlow | undefined>(
          Effect.gen(function* () {
            const [flow] = yield* readCurrentFlows(sql, id);
            if (!flow) return { ok: true as const, value: undefined };
            const triggers = yield* sql<{
              id: string;
              name: string;
            }>`SELECT id, name FROM run_triggers WHERE flow_id=${id}`;
            if (triggers.length > 0)
              return failure(
                "conflict",
                `Can't remove "${flow.name}".`,
                triggers.map((trigger) => ({
                  code: "flow_in_use",
                  path: "flowId",
                  message: `Trigger "${trigger.name}" (${trigger.id}) starts this Flow.`,
                })),
              );
            yield* sql`UPDATE flows SET removed_at=${yield* currentTime} WHERE id=${id} AND removed_at IS NULL`;
            return { ok: true as const, value: flow };
          }),
        ).pipe(
          recordSuccess((flow) => (flow ? recordFlow("flow.removed", flow) : Effect.void)),
          Effect.map(clearRemovedValue),
        );
      },
      previewFlowDuplicate(id, input) {
        const validated = validatePreviewFlowDuplicate(input);
        if (!validated.ok) return Effect.succeed(validated);
        return transaction(
          withSavedFlow<FlowDuplicatePlan>(id, (flow) =>
            Effect.gen(function* () {
              const { projectId = flow.projectId } = validated.value;
              const plan = duplicatePlan(
                flow,
                projectId,
                yield* currentFlowsById,
                yield* readCurrentAgents(sql),
              );
              return {
                ok: true as const,
                value: {
                  flowId: flow.id,
                  revision: flow.revision,
                  projectId,
                  name: `${flow.name} copy`,
                  flows: plan.flows.slice(1).map((placed) => ({
                    flowId: placed.id,
                    name: placed.name,
                    projectId: placed.projectId,
                    revision: placed.revision,
                  })),
                  agents: plan.agents.map((agent) => ({
                    agentId: agent.id,
                    name: agent.name,
                    projectId: agent.projectId,
                    revision: agent.revision,
                    ...duplicateTreatment(projectId, agent.projectId),
                  })),
                },
              };
            }),
          ),
        );
      },
      duplicateFlow(id, input) {
        const validated = validateDuplicateFlow(input);
        if (!validated.ok) return Effect.succeed(validated);
        return transaction(
          withSavedFlow<FlowDuplicate>(id, (source) =>
            Effect.gen(function* () {
              const { projectId, expectedRevision } = validated.value;
              const refused = yield* ownerRefusal(projectId);
              if (refused) return refused;
              if (source.revision !== expectedRevision)
                return staleDuplicatePlan("expectedRevision");
              const plan = duplicatePlan(
                source,
                projectId,
                yield* currentFlowsById,
                yield* readCurrentAgents(sql),
              );
              if (!sameCopiedFlows(plan.flows.slice(1), validated.value.flows ?? []))
                return staleDuplicatePlan("flows");
              const copied = agentsToCopy(plan.agents, projectId, validated.value.agents);
              if (!copied.ok) return copied;
              const now = yield* currentTime;
              const flowIds = new Map<string, string>();
              for (const flow of plan.flows) flowIds.set(flow.id, yield* newId);
              const copies = yield* Effect.forEach(copied.value, (agent) =>
                insertAgentCopy(agent, projectId, agent.name, now).pipe(
                  Effect.map((copy) => ({ sourceAgentId: agent.id, agentId: copy.id })),
                ),
              );
              const agentIds = new Map(copies.map((copy) => [copy.sourceAgentId, copy.agentId]));
              const written = yield* Effect.forEach(plan.flows, (flow) =>
                Effect.gen(function* () {
                  const copy: CurrentFlow = {
                    id: flowIds.get(flow.id)!,
                    projectId,
                    name:
                      flow === source
                        ? (validated.value.name ?? `${source.name} copy`)
                        : `${flow.name} copy`,
                    revision: 1,
                    graph: {
                      ...flow.graph,
                      blocks: flow.graph.blocks.map((block) =>
                        copiedBlock(block, agentIds, flowIds),
                      ),
                    },
                    workspace: flow.workspace,
                    createdAt: now,
                    updatedAt: now,
                  };
                  yield* sql`INSERT INTO flows (id, created_at, project_id) VALUES (${copy.id}, ${now}, ${projectId})`;
                  yield* appendFlowRevision(sql, { ...copy, savedAt: now });
                  return copy;
                }),
              );
              return {
                ok: true as const,
                value: {
                  flow: toDraft(written[0]!, yield* readinessDefinitions),
                  copies,
                  flowCopies: plan.flows
                    .slice(1)
                    .map((flow) => ({ sourceFlowId: flow.id, flowId: flowIds.get(flow.id)! })),
                },
              };
            }),
          ),
        ).pipe(recordSuccess((duplicate) => recordFlow("flow.duplicated", duplicate.flow)));
      },
      listFlows() {
        return provideSql(
          Effect.gen(function* () {
            const definitions = yield* readinessDefinitions;
            const flows = [...definitions.flows.values()];
            return { ok: true as const, value: flows.map((flow) => toDraft(flow, definitions)) };
          }),
        );
      },
      getFlow(id) {
        return provideSql<FlowDraft>(
          withSavedFlow(id, (flow) =>
            Effect.gen(function* () {
              return { ok: true as const, value: toDraft(flow, yield* readinessDefinitions) };
            }),
          ),
        );
      },
      listFlowFindings(id, input) {
        const validated = validateListFlowFindings(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { cursor, draft } = validated.value;
        return transaction(
          withSavedFlow<FlowFindingsPage>(id, (flow) =>
            Effect.gen(function* () {
              if (draft && flow.projectId !== draft.expectedProjectId) return staleOwner("Flow");
              const root = draft ? draftRoot(flow, draft) : flow;
              const composition = compositionReadiness(root, yield* readinessDefinitions);
              const page = findingsPage(composition, cursor, FINDINGS_PAGE_SIZE);
              if (page) return { ok: true as const, value: page };
              return failure(
                "conflict",
                "This Flow's readiness changed since these findings were listed. Check the Flow again.",
                [
                  {
                    code: "stale_findings_cursor",
                    path: "cursor",
                    message: "Read the Flow's readiness again and page from its new cursor.",
                  },
                ],
              );
            }),
          ),
        );
      },
      getAgentCapabilities: () =>
        loadCapabilities().pipe(Effect.map((value) => ({ ok: true as const, value }))),
      listAgents: () =>
        transaction(
          readCurrentAgents(sql).pipe(
            Effect.map((agents) => ({ ok: true as const, value: agents })),
          ),
        ),
      getAgent: (id) =>
        transaction(
          withSavedAgent(id, (agent) => Effect.succeed({ ok: true as const, value: agent })),
        ),
      reserveAgentCreate() {
        return Effect.gen(function* () {
          const deadline = (yield* createClockMillis) + AGENT_CREATE_WINDOW_MS;
          const payload = `${randomUUID()}.${deadline}`;
          return { ok: true as const, value: `${payload}.${signCreate(payload)}` };
        });
      },
      getAgentCreateOutcome(id) {
        const deadline = createDeadline(id);
        return Effect.gen(function* () {
          const first = yield* readCreateOutcome(id, deadline);
          if (!first.ok) return first;
          if (first.value.status !== "pending") return { ok: true as const, value: first.value };
          if (first.value.remaining <= AGENT_CREATE_WINDOW_MS) {
            yield* Effect.sleep(first.value.remaining);
            const checked = yield* readCreateOutcome(id, deadline);
            if (!checked.ok) return checked;
            if (checked.value.status !== "pending")
              return { ok: true as const, value: checked.value };
          }
          return { ok: true as const, value: { status: "unconfirmed" as const } };
        });
      },
      createAgent(input) {
        const validated = validateCreateAgent(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { requestId } = validated.value;
        const deadline = requestId === undefined ? undefined : createDeadline(requestId);
        if (requestId !== undefined && deadline === undefined)
          return Effect.succeed(
            failure("conflict", "This Agent Create reservation is no longer valid."),
          );
        return Effect.gen(function* () {
          const capabilities = yield* loadCapabilities();
          return yield* transaction<AgentDefinition>(
            Effect.gen(function* () {
              const unsupported = unsupportedReportingFailure(
                validated.value.execution,
                capabilities,
              );
              if (unsupported) return unsupported;
              const projectId = validated.value.projectId ?? null;
              const agentInput = {
                execution: validated.value.execution,
                projectOverrides: validated.value.projectOverrides ?? [],
              };
              const refused =
                (yield* ownerRefusal(projectId)) ??
                (yield* overridesRefusal(projectId, agentInput, capabilities));
              if (refused) return refused;
              if (deadline !== undefined) {
                const remaining = deadline - (yield* createClockMillis);
                if (remaining <= 0)
                  return failure(
                    "conflict",
                    "The Agent Create request expired. Try creating again.",
                  );
                const [used] = yield* sql`SELECT id FROM agents WHERE id = ${requestId}`;
                if (used)
                  return failure("conflict", "Factory already used this Agent Create request.");
              }
              const now = yield* currentTime;
              const agent: AgentDefinition = {
                id: requestId ?? (yield* newId),
                projectId,
                name: validated.value.name,
                prompt: validated.value.prompt,
                execution: validated.value.execution,
                exits: validated.value.exits,
                projectOverrides: agentInput.projectOverrides,
                revision: 1,
                createdAt: now,
                updatedAt: now,
              };
              yield* sql`INSERT INTO agents (id, created_at, project_id) VALUES (${agent.id}, ${now}, ${projectId})`;
              yield* appendAgentRevision(sql, agent);
              return { ok: true as const, value: agent };
            }),
          ).pipe(recordSuccess((agent) => recordAgent("agent.created", agent, capabilities)));
        });
      },
      updateAgent(id, input) {
        const validated = validateUpdateAgent(input);
        if (!validated.ok) return Effect.succeed(validated);
        return Effect.gen(function* () {
          const capabilities = yield* loadCapabilities();
          return yield* transaction(
            withSavedAgent<AgentDefinition>(id, (saved) =>
              Effect.gen(function* () {
                if (saved.revision !== validated.value.expectedRevision)
                  return staleRevision("Agent");
                if (saved.projectId !== validated.value.expectedProjectId)
                  return staleOwner("Agent");
                const unsupported = unsupportedReportingFailure(
                  validated.value.execution,
                  capabilities,
                );
                if (unsupported) return unsupported;
                const refused = yield* overridesRefusal(
                  saved.projectId,
                  validated.value,
                  capabilities,
                  saved.projectOverrides,
                );
                if (refused) return refused;
                const agent: AgentDefinition = {
                  ...saved,
                  name: validated.value.name,
                  prompt: validated.value.prompt,
                  execution: validated.value.execution,
                  exits: validated.value.exits,
                  projectOverrides: validated.value.projectOverrides,
                  revision: saved.revision + 1,
                  updatedAt: yield* currentTime,
                };
                yield* appendAgentRevision(sql, agent);
                return { ok: true as const, value: agent };
              }),
            ),
          ).pipe(recordSuccess((agent) => recordAgent("agent.saved", agent, capabilities)));
        });
      },
      changeAgentOwner(id, input) {
        const validated = validateChangeOwner(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { expectedProjectId, projectId } = validated.value;
        return transaction(
          withSavedAgent<AgentDefinition>(id, (agent) =>
            Effect.gen(function* () {
              if (agent.projectId !== expectedProjectId) return staleOwner("Agent");
              if (projectId === agent.projectId) return { ok: true as const, value: agent };
              const refused = yield* ownerRefusal(projectId);
              if (refused) return refused;
              if (projectId !== null && agent.projectOverrides.length)
                return failure(
                  "conflict",
                  "Only a global Agent has Project overrides. Save it without them first, or Duplicate it into the target instead.",
                  [
                    {
                      code: "owner_change_overrides",
                      path: "projectId",
                      message: `This Agent overrides its settings for ${agent.projectOverrides.length === 1 ? "1 Project" : `${agent.projectOverrides.length} Projects`}.`,
                    },
                  ],
                );
              const blockers = (yield* currentFlowsReferencingAgent(sql, id)).filter(
                (flow) => !mayPlaceAgent(flow.project_id, projectId),
              );
              if (blockers.length)
                return failure(
                  "conflict",
                  "Flows outside the new owner place this Agent. Remove it from those Flows, or Duplicate it into the target instead.",
                  blockers.map((flow) => ({
                    code: "owner_change_blocked",
                    path: "projectId",
                    message: `Flow "${flow.name}" (${flow.id}) places this Agent and may not place it under the new owner.`,
                  })),
                );
              // Strictly later, so a move away and back between two live reads still differs.
              const updatedAt = yield* nowAfter(agent.updatedAt);
              yield* sql`UPDATE agents SET project_id=${projectId}, owner_changed_at=${updatedAt} WHERE id=${id}`;
              return { ok: true as const, value: { ...agent, projectId, updatedAt } };
            }),
          ),
        ).pipe(recordSuccess(() => recordOwner("agent", expectedProjectId, projectId)));
      },
      duplicateAgent(id, input) {
        const validated = validateDuplicateAgent(input);
        if (!validated.ok) return Effect.succeed(validated);
        return transaction(
          withSavedAgent<AgentDefinition>(id, (saved) =>
            Effect.gen(function* () {
              const { projectId = saved.projectId } = validated.value;
              const refused = yield* ownerRefusal(projectId);
              if (refused) return refused;
              const copy = yield* insertAgentCopy(
                saved,
                projectId,
                validated.value.name ?? `${saved.name.trim()} copy`,
                yield* currentTime,
              );
              return { ok: true as const, value: copy };
            }),
          ),
        );
      },
      removeAgent(id) {
        return transaction<AgentDefinition | undefined>(
          Effect.gen(function* () {
            const [agent] = yield* readCurrentAgents(sql, id);
            if (!agent) return { ok: true as const, value: undefined };
            const flows = yield* currentFlowsReferencingAgent(sql, id);
            if (flows.length > 0)
              return failure(
                "conflict",
                "This Agent is used in saved Flows. Remove those references before deleting it.",
                flows.map((flow) => ({
                  code: "agent_in_use",
                  path: "agentId",
                  message: `Flow "${flow.name}" (${flow.id}) places this Agent.`,
                })),
              );
            yield* sql`UPDATE agents SET removed_at=${yield* currentTime} WHERE id=${id}`;
            return { ok: true as const, value: agent };
          }),
        ).pipe(
          recordSuccess((agent) =>
            agent && telemetry.enabled
              ? Effect.gen(function* () {
                  const capabilities = agent.execution
                    ? yield* loadCapabilities().pipe(
                        Effect.timeout("250 millis"),
                        Effect.orElseSucceed(() => undefined),
                      )
                    : undefined;
                  yield* recordAgent("agent.removed", agent, capabilities);
                }).pipe(telemetry.recordLater)
              : Effect.void,
          ),
          Effect.map(clearRemovedValue),
        );
      },
      exportAgent: (id) =>
        Effect.gen(function* () {
          const capabilities = yield* loadCapabilities();
          return yield* transaction(
            withSavedAgent(id, (agent) =>
              Effect.gen(function* () {
                return definitionExport(
                  {
                    format: PORTABLE_DOCUMENT_FORMAT,
                    formatVersion: PORTABLE_DOCUMENT_VERSION,
                    kind: "agent",
                    factoryVersion,
                    exportedAt: yield* currentTime,
                    agents: [portableAgent(agent, "agent-1", capabilities)],
                  },
                  [agent],
                );
              }),
            ),
          );
        }).pipe(recordSuccess(() => telemetry.record("definition.exported", { kind: "agent" }))),
      exportFlow: (id) =>
        Effect.gen(function* () {
          const capabilities = yield* loadCapabilities();
          return yield* transaction(
            Effect.gen(function* () {
              const current = yield* currentFlowsById;
              const root = current.get(id);
              if (!root) return flowNotFound();
              const seen = new Map([[id, root]]);
              const pending = [...root.graph.blocks].reverse();
              for (let block = pending.pop(); block; block = pending.pop()) {
                if (block.kind !== "subflow" || block.flowId === null || seen.has(block.flowId))
                  continue;
                const child = current.get(block.flowId);
                if (!child) continue;
                seen.set(child.id, child);
                pending.push(...[...child.graph.blocks].reverse());
              }
              const flows = [...seen.values()];
              const agents = placedAgents(flows, yield* readCurrentAgents(sql));
              const portable = portableComposition(flows, agents, capabilities);
              return definitionExport(
                {
                  format: PORTABLE_DOCUMENT_FORMAT,
                  formatVersion: PORTABLE_DOCUMENT_VERSION,
                  kind: "flow",
                  factoryVersion,
                  exportedAt: yield* currentTime,
                  ...portable,
                },
                agents,
              );
            }),
          );
        }).pipe(recordSuccess(() => telemetry.record("definition.exported", { kind: "flow" }))),
      reviewImport(file) {
        const document = parsePortableFile(file.data);
        if (!document.ok) return Effect.succeed(document);
        return loadCapabilities().pipe(
          Effect.map((capabilities) => ({
            ok: true as const,
            value: importReview(document.value, capabilities),
          })),
        );
      },
      commitImport(input) {
        const validated = validateCommitImport(input);
        if (!validated.ok) return Effect.succeed(validated);
        const commit = validated.value;
        // A receipt answers before the catalog and the target's availability are read, so a
        // replay depends on neither T3 nor the target Project.
        const replay = readImportReceipt(sql, commit.requestId).pipe(
          Effect.map((receipt) => receipt && replayedImport(receipt, commit)),
        );
        return provideSql<ImportResult>(
          Effect.gen(function* () {
            const replayed = yield* replay;
            if (replayed) return replayed;
            const capabilities = yield* loadCapabilities();
            let committed = false;
            const result = yield* sql.withTransaction(
              Effect.gen(function* () {
                // Checked again: a retry of the same request may have committed meanwhile.
                const raced = yield* replay;
                if (raced) return raced;
                const projectId = commit.projectId ?? null;
                const refused = yield* ownerRefusal(projectId);
                if (refused) return refused;
                const unsupported = unsupportedSelections(commit, capabilities);
                if (unsupported) return unsupported;
                const now = yield* currentTime;
                const result = yield* insertImportedDefinitions(commit, projectId, now);
                yield* writeImportReceipt(sql, commit, now, result);
                committed = true;
                return { ok: true as const, value: result };
              }),
            );
            if (committed)
              yield* telemetry.record("definition.imported", { kind: commit.document.kind });
            return result;
          }),
        );
      },
    };
    /** Both lists from one read transaction, so every Flow's readiness matches the Agents read with it. */
    const readStudio = (): Effect.Effect<Result<Omit<StudioDefinitions, "triggers">>, unknown> =>
      transaction(
        Effect.gen(function* () {
          const agents = yield* readCurrentAgents(sql);
          const flows = yield* readCurrentFlows(sql);
          const definitions = yield* readinessDefinitions;
          return {
            ok: true as const,
            value: {
              agents,
              flows: flows.map((flow) => toDraft(flow, definitions)),
            },
          };
        }),
      ).pipe(Effect.withSpan("Definitions.readStudio"));
    const instrument = (
      name: keyof DefinitionOperations,
      operation: (...args: never) => Effect.Effect<Result<unknown>, unknown>,
    ) => {
      const publishes = LIVE_PUBLISHING_OPERATIONS.has(name);
      return (...args: never) =>
        Effect.suspend(() => operation(...args)).pipe(
          (run) => (publishes ? publishOnSuccess(run) : run),
          Effect.withSpan(`Definitions.${name}`),
        );
    };
    // Each instrumented operation keeps its own signature; the entry-wise mapping loses the
    // per-key types, so the result is restored to the declared operations type.
    const instrumented = Object.fromEntries(
      (Object.keys(operations) as (keyof DefinitionOperations)[]).map((name) => [
        name,
        instrument(name, operations[name]),
      ]),
    ) as DefinitionOperations;
    return { readStudio, ...instrumented };
  });
