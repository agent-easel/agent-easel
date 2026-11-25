import { useSyncExternalStore } from "react";
import type {
  AgentCapabilities,
  AgentCreateOutcome,
  CreateAgentInput,
  AgentDefinition,
  AgentExecutionSettings,
  AgentModelOptionDescriptor,
  AgentModelOptionValue,
  AgentEnvironment,
  BlockExit,
  AgentProjectOverride,
  AgentProviderCapability,
  AgentModelCapability,
} from "@agent-easel/contracts";
import {
  buildOptions,
  validateCreateAgent,
  validateUpdateAgent,
} from "@agent-easel/domain-validation";
import type { api } from "./api.ts";
import { OfflineError } from "./transport.ts";
import { randomId } from "./lib/ids.ts";
import type { StudioDefinitions } from "./studio-definitions.ts";
import {
  createRevisionedDraft,
  type RevisionedDraftState,
  type SaveRequest,
} from "./revisioned-draft.ts";

/** Factory writes used by one Agent draft; the HTTP client in the app, fakes in Node tests. */
export type AgentDraftOperations = Pick<
  typeof api,
  | "reserveAgentCreate"
  | "createAgent"
  | "getAgentCreateOutcome"
  | "updateAgent"
  | "removeAgent"
  | "duplicateAgent"
  | "getAgent"
>;

/** Studio's saved definitions as one Agent draft follows them, and the writes it sends. */
export type AgentDraftSource = Pick<StudioDefinitions, "getSnapshot" | "subscribe"> &
  AgentDraftOperations;
/** Draft content. The Worker picker may hold unchosen (empty) ids; saving converts it. */
export interface AgentContent extends Pick<
  AgentDefinition,
  "name" | "prompt" | "exits" | "projectOverrides"
> {
  readonly execution: AgentExecutionSettings;
}

const NO_WORKER: AgentExecutionSettings = {
  environmentId: "",
  providerInstanceId: "",
  modelId: "",
  modelOptions: [],
};

/** Complete settings once an environment, provider and model are chosen; otherwise the Agent is
 * saved without a model, never with a partial selection. */
function savedExecution(selection: AgentExecutionSettings): AgentExecutionSettings | null {
  return selection.environmentId && selection.providerInstanceId && selection.modelId
    ? selection
    : null;
}

/** The create API's shape for the draft: an unchosen or partial Worker becomes no model. Saving and a
 * removed Agent's **Copy as JSON** both use it, so recovered JSON creates the same Agent. */
export function createShapedContent(content: AgentContent) {
  return { ...content, execution: savedExecution(content.execution) };
}

function withOptionValue(
  options: readonly AgentModelOptionValue[],
  id: string,
  value: AgentModelOptionValue["value"],
): AgentModelOptionValue[] {
  return options.some((entry) => entry.id === id)
    ? options.map((entry) => (entry.id === id ? { ...entry, value } : entry))
    : [...options, { id, value }];
}

/** The environments, providers and chosen provider and model T3 offers for `execution`. */
export function executionChoices(
  capabilities: AgentCapabilities | null,
  execution: AgentExecutionSettings,
) {
  const environments = capabilities?.environments ?? [];
  const providers = environments.some((entry) => entry.environmentId === execution.environmentId)
    ? (capabilities?.providers ?? [])
    : [];
  const selectedProvider = providers.find(
    (entry) => entry.providerInstanceId === execution.providerInstanceId,
  );
  const selectedModel = selectedProvider?.models.find((entry) => entry.id === execution.modelId);
  return { environments, providers, selectedProvider, selectedModel };
}

/** One Worker picker change applied to `execution`, keeping only the options the model offers. */
export const executionEdits = {
  environment: (execution: AgentExecutionSettings, id: string): AgentExecutionSettings => ({
    ...execution,
    environmentId: id,
  }),
  provider(
    execution: AgentExecutionSettings,
    choices: ReturnType<typeof executionChoices>,
    id: string,
  ): AgentExecutionSettings {
    const model = choices.providers.find((entry) => entry.providerInstanceId === id)?.models[0];
    return {
      ...execution,
      providerInstanceId: id,
      modelId: model?.id ?? "",
      modelOptions: buildOptions(model?.options, execution.modelOptions),
    };
  },
  model(
    execution: AgentExecutionSettings,
    choices: ReturnType<typeof executionChoices>,
    id: string,
  ): AgentExecutionSettings {
    const model = choices.selectedProvider?.models.find((entry) => entry.id === id);
    return {
      ...execution,
      modelId: id,
      modelOptions: buildOptions(model?.options, execution.modelOptions),
    };
  },
  option: (
    execution: AgentExecutionSettings,
    id: string,
    value: AgentModelOptionValue["value"],
  ): AgentExecutionSettings => ({
    ...execution,
    modelOptions: withOptionValue(execution.modelOptions, id, value),
  }),
};

/** Whether T3 offers `value` for option `descriptor`. */
function offersValue(
  descriptor: AgentModelOptionDescriptor,
  value: AgentModelOptionValue["value"],
) {
  if (descriptor.values) return descriptor.values.includes(value);
  if (descriptor.type === "boolean") return typeof value === "boolean";
  return descriptor.choices?.some((choice) => choice.id === value) ?? false;
}

/**
 * `execution` without the parts T3 no longer offers: a gone environment clears the selection, a
 * gone provider or model clears it from there, and options the model does not offer are dropped.
 * Without T3's capabilities nothing is known to be gone, so nothing is cleared.
 */
export function offeredExecution(
  execution: AgentExecutionSettings,
  capabilities: AgentCapabilities | null,
): AgentExecutionSettings {
  if (capabilities?.state !== "ready" || !execution.environmentId) return execution;
  if (!capabilities.environments.some((entry) => entry.environmentId === execution.environmentId))
    return NO_WORKER;
  if (!execution.providerInstanceId) return execution;
  const provider = capabilities.providers.find(
    (entry) => entry.providerInstanceId === execution.providerInstanceId,
  );
  if (!provider) return { ...NO_WORKER, environmentId: execution.environmentId };
  if (!execution.modelId) return execution;
  const model = provider.models.find((entry) => entry.id === execution.modelId);
  if (!model) return { ...execution, modelId: "", modelOptions: [] };
  const modelOptions = execution.modelOptions.filter((option) => {
    const descriptor = model.options?.find((entry) => entry.id === option.id);
    return descriptor !== undefined && offersValue(descriptor, option.value);
  });
  return modelOptions.length === execution.modelOptions.length
    ? execution
    : { ...execution, modelOptions };
}

function initialExecution(capabilities: AgentCapabilities | null): AgentExecutionSettings {
  // A provider without Factory reporting cannot run, so it is never preselected.
  const provider = capabilities?.providers.find((entry) => entry.reporting.supported);
  const model = provider?.models[0];
  return {
    environmentId: capabilities?.environments[0]?.environmentId ?? "",
    providerInstanceId: provider?.providerInstanceId ?? "",
    modelId: model?.id ?? "",
    modelOptions: buildOptions(model?.options, []),
  };
}

/**
 * A model-less Agent opens with nothing chosen; only a new Agent preselects a provider. A saved
 * selection T3 no longer offers opens cleared, so the stored Agent changes only on Save.
 */
function contentOf(agent: AgentDefinition, capabilities: AgentCapabilities | null): AgentContent {
  return {
    name: agent.name,
    prompt: agent.prompt,
    execution: offeredExecution(agent.execution ?? NO_WORKER, capabilities),
    exits: agent.exits,
    projectOverrides: agent.projectOverrides,
  };
}

function saveRequest(
  agent: AgentDefinition | null,
  draft: AgentContent,
  operations: AgentDraftOperations,
  /** The owning Project a save expects, or the one a create gives the new Agent. */
  owner: string | null,
  create: (input: CreateAgentInput) => Promise<AgentDefinition>,
): { error: string } | SaveRequest<AgentDefinition, AgentContent> {
  const content = createShapedContent(draft);
  // Submitted content is compared with saved revisions, which open a model-less Agent unchosen.
  const asContent = (
    input: Omit<typeof content, "projectOverrides"> &
      Partial<Pick<AgentContent, "projectOverrides">>,
  ): AgentContent => ({
    ...input,
    execution: input.execution ?? NO_WORKER,
    projectOverrides: input.projectOverrides ?? [],
  });
  const fallback = "Your changes are kept. Try saving again.";
  if (agent) {
    const validation = validateUpdateAgent({
      ...content,
      expectedRevision: agent.revision,
      expectedProjectId: owner,
    });
    if (!validation.ok) return { error: validation.error.message };
    const { expectedRevision: _, expectedProjectId: __, ...submitted } = validation.value;
    return {
      submitted: asContent(submitted),
      send: () => operations.updateAgent(agent.id, validation.value),
      unknownMessage:
        "AgentEasel may have saved this Agent. Your changes are kept and nothing is retried.",
      fallback,
    };
  }
  const validation = validateCreateAgent({ ...content, projectId: owner });
  if (!validation.ok) return { error: validation.error.message };
  const { projectId: _, ...input } = validation.value;
  return {
    submitted: asContent(input),
    send: () => create(validation.value),
    unknownMessage:
      "AgentEasel may have created this Agent. Checking before it can be created again…",
    fallback,
  };
}

/** A name problem an exit's field shows as its tag. */
export type ExitProblem = "Duplicate" | "Required";

/**
 * The exits' name problems, checked live as the server checks them on save: each named exit by id
 * with its tag, and the card that explains the first problem. Null when every name is usable.
 */
function exitProblems(exits: readonly BlockExit[]) {
  const tags = new Map<string, ExitProblem>();
  const counts = new Map<string, number>();
  for (const exit of exits) {
    const name = exit.name.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let card: { readonly title: string; readonly body: string } | null = null;
  for (const exit of exits) {
    const name = exit.name.trim();
    if (!name) {
      tags.set(exit.id, "Required");
      card ??= { title: "An exit has no name", body: "Name the exit or remove it." };
    } else if ((counts.get(name) ?? 0) > 1) {
      tags.set(exit.id, "Duplicate");
      card ??= { title: `Two exits are named “${name}”`, body: "Give each exit its own name." };
    }
  }
  return card ? { tags, card } : null;
}

/**
 * After a Create whose reply was lost, only Factory's confirmed `absent` outcome allows
 * another Create. A failed lookup leaves the original request available to check again.
 */
export type CreateCheck =
  | { readonly status: "none" }
  | { readonly status: "checking" }
  | AgentCreateOutcome;

export interface AgentDraftSnapshot extends RevisionedDraftState<AgentDefinition, AgentContent> {
  readonly choices: {
    readonly environments: readonly AgentEnvironment[];
    readonly providers: readonly AgentProviderCapability[];
    readonly selectedProvider: AgentProviderCapability | undefined;
    readonly selectedModel: AgentModelCapability | undefined;
  };
  /** Saving now would store no model: the Worker selection is empty or incomplete. */
  readonly needsModel: boolean;
  /**
   * The saved Agent is a Project Agent now (moved elsewhere) while the draft holds Project
   * overrides, which only a global Agent has; Save waits until they are removed or it is global.
   */
  readonly strandedOverrides: boolean;
  /** Duplicate or empty exit names; Save waits until they are fixed. */
  readonly exitProblems: ReturnType<typeof exitProblems>;
  readonly createCheck: CreateCheck;
}

/**
 * One opened Agent on the shared revision protocol: editable content and worker choices, the
 * reconciliation of a Create whose reply was lost, Duplicate and loading a compared revision. The
 * new-Agent form follows nothing until its own Create. A draft belongs to one Studio session and
 * server, so replies reaching a discarded draft change nothing shown.
 */
export function createAgentDraft(
  agent: AgentDefinition | null,
  capabilities: AgentCapabilities | null,
  source: AgentDraftSource,
) {
  const opened = (definition: AgentDefinition) => contentOf(definition, capabilities);
  let createCheck: CreateCheck = { status: "none" };
  let lostCreateId: string | undefined;
  const draft = createRevisionedDraft({
    saved: agent,
    content: agent
      ? opened(agent)
      : {
          name: "",
          prompt: "",
          execution: initialExecution(capabilities),
          exits: [{ id: randomId(), name: "done", description: "", messageRequired: false }],
          projectOverrides: [],
        },
    contentOf: opened,
    list: () => source.getSnapshot().agents,
    read: (id) => source.getAgent(id),
    view(state): AgentDraftSnapshot {
      const unknownCreate = !state.saved && state.saveOutcome === "unknown";
      const strandedOverrides =
        state.saved !== null && state.owner !== null && state.content.projectOverrides.length > 0;
      const problems = exitProblems(state.content.exits);
      return {
        ...state,
        canSave: state.canSave && !unknownCreate && !strandedOverrides && !problems,
        strandedOverrides,
        exitProblems: problems,
        choices: executionChoices(capabilities, state.content.execution),
        needsModel: savedExecution(state.content.execution) === null,
        createCheck: unknownCreate ? createCheck : { status: "none" },
      };
    },
  });
  async function checkLostCreate() {
    if (!lostCreateId || createCheck.status === "checking") return;
    createCheck = { status: "checking" };
    draft.publish();
    try {
      createCheck = await source.getAgentCreateOutcome(lostCreateId);
    } catch {
      createCheck = { status: "unconfirmed" };
    }
    draft.publish();
  }
  function edit(change: Partial<AgentContent>) {
    const { saving, removed, removing } = draft.getSnapshot();
    if ((saving && !removed) || removing) return;
    draft.edit(change);
  }
  const execution = () => draft.getSnapshot().content.execution;
  const editExecution = (change: (current: AgentExecutionSettings) => AgentExecutionSettings) =>
    edit({ execution: change(execution()) });
  const overrides = () => draft.getSnapshot().content.projectOverrides;
  return {
    getSnapshot: draft.getSnapshot,
    subscribe: draft.subscribe,
    /** Follows Studio's saved Agents until the returned function is called. */
    connect() {
      const unsubscribe = source.subscribe(draft.reconcile);
      draft.reconcile();
      return unsubscribe;
    },
    edit,
    /**
     * Copies the saved revision, never the draft's unsaved changes, as `name` into target
     * `projectId`: a Project, or null for Global.
     */
    async duplicate(projectId: string | null, name: string) {
      const { saved, removed, saving, removing } = draft.getSnapshot();
      if (removed || !saved || saving || removing) return;
      return source.duplicateAgent(saved.id, { projectId, name });
    },
    setEnvironmentId(id: string) {
      editExecution((current) => executionEdits.environment(current, id));
    },
    /** Adds or replaces the override for `override.projectId`, keeping the list order. */
    setOverride(override: AgentProjectOverride) {
      const current = overrides();
      edit({
        projectOverrides: current.some((entry) => entry.projectId === override.projectId)
          ? current.map((entry) => (entry.projectId === override.projectId ? override : entry))
          : [...current, override],
      });
    },
    removeOverride(projectId: string) {
      edit({ projectOverrides: overrides().filter((entry) => entry.projectId !== projectId) });
    },
    /** Removes every Project override from the draft, as a saved Project Agent's editor offers. */
    removeOverrides() {
      edit({ projectOverrides: [] });
    },
    /** Remove the Worker and the Project overrides that depend on it from this draft. */
    removeWorker() {
      edit({ execution: NO_WORKER, projectOverrides: [] });
    },
    dismissUpdate: draft.dismissUpdate,
    clearRemovalError: draft.clearRemovalError,
    remove: () => draft.remove(source.removeAgent, "AgentEasel could not remove this Agent."),
    /**
     * Validates and sends the draft against its saved revision, or creates it owned by `owner`
     * (null for a global Agent); a save never changes the owner.
     */
    async save(owner: string | null = null) {
      const snapshot = draft.getSnapshot();
      if (!snapshot.canSave) return undefined;
      const { saved, content } = snapshot;
      // A Project Agent has no Project overrides, so the editor says Create leaves them out. Only
      // the request omits them: the draft keeps them until a Create succeeds.
      const submitted = !saved && owner !== null ? { ...content, projectOverrides: [] } : content;
      let requestId: string | undefined;
      const create = async (input: CreateAgentInput) => {
        try {
          requestId = await source.reserveAgentCreate();
        } catch (cause) {
          // Losing the reservation reply cannot create an Agent.
          if (cause instanceof OfflineError) throw new OfflineError("not-sent");
          throw cause;
        }
        return source.createAgent({ ...input, requestId });
      };
      const request = saveRequest(saved, submitted, source, saved ? snapshot.owner : owner, create);
      if ("error" in request) {
        draft.report(request.error);
        return undefined;
      }
      const result = await draft.save(request);
      if (requestId && draft.getSnapshot().saveOutcome === "unknown") {
        lostCreateId = requestId;
        await checkLostCreate();
      }
      return result;
    },
    compare: draft.compare,
    acknowledgeOwner: draft.acknowledgeOwner,
    ownerChangedHere: draft.ownerChangedHere,
    /** Replaces the draft with `revision` while it is still the compared one. */
    loadLatest: draft.takeLatest,
    keepEdits: draft.keep,
    /** Opens the Agent a lost Create made, as saved, so leaving the new-Agent form loses nothing. */
    openCreated() {
      if (createCheck.status !== "created") return undefined;
      const made = createCheck.agent;
      draft.load(made);
      draft.acknowledgeUnknownSave();
      return made;
    },
    /** Factory confirmed a lost Create made nothing, so Create may be sent again. */
    checkCreate: checkLostCreate,
    createAgain() {
      if (createCheck.status !== "absent") return;
      createCheck = { status: "none" };
      lostCreateId = undefined;
      draft.acknowledgeUnknownSave();
    },
    setOption(id: string, value: AgentModelOptionValue["value"]) {
      editExecution((current) => executionEdits.option(current, id, value));
    },
    chooseModel(id: string) {
      const { choices } = draft.getSnapshot();
      editExecution((current) => executionEdits.model(current, choices, id));
    },
    chooseProvider(id: string) {
      const { choices } = draft.getSnapshot();
      editExecution((current) => executionEdits.provider(current, choices, id));
    },
  };
}

export type AgentDraftModel = ReturnType<typeof createAgentDraft>;

export function useAgentDraftSnapshot(draft: AgentDraftModel) {
  return useSyncExternalStore(draft.subscribe, draft.getSnapshot);
}
