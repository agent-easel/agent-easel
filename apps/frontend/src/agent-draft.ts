import { useSyncExternalStore } from "react";
import type {
  AgentCapabilities,
  AgentDefinition,
  AgentExecutionSettings,
  AgentModelOptionValue,
  AgentEnvironment,
  AgentProjectOverride,
  AgentProviderCapability,
  AgentModelCapability,
} from "@t3-factory/contracts";
import {
  buildOptions,
  validateCreateAgent,
  validateUpdateAgent,
} from "@t3-factory/domain-validation";
import type { api } from "./api.ts";
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
  "createAgent" | "updateAgent" | "removeAgent" | "duplicateAgent" | "getAgent"
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
  removeOption: (execution: AgentExecutionSettings, id: string): AgentExecutionSettings => ({
    ...execution,
    modelOptions: execution.modelOptions.filter((option) => option.id !== id),
  }),
};

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

/** A model-less Agent opens with nothing chosen; only a new Agent preselects a provider. */
function contentOf(agent: AgentDefinition): AgentContent {
  return {
    name: agent.name,
    prompt: agent.prompt,
    execution: agent.execution ?? NO_WORKER,
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
  const fallback = "Could not save this Agent. Your edits are still here.";
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
        "Save outcome unknown. Factory may have saved this Agent; your edits are kept and nothing is retried.",
      fallback,
    };
  }
  const validation = validateCreateAgent({ ...content, projectId: owner });
  if (!validation.ok) return { error: validation.error.message };
  const { projectId: _, ...input } = validation.value;
  return {
    submitted: asContent(input),
    send: () => operations.createAgent(validation.value),
    unknownMessage:
      "Save outcome unknown. Factory may have created this Agent; check the Agent list before creating it again.",
    fallback,
  };
}

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
  /** The compared revision **Load latest revision** is waiting to be confirmed for. */
  readonly confirmingLoad: number | null;
}

/**
 * One opened Agent on the shared revision protocol: editable content and worker choices, the
 * Create gate after an unknown Create outcome, Duplicate and the confirmation before **Load
 * latest revision**. The new-Agent form follows nothing until its own Create. A draft belongs to
 * one Studio session and server, so replies reaching a discarded draft change nothing shown.
 */
export function createAgentDraft(
  agent: AgentDefinition | null,
  capabilities: AgentCapabilities | null,
  source: AgentDraftSource,
) {
  /** Shown only while this revision is the compared one, so a newer revision closes it. */
  let confirmingLoad: number | null = null;
  const draft = createRevisionedDraft({
    saved: agent,
    content: agent
      ? contentOf(agent)
      : {
          name: "",
          prompt: "",
          execution: initialExecution(capabilities),
          exits: [{ id: randomId(), name: "done", description: "", messageRequired: false }],
          projectOverrides: [],
        },
    contentOf,
    list: () => source.getSnapshot().agents,
    read: (id) => source.getAgent(id),
    view(state): AgentDraftSnapshot {
      const { conflict } = state;
      const unknownCreate = !state.saved && state.saveOutcome === "unknown";
      const strandedOverrides =
        state.saved !== null && state.owner !== null && state.content.projectOverrides.length > 0;
      return {
        ...state,
        canSave: state.canSave && !unknownCreate && !strandedOverrides,
        strandedOverrides,
        choices: executionChoices(capabilities, state.content.execution),
        needsModel: savedExecution(state.content.execution) === null,
        confirmingLoad:
          conflict.status === "compared" && conflict.latest.revision === confirmingLoad
            ? confirmingLoad
            : null,
      };
    },
  });
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
    /** Copies the saved revision into target `projectId`: a Project, or null for Global. */
    async duplicate(projectId: string | null) {
      const { saved, removed, dirty, saving, removing } = draft.getSnapshot();
      if (removed || !saved || dirty || saving || removing) return;
      return source.duplicateAgent(saved.id, { projectId });
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
    clearWorker() {
      edit({ execution: NO_WORKER });
    },
    dismissUpdate: draft.dismissUpdate,
    clearRemovalError: draft.clearRemovalError,
    remove: () => draft.remove(source.removeAgent, "Factory could not delete this Agent."),
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
      const request = saveRequest(saved, submitted, source, saved ? snapshot.owner : owner);
      if (!("error" in request)) return draft.save(request);
      draft.report(request.error);
      return undefined;
    },
    compare: draft.compare,
    acknowledgeOwner: draft.acknowledgeOwner,
    ownerChangedHere: draft.ownerChangedHere,
    /** Asks to confirm replacing the draft with `revision`, the revision the comparison shows. */
    requestLoadLatest(revision: number) {
      const { conflict } = draft.getSnapshot();
      if (conflict.status !== "compared" || conflict.latest.revision !== revision) return;
      confirmingLoad = revision;
      draft.publish();
    },
    cancelLoadLatest() {
      confirmingLoad = null;
      draft.publish();
    },
    /** Replaces the draft with `revision` if it is still the compared one and was confirmed. */
    loadLatest(revision: number) {
      if (draft.getSnapshot().confirmingLoad !== revision) return;
      confirmingLoad = null;
      draft.takeLatest(revision);
    },
    keepEdits: draft.keep,
    /** The user checked the Agent list after an unknown Create, so Create may be sent again. */
    allowCreateAgain() {
      if (draft.getSnapshot().saved) return;
      draft.acknowledgeUnknownSave();
    },
    setOption(id: string, value: AgentModelOptionValue["value"]) {
      editExecution((current) => executionEdits.option(current, id, value));
    },
    removeOption(id: string) {
      editExecution((current) => executionEdits.removeOption(current, id));
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
