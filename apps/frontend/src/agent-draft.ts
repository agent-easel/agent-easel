import { useSyncExternalStore } from "react";
import type {
  AgentCapabilities,
  AgentDefinition,
  AgentExecutionSettings,
  AgentModelOptionDescriptor,
  AgentModelOptionValue,
  AgentEnvironment,
  AgentProviderCapability,
  AgentModelCapability,
} from "@t3-factory/contracts";
import { validateCreateAgent, validateUpdateAgent } from "@t3-factory/domain-validation";
import { api, ApiError } from "./api.ts";
import { randomId } from "./lib/ids.ts";

/** Factory writes used by one Agent draft; the HTTP client in the app, fakes in Node tests. */
export type AgentDraftOperations = Pick<typeof api, "createAgent" | "updateAgent" | "removeAgent">;
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

export function optionValue(
  options: readonly AgentModelOptionValue[],
  descriptor: AgentModelOptionDescriptor,
) {
  const selected = options.find((entry) => entry.id === descriptor.id);
  if (selected) return selected.value;
  if (descriptor.default !== undefined) return descriptor.default;
  if (descriptor.values) return descriptor.values[0] ?? "";
  if (descriptor.type === "boolean") return false;
  return descriptor.choices?.[0]?.id ?? "";
}

export function buildOptions(
  descriptors: readonly AgentModelOptionDescriptor[] | undefined,
  current: readonly AgentModelOptionValue[],
): AgentModelOptionValue[] {
  if (!descriptors?.length) return [];
  return descriptors.map((descriptor) => ({
    id: descriptor.id,
    value: optionValue(current, descriptor),
  }));
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
): { error: string } | { save: () => Promise<AgentDefinition> } {
  const content = { ...draft, execution: savedExecution(draft.execution) };
  if (agent) {
    const validation = validateUpdateAgent({ ...content, expectedRevision: agent.revision });
    if (!validation.ok) return { error: validation.error.message };
    const input = validation.value;
    return { save: () => operations.updateAgent(agent.id, input) };
  }
  const validation = validateCreateAgent(content);
  if (!validation.ok) return { error: validation.error.message };
  const input = validation.value;
  return { save: () => operations.createAgent(input) };
}

export interface AgentDraftSnapshot {
  readonly saved: AgentDefinition | null;
  readonly content: AgentContent;
  readonly choices: {
    readonly environments: readonly AgentEnvironment[];
    readonly providers: readonly AgentProviderCapability[];
    readonly selectedProvider: AgentProviderCapability | undefined;
    readonly selectedModel: AgentModelCapability | undefined;
  };
  /** Saving now would store no model: the Worker selection is empty or incomplete. */
  readonly needsModel: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly error: string;
  readonly conflict: string;
  readonly deleting: boolean;
  readonly deleteError: string;
}

/** One opened Agent: editable content, worker choices, revision baseline and write outcomes. */
export function createAgentDraft(
  agent: AgentDefinition | null,
  capabilities: AgentCapabilities | null,
  operations: AgentDraftOperations = api,
) {
  let saved = agent;
  let content: AgentContent = agent
    ? contentOf(agent)
    : {
        name: "",
        prompt: "",
        execution: initialExecution(capabilities),
        exits: [{ id: randomId(), name: "done", description: "", messageRequired: false }],
      };
  let baseline = content;
  let saving = false;
  let error = "";
  let conflict = "";
  let deleting = false;
  let deleteError = "";
  let snapshot = current();
  const listeners = new Set<() => void>();

  function current(): AgentDraftSnapshot {
    const { environmentId, providerInstanceId, modelId } = content.execution;
    const environments = capabilities?.environments ?? [];
    const providers = environments.some((entry) => entry.environmentId === environmentId)
      ? (capabilities?.providers ?? [])
      : [];
    const selectedProvider = providers.find(
      (entry) => entry.providerInstanceId === providerInstanceId,
    );
    const selectedModel = selectedProvider?.models.find((entry) => entry.id === modelId);
    return {
      saved,
      content,
      saving,
      error,
      conflict,
      deleting,
      deleteError,
      choices: { environments, providers, selectedProvider, selectedModel },
      needsModel: savedExecution(content.execution) === null,
      dirty: JSON.stringify(content) !== JSON.stringify(baseline),
    };
  }
  function publish() {
    snapshot = current();
    listeners.forEach((notify) => notify());
  }
  function edit(change: Partial<AgentContent>) {
    if (saving || deleting) return;
    content = { ...content, ...change };
    publish();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    edit,
    setEnvironmentId(id: string) {
      edit({ execution: { ...content.execution, environmentId: id } });
    },
    clearWorker() {
      edit({ execution: NO_WORKER });
    },
    clearDeleteError() {
      deleteError = "";
      publish();
    },
    async delete() {
      if (!saved || saving || deleting) return false;
      deleting = true;
      deleteError = "";
      publish();
      try {
        await operations.removeAgent(saved.id);
        baseline = content;
        return true;
      } catch (cause) {
        deleteError =
          cause instanceof Error ? cause.message : "Factory could not delete this Agent.";
        return false;
      } finally {
        deleting = false;
        publish();
      }
    },
    async save() {
      if (saving || deleting) return;
      const request = saveRequest(saved, content, operations);
      if ("error" in request) {
        error = request.error;
        publish();
        return;
      }
      saving = true;
      error = "";
      publish();
      try {
        saved = await request.save();
        content = contentOf(saved);
        baseline = content;
        conflict = "";
        return saved;
      } catch (cause) {
        error =
          cause instanceof Error
            ? cause.message
            : "Could not save this Agent. Your edits are still here.";
        if (cause instanceof ApiError && cause.detail.code === "conflict") conflict = error;
        return undefined;
      } finally {
        saving = false;
        publish();
      }
    },
    setOption(id: string, value: AgentModelOptionValue["value"]) {
      edit({
        execution: {
          ...content.execution,
          modelOptions: withOptionValue(content.execution.modelOptions, id, value),
        },
      });
    },
    removeOption(id: string) {
      edit({
        execution: {
          ...content.execution,
          modelOptions: content.execution.modelOptions.filter((option) => option.id !== id),
        },
      });
    },
    chooseModel(id: string) {
      const model = snapshot.choices.selectedProvider?.models.find((entry) => entry.id === id);
      edit({
        execution: {
          ...content.execution,
          modelId: id,
          modelOptions: buildOptions(model?.options, content.execution.modelOptions),
        },
      });
    },
    chooseProvider(id: string) {
      const model = snapshot.choices.providers.find((entry) => entry.providerInstanceId === id)
        ?.models[0];
      edit({
        execution: {
          ...content.execution,
          providerInstanceId: id,
          modelId: model?.id ?? "",
          modelOptions: buildOptions(model?.options, content.execution.modelOptions),
        },
      });
    },
  };
}

export type AgentDraftModel = ReturnType<typeof createAgentDraft>;

export function useAgentDraftSnapshot(draft: AgentDraftModel) {
  return useSyncExternalStore(draft.subscribe, draft.getSnapshot);
}
