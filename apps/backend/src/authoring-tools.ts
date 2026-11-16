import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import type {
  AgentDefinition,
  AgentExecutionSettingsStatus,
  FactoryOperations,
  Result,
} from "@t3-factory/contracts";
import { CANVAS_COORD_MAX, CANVAS_COORD_MIN } from "@t3-factory/domain-validation";
import { agentSettingsStatus } from "./agents.ts";

/** The definition operations Studio's API uses; authoring tools call nothing else. */
export type AuthoringOperations = Pick<
  FactoryOperations,
  | "getAgentCapabilities"
  | "listAgents"
  | "getAgent"
  | "createAgent"
  | "updateAgent"
  | "removeAgent"
  | "changeAgentOwner"
  | "duplicateAgent"
  | "listFlows"
  | "getFlow"
  | "createFlow"
  | "updateFlow"
  | "removeFlow"
  | "changeFlowOwner"
  | "previewFlowDuplicate"
  | "duplicateFlow"
>;

const noArguments: Tool["inputSchema"] = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
const agentId = { type: "string", description: "An Agent id from factory_list_agents." };
const flowId = { type: "string", description: "A Flow id from factory_list_flows." };
const expectedRevision = {
  type: "integer",
  minimum: 1,
  description:
    "The revision you last read. A save on an older revision is refused with a conflict.",
};
const expectedProjectId = {
  type: ["string", "null"],
  description:
    "The projectId you last read: the owning Project's id, or null for a global definition. A save after the owner changed is refused with a conflict; a save never changes the owner.",
};
const projectId = {
  type: ["string", "null"],
  description:
    "The owning Project: a Project id from factory_list_projects, or null (the default) for a global definition. A global Flow places only global Agents; a Project Flow places global Agents and its own Project's Agents.",
};
/** The arguments of a Change owner tool for the definition `key` names. */
const changeOwnerSchema = (key: "agentId" | "flowId"): Tool["inputSchema"] => ({
  type: "object",
  properties: {
    [key]: key === "agentId" ? agentId : flowId,
    expectedProjectId: {
      type: ["string", "null"],
      description:
        "The projectId you last read: the current owning Project's id, or null for a global definition. A change after the owner changed elsewhere is refused with a conflict.",
    },
    projectId: {
      type: ["string", "null"],
      description:
        "The new owning Project: a Project id from factory_list_projects whose availability is available, or null for global.",
    },
  },
  required: [key, "expectedProjectId", "projectId"],
  additionalProperties: false,
});
const duplicateTarget = {
  type: ["string", "null"],
  description:
    "The copy's owning Project: a Project id from factory_list_projects whose availability is available, or null for global. Omit it to keep the source's owning Project, which must then be available.",
};
const listFilter = (kind: "Agents" | "Flows"): Tool["inputSchema"] => ({
  type: "object",
  properties: {
    projectId: {
      type: "string",
      description: `A Project id from factory_list_projects: list only global ${kind} and the ${kind} that Project owns. Omit it to list every ${kind.slice(0, -1)}.`,
    },
  },
  additionalProperties: false,
});
const exit = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    messageRequired: { type: "boolean" },
  },
  required: ["id", "name", "description", "messageRequired"],
};
const agentFields = {
  name: { type: "string" },
  prompt: { type: "string" },
  execution: {
    type: ["object", "null"],
    description:
      "Required. Ids from factory_get_agent_capabilities: environment, provider instance (one with reporting.supported), model and model option values (an empty list when choosing none); or null for an Agent without a model, which saves but cannot run until a save gives it one.",
    properties: {
      environmentId: { type: "string" },
      providerInstanceId: { type: "string" },
      modelId: { type: "string" },
      modelOptions: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, value: { type: ["string", "boolean"] } },
          required: ["id", "value"],
        },
      },
    },
    required: ["environmentId", "providerInstanceId", "modelId", "modelOptions"],
  },
  exits: { type: "array", items: exit, description: "The Agent's exits; at least one." },
};
const position = {
  type: "object",
  properties: {
    x: { type: "number", minimum: CANVAS_COORD_MIN, maximum: CANVAS_COORD_MAX },
    y: { type: "number", minimum: CANVAS_COORD_MIN, maximum: CANVAS_COORD_MAX },
  },
  required: ["x", "y"],
};
const flowFields = {
  name: { type: "string" },
  graph: {
    type: "object",
    description:
      'The whole Flow graph; a save replaces the saved one. Positions are optional: if any Block or Flow input position is omitted, the server auto-arranges the whole graph; fully positioned graphs are kept as given. Agent blocks {id, kind: agent, name, agentId, position, hiddenExitIds, localExits, revisitInstruction} (revisitInstruction is optional plain text up to 120,000 characters, stored trimmed and empty when omitted, that Factory sends on every visit to the block after the first; only Agent blocks have it), Human blocks {id, kind: human, name, position}, Wait blocks {id, kind: wait, name, position, duration: {amount: number, unit: minutes | hours | days} or null} (they hold each arrival for 1 minute to 7 days, judged after converting the unit, and leave by exitId "output"), Continuation blocks {id, kind: continuation, name, prompt, position} (they send their prompt once per Run into the worker thread of the message that reaches them; their single output has exitId "output"), Condition blocks {id, kind: condition, name, position, rules: [{id, name, fromArrival}], otherwise: {id: "otherwise"}} (they route each message that reaches them by its arrival number at the block within the Run, starting at 1: the first rule whose fromArrival the number reaches selects the output of that rule, which wires leave by its rule id, else the fixed last Otherwise output, exitId "otherwise"; fromArrival is a whole number of at least 1 or null in a draft; readiness requires distinct non-blank names, thresholds that strictly descend and are at least 2, and no loop through only Conditions and Continuations), connections {sourceBlockId, exitId, targetBlockId}, and flowInput {position, targetBlockIds} (Agent blocks only).',
    properties: {
      blocks: { type: "array", items: { type: "object" } },
      connections: { type: "array", items: { type: "object" } },
      flowInput: {
        type: "object",
        properties: { position, targetBlockIds: { type: "array", items: { type: "string" } } },
        required: ["targetBlockIds"],
      },
    },
    required: ["blocks", "connections", "flowInput"],
  },
  workspace: {
    type: "object",
    description:
      'Optional: {mode: "checkout"} or {mode: "worktree", base: {kind: "default"} | {kind: "ref", ref}}. Omitted keeps the saved workspace, or defaults to a new worktree from the default branch on create.',
    oneOf: [
      {
        type: "object",
        properties: { mode: { const: "checkout" } },
        required: ["mode"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          mode: { const: "worktree" },
          base: {
            oneOf: [
              {
                type: "object",
                properties: { kind: { const: "default" } },
                required: ["kind"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: { kind: { const: "ref" }, ref: { type: "string", minLength: 1 } },
                required: ["kind", "ref"],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ["mode", "base"],
        additionalProperties: false,
      },
    ],
  },
};

/** Confirmation and disambiguation guidance for a removal tool; the server checks none of it. */
const removalGuidance = (kind: "Agent" | "Flow", details: string) =>
  `First get the user's explicit confirmation naming the ${kind}, unless the request gives its id or a name that matches exactly one current ${kind} in a fresh factory_list_${kind.toLowerCase()}s. If several match or the target is inferred, ask with each name, id and ${details}; never pick among duplicates. If none matches, say so and do not call this tool. This is guidance, not a server check: success, also for an absent or already removed id, does not prove the id existed.`;

/** Definition authoring for any session with the Factory MCP; no Block id. */
export const authoringTools: Tool[] = [
  {
    name: "factory_get_agent_capabilities",
    description:
      "Read the live T3 catalog of environments, providers and models with their options, and whether Factory can accept reports from each provider (reporting.supported). Choose Agent model settings from it.",
    inputSchema: noArguments,
  },
  {
    name: "factory_list_agents",
    description:
      "List the current Agents with their owning Project (projectId, null for a global Agent), revision and settings status.",
    inputSchema: listFilter("Agents"),
  },
  {
    name: "factory_get_agent",
    description:
      "Read one Agent's current revision, model settings, exits and settings status. An Agent without a model has execution and settingsStatus null.",
    inputSchema: {
      type: "object",
      properties: { agentId },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_create_agent",
    description:
      "Create an Agent as revision 1. Model settings are checked for shape and reporting support; availability is reported in settingsStatus.",
    inputSchema: {
      type: "object",
      properties: { ...agentFields, projectId },
      required: ["name", "prompt", "execution", "exits"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_save_agent",
    description:
      "Save an Agent's name, prompt, model settings and exits as its next immutable revision, exactly as a Studio save.",
    inputSchema: {
      type: "object",
      properties: { agentId, expectedRevision, expectedProjectId, ...agentFields },
      required: [
        "agentId",
        "expectedRevision",
        "expectedProjectId",
        "name",
        "prompt",
        "execution",
        "exits",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "factory_remove_agent",
    description: `Delete (remove) an Agent exactly as Studio's Delete: it leaves Studio, Flow references and Start selection with no restore, its saved revisions are kept and Runs keep the revisions they started with. Refused while the latest revision of a current Flow places it. ${removalGuidance("Agent", "its revision, last update and the Flows that place it")}`,
    inputSchema: {
      type: "object",
      properties: { agentId },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_change_agent_owner",
    description:
      "Change owner of an Agent exactly as Studio's Change owner: move it to another Project or make it global. It appends no revision and changes nothing else. Refused when a current Flow could no longer place the Agent afterwards; the issues name those Flows. Ask the user before calling it.",
    inputSchema: changeOwnerSchema("agentId"),
  },
  {
    name: "factory_duplicate_agent",
    description:
      "Duplicate an Agent exactly as Studio's Duplicate: a new Agent at revision 1 from the latest saved revision, owned by projectId. The source is unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        agentId,
        name: {
          type: "string",
          description: 'The copy\'s name; omitted, the source name with " copy".',
        },
        projectId: duplicateTarget,
      },
      required: ["agentId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_list_flows",
    description:
      "List the current Flows with their owning Project (projectId, null for a global Flow), revision, graph, workspace and readiness. A Project Flow starts only in its owning Project; a global Flow in any Project.",
    inputSchema: listFilter("Flows"),
  },
  {
    name: "factory_get_flow",
    description: "Read one Flow's current revision, graph, workspace and readiness.",
    inputSchema: {
      type: "object",
      properties: { flowId },
      required: ["flowId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_create_flow",
    description:
      "Create a Flow as revision 1 atomically, optionally with its whole graph and workspace. Omit positions to auto-arrange the whole graph. A name alone creates an empty Flow.",
    inputSchema: {
      type: "object",
      properties: { ...flowFields, projectId },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_save_flow",
    description:
      "Save a Flow's name, whole graph and workspace as its next immutable revision, exactly as a Studio save. If any position is omitted the server auto-arranges the whole graph; otherwise positions are kept. The reply includes readiness.",
    inputSchema: {
      type: "object",
      properties: { flowId, expectedRevision, expectedProjectId, ...flowFields },
      required: ["flowId", "expectedRevision", "expectedProjectId", "name", "graph"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_change_flow_owner",
    description:
      "Change owner of a Flow exactly as Studio's Change owner: move it to another Project or make it global. It appends no revision and changes nothing else. Refused when the Flow places Agents its new owner may not place; the issues name them. Ask the user before calling it.",
    inputSchema: changeOwnerSchema("flowId"),
  },
  {
    name: "factory_preview_flow_duplicate",
    description:
      "Preview a Flow Duplicate into projectId, writing nothing. The plan lists each distinct Agent the latest revision places with its default choice: keep places the same Agent, copy places a new Agent created in the target. Only Agents with changeable true may switch. Show the plan to the user, then commit it with factory_duplicate_flow.",
    inputSchema: {
      type: "object",
      properties: { flowId, projectId: duplicateTarget },
      required: ["flowId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_duplicate_flow",
    description:
      "Commit a previewed Flow Duplicate atomically: a new Flow at revision 1 owned by projectId, with each copied Agent created once in the target and the copy retargeted to it. The source Flow and its Agents never change. Refused as stale when the Flow or a planned Agent changed since the preview.",
    inputSchema: {
      type: "object",
      properties: {
        flowId,
        name: { type: "string", description: "The new Flow's name; omitted, the plan's name." },
        projectId: duplicateTarget,
        expectedRevision: {
          type: "integer",
          minimum: 1,
          description: "The plan's revision.",
        },
        agents: {
          type: "array",
          description:
            "Every Agent of the plan with agentId, revision and projectId as listed and the chosen choice (keep or copy).",
          items: {
            type: "object",
            properties: {
              agentId: { type: "string" },
              revision: { type: "integer" },
              projectId: { type: ["string", "null"] },
              choice: { enum: ["keep", "copy"] },
            },
            required: ["agentId", "revision", "projectId", "choice"],
          },
        },
      },
      required: ["flowId", "expectedRevision", "agents"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_check_flow",
    description:
      "Check readiness of a Flow's latest saved revision, as Studio's Check readiness does. Fix the listed issue paths before a Run is started.",
    inputSchema: {
      type: "object",
      properties: { flowId },
      required: ["flowId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_remove_flow",
    description: `Delete (remove) a Flow exactly as Studio's Remove: it leaves Studio and the Run composer with no restore, its saved revisions are kept and Runs, including active ones, are unaffected. ${removalGuidance("Flow", "its revision and last update")}`,
    inputSchema: {
      type: "object",
      properties: { flowId },
      required: ["flowId"],
      additionalProperties: false,
    },
  },
];

type Subject =
  | "agent"
  | "flow"
  | "agentRemoval"
  | "flowRemoval"
  | "agentOwner"
  | "flowOwner"
  | "duplicate";

const fixIssuesNext = "Fix the listed issue paths and call the tool again.";
const staleOwnerNext =
  "Nothing changed. Read the definition again with factory_get_flow or factory_get_agent, confirm its current projectId with the user and call the tool again with it as expectedProjectId.";
const ownerChangeBlockedNext =
  "Nothing changed. Ask the user whether to change the definitions the issues name, or to copy into the target with factory_preview_flow_duplicate and factory_duplicate_flow or factory_duplicate_agent instead; never rewrite definitions on your own.";
const agentNotFoundNext = "Find a current Agent id with factory_list_agents.";
const flowNotFoundNext = "Find a current Flow id with factory_list_flows.";
const placementNext =
  "A Flow places only global Agents and Agents of its own owning Project. Choose Agents from factory_list_agents with the Flow's projectId, then call the tool again.";

/**
 * Static recovery steps, keyed by an issue code, which wins, or by the error code; replies never
 * echo the call's arguments.
 */
const nextSteps: Record<Subject, Partial<Record<string, string>>> = {
  agent: {
    validation: fixIssuesNext,
    conflict:
      "Read the Agent with factory_get_agent, reapply your change and save with its revision.",
    not_found: agentNotFoundNext,
  },
  flow: {
    agent_scope_mismatch: placementNext,
    validation: fixIssuesNext,
    conflict:
      "Read the Flow with factory_get_flow, reapply your change and save with its revision.",
    not_found: flowNotFoundNext,
  },
  agentRemoval: {
    validation: fixIssuesNext,
    conflict:
      "Nothing was removed. Ask the user before editing or removing the Flows that place this Agent, unless they already authorized those exact changes; never rewrite Flows on your own.",
  },
  flowRemoval: { validation: fixIssuesNext },
  agentOwner: {
    stale_owner: staleOwnerNext,
    owner_change_blocked: ownerChangeBlockedNext,
    validation: fixIssuesNext,
    not_found: agentNotFoundNext,
  },
  flowOwner: {
    stale_owner: staleOwnerNext,
    owner_change_blocked: ownerChangeBlockedNext,
    validation: fixIssuesNext,
    not_found: flowNotFoundNext,
  },
  duplicate: {
    stale_duplicate_plan:
      "Nothing was created. Preview the Duplicate again with factory_preview_flow_duplicate, review the new plan with the user and commit it.",
    duplicate_choice_not_allowed:
      "Nothing was created. Keep the plan's choice for every Agent whose changeable is false, then call the tool again.",
    validation: fixIssuesNext,
    not_found: "Find a current id with factory_list_flows or factory_list_agents.",
  },
};
const unavailableNext = "Recheck the Factory backend, then call the tool again.";

type Call = (args: Record<string, unknown>) => Promise<Result<unknown>>;

/** Splits a required id argument from the operation's input; a missing id is a validation issue. */
const withId =
  (
    key: "agentId" | "flowId",
    operation: (id: string, input: unknown) => Promise<Result<unknown>>,
  ) =>
  ({ [key]: id, ...input }: Record<string, unknown>): Promise<Result<unknown>> =>
    typeof id === "string" && id.length > 0
      ? operation(id, input)
      : Promise.resolve({
          ok: false,
          error: {
            code: "validation",
            message: `Include ${key}.`,
            issues: [{ code: "invalid_id", path: key, message: `Include ${key}.` }],
          },
        });

/**
 * Global definitions and those `projectId` owns, or every definition without a filter. A filter
 * that is not a string is a validation issue.
 */
const ownedBy =
  <A extends { readonly projectId: string | null }>(list: () => Promise<Result<readonly A[]>>) =>
  async ({ projectId }: Record<string, unknown>): Promise<Result<readonly A[]>> => {
    if (projectId !== undefined && typeof projectId !== "string")
      return {
        ok: false,
        error: {
          code: "validation",
          message: "projectId must be a Project id.",
          issues: [{ code: "invalid_id", path: "projectId", message: "Send a Project id." }],
        },
      };
    const listed = await list();
    if (!listed.ok || projectId === undefined) return listed;
    return {
      ok: true,
      value: listed.value.filter(
        (definition) => definition.projectId === null || definition.projectId === projectId,
      ),
    };
  };

/** A removal reply names only the removed id; removing an absent or removed id succeeds too. */
const removal = (key: "agentId" | "flowId", remove: (id: string) => Promise<Result<void>>) =>
  withId(key, async (id) => {
    const removed = await remove(id);
    return removed.ok ? { ok: true, value: { [key]: id, removed: true } } : removed;
  });

/** An Agent in an authoring reply: its saved fields and the settings status the tool judged. */
type ReportedAgent = AgentDefinition & {
  readonly settingsStatus: AgentExecutionSettingsStatus | null;
};

/**
 * Judges settings status from a catalog loaded after the Agent operation succeeds; Agent operations
 * read SQL only. T3 being down yields an unavailable catalog.
 */
async function withSettingsStatus<A, B>(
  factory: AuthoringOperations,
  result: Result<A>,
  reply: (value: A, report: (agent: AgentDefinition) => ReportedAgent) => B,
): Promise<Result<B>> {
  if (!result.ok) return result;
  const capabilities = await factory.getAgentCapabilities();
  if (!capabilities.ok) return capabilities;
  const catalog = capabilities.value;
  const report = (agent: AgentDefinition): ReportedAgent => ({
    ...agent,
    settingsStatus: agent.execution ? agentSettingsStatus(agent.execution, catalog) : null,
  });
  return { ok: true, value: reply(result.value, report) };
}

const authoringCalls = (factory: AuthoringOperations): Record<string, [Subject, Call]> => ({
  factory_get_agent_capabilities: ["agent", () => factory.getAgentCapabilities()],
  factory_list_agents: [
    "agent",
    async (input) =>
      withSettingsStatus(
        factory,
        await ownedBy(() => factory.listAgents())(input),
        (agents, report) => agents.map(report),
      ),
  ],
  factory_get_agent: [
    "agent",
    withId("agentId", async (id) =>
      withSettingsStatus(factory, await factory.getAgent(id), (agent, report) => report(agent)),
    ),
  ],
  factory_create_agent: [
    "agent",
    async (input) =>
      withSettingsStatus(factory, await factory.createAgent(input), (agent, report) =>
        report(agent),
      ),
  ],
  factory_save_agent: [
    "agent",
    withId("agentId", async (id, input) =>
      withSettingsStatus(factory, await factory.updateAgent(id, input), (agent, report) =>
        report(agent),
      ),
    ),
  ],
  factory_remove_agent: ["agentRemoval", removal("agentId", (id) => factory.removeAgent(id))],
  factory_change_agent_owner: [
    "agentOwner",
    withId("agentId", async (id, input) =>
      withSettingsStatus(factory, await factory.changeAgentOwner(id, input), (agent, report) =>
        report(agent),
      ),
    ),
  ],
  factory_duplicate_agent: [
    "duplicate",
    withId("agentId", async (id, input) =>
      withSettingsStatus(factory, await factory.duplicateAgent(id, input), (agent, report) =>
        report(agent),
      ),
    ),
  ],
  factory_list_flows: ["flow", ownedBy(() => factory.listFlows())],
  factory_get_flow: ["flow", withId("flowId", (id) => factory.getFlow(id))],
  factory_create_flow: ["flow", (input) => factory.createFlow(input)],
  factory_save_flow: ["flow", withId("flowId", (id, input) => factory.updateFlow(id, input))],
  factory_check_flow: [
    "flow",
    withId("flowId", async (id) => {
      const flow = await factory.getFlow(id);
      return flow.ok ? { ok: true, value: flow.value.readiness } : flow;
    }),
  ],
  factory_remove_flow: ["flowRemoval", removal("flowId", (id) => factory.removeFlow(id))],
  factory_change_flow_owner: [
    "flowOwner",
    withId("flowId", (id, input) => factory.changeFlowOwner(id, input)),
  ],
  factory_preview_flow_duplicate: [
    "duplicate",
    withId("flowId", (id, input) => factory.previewFlowDuplicate(id, input)),
  ],
  factory_duplicate_flow: [
    "duplicate",
    withId("flowId", (id, input) => factory.duplicateFlow(id, input)),
  ],
});

/** A Factory tool result: one JSON text item, flagged as an error when the call failed. */
export const textResult = (isError: boolean, reply: unknown): CallToolResult => ({
  isError,
  content: [{ type: "text", text: JSON.stringify(reply) }],
});

/** Answers an authoring tool call, or `undefined` when `name` is not an authoring tool. */
export async function callAuthoringTool(
  factory: AuthoringOperations,
  name: string,
  args: unknown,
): Promise<CallToolResult | undefined> {
  const calls = authoringCalls(factory);
  if (!Object.hasOwn(calls, name)) return undefined;
  const [subject, call] = calls[name]!;
  const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  try {
    const result = await call(input);
    if (result.ok) return textResult(false, result.value);
    const { code, message, issues } = result.error;
    const steps = nextSteps[subject];
    const issueNext = issues.map((issue) => steps[issue.code]).find((next) => next !== undefined);
    return textResult(true, {
      code,
      message,
      issues,
      next: issueNext ?? steps[code] ?? unavailableNext,
    });
  } catch {
    return textResult(true, {
      code: "internal",
      message: "Factory could not complete this call.",
      issues: [],
      next: unavailableNext,
    });
  }
}
