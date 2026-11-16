import {
  arrangeFlow,
  AUTHORING_DIMENSIONS,
  canvasGraph,
  createFlowLayoutDimensions,
  FlowLayoutLimitError,
} from "@t3-factory/flow-layout";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import {
  PORTABLE_DOCUMENT_FORMAT,
  PORTABLE_DOCUMENT_VERSION,
  type AgentDefinition,
  type FactoryOperations,
  type FlowBlock,
  type FlowDraft,
  type FlowDuplicate,
  type FlowDuplicateAgentChoice,
  type FlowDuplicatePlan,
  type FlowGraph,
  type FlowGraphInput,
  type FlowValidation,
  type ImportResult,
  type PortableFlow,
  type ProjectCatalog,
  type Result,
  type StudioDefinitions,
} from "@t3-factory/contracts";
import {
  CANVAS_COORD_MESSAGE,
  duplicateTreatment,
  flowAgentRevisions,
  flowReadiness,
  mayPlaceAgent,
  parsePortableFile,
  placementIssues,
  readinessAgent,
  type OwningProject,
  type ReadinessAgent,
  validateChangeOwner,
  validateCommitImport,
  validateCreateAgent,
  validateCreateFlow,
  validateDuplicateAgent,
  validateDuplicateFlow,
  validatePreviewFlowDuplicate,
  validateUpdateAgent,
  validateUpdateFlow,
} from "@t3-factory/domain-validation";
import { emptyCapabilities, readyCapabilities, unsupportedReportingFailure } from "./agents.ts";
import type { T3Adapter } from "./adapters/t3.ts";
import type { EffectOperations } from "./effect-operations.ts";
import type { LiveChanges } from "./live-changes.ts";
import { failure } from "./result.ts";
import { projectUnavailableIssue } from "./projects.ts";
import { now as currentTime } from "./time.ts";
import { newId } from "./ids.ts";
import {
  appendFlowRevision,
  currentFlowsReferencingAgent,
  readCurrentFlows,
  type CurrentFlow,
} from "./flow-revisions.ts";
import {
  appendAgentRevision,
  readCurrentAgents,
  readFormerExitNames,
  type AgentRevision,
} from "./agent-revisions.ts";
import {
  definitionExport,
  importReview,
  portableAgent,
  portableFlow,
  unsupportedSelections,
} from "./portable-definitions.ts";
import { readImportReceipt, replayedImport, writeImportReceipt } from "./import-receipts.ts";
/** A new Flow starts with its Flow input block at the top-left of the canvas. */
const NEW_FLOW_INPUT_POSITION = { x: 40, y: 50 };

const toDraft = (flow: CurrentFlow, agents: readonly ReadinessAgent[]): FlowDraft => ({
  ...flow,
  readiness: flowReadiness(flow.graph, agents, flow.projectId),
});
const flowNotFound = () => failure("not_found", "This Flow does not exist.");
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

const staleDuplicatePlan = (path: "expectedRevision" | "agents") =>
  failure(
    "conflict",
    "The Flow or an Agent it places changed after this Duplicate was previewed.",
    [{ code: "stale_duplicate_plan", path, message: "Preview the Duplicate again." }],
  );

/** The distinct saved Agents a Flow places, in the order its blocks first place them. */
function placedAgents(flow: CurrentFlow, agents: readonly AgentDefinition[]) {
  const current = new Map(agents.map((agent) => [agent.id, agent]));
  const placed = new Map<string, AgentDefinition>();
  for (const block of flow.graph.blocks) {
    const agent = block.kind === "agent" && block.agentId !== null && current.get(block.agentId);
    if (agent) placed.set(agent.id, agent);
  }
  return [...placed.values()];
}

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
  | "getAgentCapabilities"
  | "listAgents"
  | "getAgent"
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

export const makeDefinitions = (
  t3: T3Adapter,
  connection: Pick<EffectOperations<FactoryOperations>, "getConnection">,
  projects: { readCatalog(): Effect.Effect<Result<ProjectCatalog>, unknown> },
  changes: LiveChanges,
  /** Recorded in exported files for information only. */
  factoryVersion: string,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
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
    /** Flow readiness resolves blocks against the current saved Agents, their exits and models. */
    const readinessAgents = Effect.gen(function* () {
      const agents = yield* readCurrentAgents(sql);
      const formerExitNames = yield* readFormerExitNames(sql);
      return agents.map((agent): ReadinessAgent & Pick<AgentRevision, "revision"> => ({
        ...readinessAgent(agent, formerExitNames.get(agent.id) ?? new Map()),
        revision: agent.revision,
      }));
    });
    const positionGraph = (input: FlowGraphInput) =>
      Effect.gen(function* () {
        const graph: FlowGraph = {
          ...input,
          flowInput: { ...input.flowInput, position: input.flowInput.position ?? { x: 0, y: 0 } },
          blocks: input.blocks.map((block): FlowBlock => {
            const position = block.position ?? { x: 0, y: 0 };
            return block.kind === "agent"
              ? { ...block, position, revisitInstruction: block.revisitInstruction ?? "" }
              : { ...block, position };
          }),
        };
        if (
          input.flowInput.position !== undefined &&
          input.blocks.every((block) => block.position !== undefined)
        )
          return { ok: true as const, value: graph };
        const resolved = canvasGraph(graph, yield* readinessAgents);
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
    /** Refuses a Flow graph that places an Agent its owning Project may not place. */
    const placementRefusal = (graph: FlowGraphInput, flowProject: OwningProject) =>
      Effect.gen(function* () {
        const issues = placementIssues(graph, yield* readinessAgents, flowProject);
        if (!issues.length) return undefined;
        return failure(
          "validation",
          "This Flow places an Agent it may not use. Place a global Agent or an Agent of the Flow's owning Project.",
          issues,
        );
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
        return readyCapabilities([environment], providers, yield* currentTime);
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
    /** Creates a new Agent at revision 1 from `source`'s latest saved revision, owned by `projectId`. */
    const insertAgentCopy = Effect.fnUntraced(function* (
      source: AgentDefinition,
      projectId: OwningProject,
      name: string,
      now: string,
    ) {
      const copy: AgentDefinition = {
        ...source,
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
    /** Creates an imported Flow at revision 1 with its Agent keys replaced by the new Agents' ids;
     * block and exit ids, positions and the workspace arrive as exported. */
    const importFlow = Effect.fnUntraced(function* (
      flow: PortableFlow,
      agentIds: ReadonlyMap<string, string>,
      projectId: OwningProject,
      now: string,
    ) {
      const id = yield* newId;
      const blocks = flow.graph.blocks.map((block): FlowBlock => {
        if (block.kind !== "agent") return block;
        const { agentKey, ...rest } = block;
        return { ...rest, agentId: agentKey === null ? null : agentIds.get(agentKey)! };
      });
      yield* sql`INSERT INTO flows (id, created_at, project_id) VALUES (${id}, ${now}, ${projectId})`;
      yield* appendFlowRevision(sql, {
        id,
        revision: 1,
        name: flow.name,
        graph: { ...flow.graph, blocks },
        workspace: flow.workspace,
        savedAt: now,
      });
      return id;
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
                yield* appendFlowRevision(sql, { ...flow, savedAt: now });
                return { ok: true as const, value: toDraft(flow, yield* readinessAgents) };
              }),
            );
          }),
        );
      },
      validateFlow(id, input) {
        const validated = validateUpdateFlow(input);
        if (!validated.ok) return Effect.succeed(validated);
        return transaction(
          withSavedFlow<FlowValidation>(id, (flow) =>
            Effect.gen(function* () {
              // Readiness depends on the owner, so an answer judged under another one is stale.
              if (flow.projectId !== validated.value.expectedProjectId) return staleOwner("Flow");
              const agents = yield* readinessAgents;
              const { graph } = validated.value;
              return {
                ok: true as const,
                value: {
                  ...flowReadiness(graph, agents, flow.projectId),
                  agentRevisions: flowAgentRevisions(graph, agents),
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
                yield* appendFlowRevision(sql, { ...flow, savedAt: now });
                return { ok: true as const, value: toDraft(flow, yield* readinessAgents) };
              }),
            );
          }),
        );
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
            const agents = yield* readinessAgents;
            if (projectId === flow.projectId)
              return { ok: true as const, value: toDraft(flow, agents) };
            const refused = yield* ownerRefusal(projectId);
            if (refused) return refused;
            const blockers = placedAgents(flow, yield* readCurrentAgents(sql)).filter(
              (agent) => !mayPlaceAgent(projectId, agent.projectId),
            );
            if (blockers.length)
              return failure(
                "conflict",
                "This Flow places Agents its new owner may not place. Remove them from the Flow, or Duplicate it into the target instead.",
                blockers.map((agent) => ({
                  code: "owner_change_blocked",
                  path: "projectId",
                  message: `This Flow places Agent "${agent.name}" (${agent.id}), which the new owner may not place.`,
                })),
              );
            yield* sql`UPDATE flows SET project_id=${projectId} WHERE id=${id}`;
            return { ok: true as const, value: toDraft({ ...flow, projectId }, agents) };
          }),
        );
      },
      removeFlow(id) {
        return provideSql<void>(
          Effect.gen(function* () {
            yield* sql`UPDATE flows SET removed_at=${yield* currentTime} WHERE id=${id} AND removed_at IS NULL`;
            return { ok: true as const, value: undefined };
          }),
        );
      },
      previewFlowDuplicate(id, input) {
        const validated = validatePreviewFlowDuplicate(input);
        if (!validated.ok) return Effect.succeed(validated);
        return transaction(
          withSavedFlow<FlowDuplicatePlan>(id, (flow) =>
            Effect.gen(function* () {
              const { projectId = flow.projectId } = validated.value;
              const agents = placedAgents(flow, yield* readCurrentAgents(sql));
              return {
                ok: true as const,
                value: {
                  flowId: flow.id,
                  revision: flow.revision,
                  projectId,
                  name: `${flow.name} copy`,
                  agents: agents.map((agent) => ({
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
              const placed = placedAgents(source, yield* readCurrentAgents(sql));
              const copied = agentsToCopy(placed, projectId, validated.value.agents);
              if (!copied.ok) return copied;
              const now = yield* currentTime;
              const copies = yield* Effect.forEach(copied.value, (agent) =>
                insertAgentCopy(agent, projectId, agent.name, now).pipe(
                  Effect.map((copy) => ({ sourceAgentId: agent.id, agentId: copy.id })),
                ),
              );
              const copyIds = new Map(copies.map((copy) => [copy.sourceAgentId, copy.agentId]));
              const flow: CurrentFlow = {
                id: yield* newId,
                projectId,
                name: validated.value.name ?? `${source.name} copy`,
                revision: 1,
                graph: {
                  ...source.graph,
                  blocks: source.graph.blocks.map((block) => {
                    const copyId =
                      block.kind === "agent" && block.agentId !== null
                        ? copyIds.get(block.agentId)
                        : undefined;
                    return copyId ? { ...block, agentId: copyId } : block;
                  }),
                },
                workspace: source.workspace,
                createdAt: now,
                updatedAt: now,
              };
              yield* sql`INSERT INTO flows (id, created_at, project_id) VALUES (${flow.id}, ${now}, ${projectId})`;
              yield* appendFlowRevision(sql, { ...flow, savedAt: now });
              return {
                ok: true as const,
                value: { flow: toDraft(flow, yield* readinessAgents), copies },
              };
            }),
          ),
        );
      },
      listFlows() {
        return provideSql(
          Effect.gen(function* () {
            const flows = yield* readCurrentFlows(sql);
            const agents = yield* readinessAgents;
            return { ok: true as const, value: flows.map((flow) => toDraft(flow, agents)) };
          }),
        );
      },
      getFlow(id) {
        return provideSql<FlowDraft>(
          Effect.gen(function* () {
            const [flow] = yield* readCurrentFlows(sql, id);
            if (!flow) return flowNotFound();
            return { ok: true as const, value: toDraft(flow, yield* readinessAgents) };
          }),
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
      createAgent(input) {
        const validated = validateCreateAgent(input);
        if (!validated.ok) return Effect.succeed(validated);
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
              const refused = yield* ownerRefusal(projectId);
              if (refused) return refused;
              const now = yield* currentTime;
              const agent: AgentDefinition = {
                id: yield* newId,
                projectId,
                name: validated.value.name,
                prompt: validated.value.prompt,
                execution: validated.value.execution,
                exits: validated.value.exits,
                revision: 1,
                createdAt: now,
                updatedAt: now,
              };
              yield* sql`INSERT INTO agents (id, created_at, project_id) VALUES (${agent.id}, ${now}, ${projectId})`;
              yield* appendAgentRevision(sql, agent);
              return { ok: true as const, value: agent };
            }),
          );
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
                const agent: AgentDefinition = {
                  ...saved,
                  name: validated.value.name,
                  prompt: validated.value.prompt,
                  execution: validated.value.execution,
                  exits: validated.value.exits,
                  revision: saved.revision + 1,
                  updatedAt: yield* currentTime,
                };
                yield* appendAgentRevision(sql, agent);
                return { ok: true as const, value: agent };
              }),
            ),
          );
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
              yield* sql`UPDATE agents SET project_id=${projectId} WHERE id=${id}`;
              return { ok: true as const, value: { ...agent, projectId } };
            }),
          ),
        );
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
        return transaction<void>(
          Effect.gen(function* () {
            const [agent] = yield* sql<{
              id: string;
            }>`SELECT id FROM agents WHERE id=${id} AND removed_at IS NULL`;
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
            return { ok: true as const, value: undefined };
          }),
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
        }),
      exportFlow: (id) =>
        Effect.gen(function* () {
          const capabilities = yield* loadCapabilities();
          return yield* transaction(
            Effect.gen(function* () {
              const [flow] = yield* readCurrentFlows(sql, id);
              if (!flow) return flowNotFound();
              const portable = portableFlow(flow, yield* readCurrentAgents(sql), capabilities);
              return definitionExport(
                {
                  format: PORTABLE_DOCUMENT_FORMAT,
                  formatVersion: PORTABLE_DOCUMENT_VERSION,
                  kind: "flow",
                  factoryVersion,
                  exportedAt: yield* currentTime,
                  flow: portable.flow,
                  agents: portable.agents,
                },
                portable.revisions,
                flow,
              );
            }),
          );
        }),
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
            return yield* sql.withTransaction(
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
                const agents = yield* Effect.forEach(commit.document.agents, (entry) =>
                  Effect.gen(function* () {
                    const id = yield* newId;
                    yield* sql`INSERT INTO agents (id, created_at, project_id) VALUES (${id}, ${now}, ${projectId})`;
                    yield* appendAgentRevision(sql, {
                      id,
                      name: entry.name,
                      prompt: entry.prompt,
                      execution: commit.selections[entry.key] ?? null,
                      exits: entry.exits,
                      revision: 1,
                      updatedAt: now,
                    });
                    return { key: entry.key, id };
                  }),
                );
                const document = commit.document;
                const flowId =
                  document.kind === "flow"
                    ? yield* importFlow(
                        document.flow,
                        new Map(agents.map((a) => [a.key, a.id])),
                        projectId,
                        now,
                      )
                    : null;
                const result: ImportResult = { agents, flowId };
                yield* writeImportReceipt(sql, commit, now, result);
                return { ok: true as const, value: result };
              }),
            );
          }),
        );
      },
    };
    /** Both lists from one read transaction, so every Flow's readiness matches the Agents read with it. */
    const readStudio = (): Effect.Effect<Result<StudioDefinitions>, unknown> =>
      transaction(
        Effect.gen(function* () {
          const agents = yield* readCurrentAgents(sql);
          const flows = yield* readCurrentFlows(sql);
          const readiness = yield* readinessAgents;
          return {
            ok: true as const,
            value: {
              agents,
              flows: flows.map((flow) => toDraft(flow, readiness)),
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
