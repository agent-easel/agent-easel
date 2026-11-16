import { useSyncExternalStore } from "react";
import type {
  AgentCapabilities,
  AgentDefinition,
  AgentExecutionSettings,
  AgentModelOptionValue,
  AgentEnvironment,
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
  "createAgent" | "updateAgent" | "removeAgent" | "duplicateAgent"
>;

/** Studio's saved definitions as one Agent draft follows them, and the writes it sends. */
export type AgentDraftSource = Pick<StudioDefinitions, "getSnapshot" | "subscribe"> &
  AgentDraftOperations;
/** Draft content. The Worker picker may hold unchosen (empty) ids; saving converts it. */
export interface AgentContent extends Pick<AgentDefinition, "name" | "prompt" | "exits"> {
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
  };
}

function saveRequest(
  agent: AgentDefinition | null,
  draft: AgentContent,
  operations: AgentDraftOperations,
): { error: string } | SaveRequest<AgentDefinition, AgentContent> {
  const content = createShapedContent(draft);
  // Submitted content is compared with saved revisions, which open a model-less Agent unchosen.
  const asContent = (input: typeof content): AgentContent => ({
    ...input,
    execution: input.execution ?? NO_WORKER,
  });
  const fallback = "Could not save this Agent. Your edits are still here.";
  if (agent) {
    const validation = validateUpdateAgent({
      ...content,
      expectedRevision: agent.revision,
      expectedProjectId: agent.projectId,
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
  const validation = validateCreateAgent(content);
  if (!validation.ok) return { error: validation.error.message };
  const input = validation.value;
  return {
    submitted: asContent(input),
    send: () => operations.createAgent(input),
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
        },
    contentOf,
    list: () => source.getSnapshot().agents,
    view(state): AgentDraftSnapshot {
      const { environmentId, providerInstanceId, modelId } = state.content.execution;
      const environments = capabilities?.environments ?? [];
      const providers = environments.some((entry) => entry.environmentId === environmentId)
        ? (capabilities?.providers ?? [])
        : [];
      const selectedProvider = providers.find(
        (entry) => entry.providerInstanceId === providerInstanceId,
      );
      const selectedModel = selectedProvider?.models.find((entry) => entry.id === modelId);
      const { conflict } = state;
      const unknownCreate = !state.saved && state.saveOutcome === "unknown";
      return {
        ...state,
        canSave: state.canSave && !unknownCreate,
        choices: { environments, providers, selectedProvider, selectedModel },
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
    async duplicate() {
      const { saved, removed, dirty, saving, removing } = draft.getSnapshot();
      if (removed || !saved || dirty || saving || removing) return;
      return source.duplicateAgent(saved.id, {});
    },
    setEnvironmentId(id: string) {
      edit({ execution: { ...execution(), environmentId: id } });
    },
    clearWorker() {
      edit({ execution: NO_WORKER });
    },
    dismissUpdate: draft.dismissUpdate,
    clearRemovalError: draft.clearRemovalError,
    remove: () => draft.remove(source.removeAgent, "Factory could not delete this Agent."),
    /** Validates and sends the draft against its saved revision, or creates it. */
    async save() {
      const { saved, content, canSave } = draft.getSnapshot();
      if (!canSave) return undefined;
      const request = saveRequest(saved, content, source);
      if (!("error" in request)) return draft.save(request);
      draft.report(request.error);
      return undefined;
    },
    compare: draft.compare,
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
      const current = execution();
      edit({
        execution: { ...current, modelOptions: withOptionValue(current.modelOptions, id, value) },
      });
    },
    removeOption(id: string) {
      const current = execution();
      edit({
        execution: {
          ...current,
          modelOptions: current.modelOptions.filter((option) => option.id !== id),
        },
      });
    },
    chooseModel(id: string) {
      const current = execution();
      const model = draft
        .getSnapshot()
        .choices.selectedProvider?.models.find((entry) => entry.id === id);
      edit({
        execution: {
          ...current,
          modelId: id,
          modelOptions: buildOptions(model?.options, current.modelOptions),
        },
      });
    },
    chooseProvider(id: string) {
      const current = execution();
      const model = draft
        .getSnapshot()
        .choices.providers.find((entry) => entry.providerInstanceId === id)?.models[0];
      edit({
        execution: {
          ...current,
          providerInstanceId: id,
          modelId: model?.id ?? "",
          modelOptions: buildOptions(model?.options, current.modelOptions),
        },
      });
    },
  };
}

export type AgentDraftModel = ReturnType<typeof createAgentDraft>;

export function useAgentDraftSnapshot(draft: AgentDraftModel) {
  return useSyncExternalStore(draft.subscribe, draft.getSnapshot);
}
