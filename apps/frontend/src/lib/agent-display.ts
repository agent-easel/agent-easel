import {
  flowGraphReferencesAgent,
  optionValue,
  resolveAgentModel,
} from "@t3-factory/domain-validation";
import type {
  AgentCapabilities,
  AgentExecutionSettings,
  AgentModelCapability,
  FlowDraft,
} from "@t3-factory/contracts";

export function flowUsageCount(flows: readonly FlowDraft[], agentId: string): number {
  return flows.filter((flow) => flowGraphReferencesAgent(flow.graph, agentId)).length;
}

export function flowUsageLabel(count: number): string {
  if (count === 0) return "Unused";
  if (count === 1) return "1 Flow";
  return `${count} Flows`;
}

/** How many Projects a global Agent's list row says override its Worker; empty for none. */
export function projectOverridesLabel(count: number): string {
  if (count === 0) return "";
  return count === 1 ? "+1 Project override" : `+${count} Project overrides`;
}

/** What the Agent editor's model picker shows for the draft Worker. */
export type WorkerTrigger = {
  readonly state: "ok" | "needs-model" | "unavailable" | "unknown";
  /** The provider's initial; empty without a model. */
  readonly glyph: string;
  readonly model: string;
  /** The chosen thinking levels; empty for none. */
  readonly effort: string;
  /** The picker's accessible text, naming Needs a model, Unavailable or Unknown. */
  readonly label: string;
  /** Why the selection is Unavailable or Unknown; null otherwise. */
  readonly reason: string | null;
};

export function workerTrigger(
  execution: AgentExecutionSettings,
  capabilities: AgentCapabilities | null,
): WorkerTrigger {
  if (!execution.environmentId || !execution.providerInstanceId || !execution.modelId)
    return {
      state: "needs-model",
      glyph: "",
      model: "",
      effort: "",
      label: "Needs a model",
      reason: null,
    };
  const { provider, model } = resolveAgentModel(execution, capabilities);
  const providerLabel = provider?.displayName ?? execution.providerInstanceId;
  const shown = {
    glyph: providerLabel.charAt(0).toUpperCase(),
    model: model?.label ?? execution.modelId,
    effort: workerEffort(execution, model),
  };
  const label = [shown.model, shown.effort].filter(Boolean).join(" · ");
  if (capabilities?.state !== "ready")
    return {
      state: "unknown",
      ...shown,
      label: `${label} · Unknown`,
      reason: capabilities?.explanation ?? "Connect to T3 to load environments and capabilities.",
    };
  const missing = !capabilities.environments.some(
    (entry) => entry.environmentId === execution.environmentId,
  )
    ? `environment ${execution.environmentId}`
    : !provider
      ? `provider ${execution.providerInstanceId}`
      : !model
        ? `model ${execution.modelId}`
        : null;
  if (missing)
    return {
      state: "unavailable",
      ...shown,
      label: `${label} · Unavailable`,
      reason: `Saved ${missing} is unavailable in T3.`,
    };
  return { state: "ok", ...shown, label, reason: null };
}

/**
 * The model's first option, the effort the Worker settings show at step 4, defaults included; the
 * saved text options when T3 does not offer the model.
 */
function workerEffort(
  execution: AgentExecutionSettings,
  model: AgentModelCapability | undefined,
): string {
  if (!model)
    return execution.modelOptions
      .filter((entry) => typeof entry.value === "string" && entry.value.length > 0)
      .map((entry) => entry.value)
      .join(", ");
  const descriptor = model.options?.[0];
  if (descriptor?.type !== "select") return "";
  const value = optionValue(execution.modelOptions, descriptor);
  return descriptor.choices?.find((choice) => choice.id === value)?.label ?? String(value);
}

/** The provider, model and thinking options of saved execution settings. */
export function agentRuntimeMeta(
  execution: AgentExecutionSettings,
  capabilities: AgentCapabilities | null,
): string {
  const { provider, model } = resolveAgentModel(execution, capabilities);
  const providerLabel = provider?.displayName ?? execution.providerInstanceId;
  const modelLabel = model?.label ?? execution.modelId;
  const thinking = execution.modelOptions
    .map((entry) => String(entry.value))
    .filter((value) => value.length > 0)
    .join(", ");
  return [providerLabel, modelLabel, thinking].filter(Boolean).join(" · ");
}
