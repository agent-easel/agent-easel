import {
  flowGraphReferencesAgent,
  optionValue,
  resolveAgentModel,
} from "@t3-factory/domain-validation";
import type {
  AgentCapabilities,
  AgentExecutionSettings,
  AgentModelOptionDescriptor,
  AgentModelOptionValue,
  FlowDraft,
} from "@t3-factory/contracts";

/** Saved Flows whose graph places `agentId`, in the list's order. */
export function placingFlows(flows: readonly FlowDraft[], agentId: string): FlowDraft[] {
  return flows.filter((flow) => flowGraphReferencesAgent(flow.graph, agentId));
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

/** A select option's choices by display label; published values are keyed as JSON. */
export function modelOptionChoices(
  descriptor: AgentModelOptionDescriptor,
): readonly { readonly id: string; readonly label: string }[] {
  return (
    descriptor.values?.map((entry) => ({
      id: JSON.stringify(entry),
      label:
        typeof entry === "boolean"
          ? entry
            ? "On"
            : "Off"
          : entry.charAt(0).toUpperCase() + entry.slice(1),
    })) ??
    descriptor.choices ??
    []
  );
}

/** The display label of a select option's value, such as “High” for `high`. */
export function modelOptionLabel(
  descriptor: AgentModelOptionDescriptor,
  value: AgentModelOptionValue["value"],
): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  const key = descriptor.values ? JSON.stringify(value) : String(value);
  return modelOptionChoices(descriptor).find((choice) => choice.id === key)?.label ?? String(value);
}

/** What the Agent editor's Worker picker shows for the draft Worker. */
export type WorkerTrigger =
  | { readonly state: "needs-model"; readonly label: "Needs a model" }
  /** `unknown`: T3 has not supplied the display names. */
  | { readonly state: "ok" | "unknown"; readonly label: string };

/**
 * The Worker's display summary, “Provider · Model · Effort”. The draft never holds a selection T3
 * no longer offers (it is cleared on open), so a complete selection always resolves while T3's
 * capabilities are known.
 */
export function workerTrigger(
  execution: AgentExecutionSettings,
  capabilities: AgentCapabilities | null,
): WorkerTrigger {
  if (!execution.environmentId || !execution.providerInstanceId || !execution.modelId)
    return { state: "needs-model", label: "Needs a model" };
  if (capabilities?.state !== "ready")
    return { state: "unknown", label: "Worker details unavailable" };
  const { provider, model } = resolveAgentModel(execution, capabilities);
  const environment = capabilities.environments.find(
    (item) => item.environmentId === execution.environmentId,
  );
  if (!model || !environment) return { state: "needs-model", label: "Needs a model" };
  const descriptor = model.options?.[0];
  const effort =
    descriptor?.type === "select"
      ? modelOptionLabel(descriptor, optionValue(execution.modelOptions, descriptor))
      : "";
  const label = [
    provider?.displayName ?? "Unknown provider",
    model.label ?? "Unknown model",
    effort,
  ]
    .filter(Boolean)
    .join(" · ");
  return { state: "ok", label };
}

/** The provider, model and effort of saved execution settings in display names; empty for none. */
export function agentRuntimeMeta(
  execution: AgentExecutionSettings | null,
  capabilities: AgentCapabilities | null,
): string {
  if (!execution) return "";
  const shown = workerTrigger(execution, capabilities);
  return shown.state === "needs-model" ? "" : shown.label;
}
