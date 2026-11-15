import { flowGraphReferencesAgent, resolveAgentModel } from "@t3-factory/domain-validation";
import type { AgentCapabilities, AgentExecutionSettings, FlowDraft } from "@t3-factory/contracts";

export function flowUsageCount(flows: readonly FlowDraft[], agentId: string): number {
  return flows.filter((flow) => flowGraphReferencesAgent(flow.graph, agentId)).length;
}

export function flowUsageLabel(count: number): string {
  if (count === 0) return "Unused";
  if (count === 1) return "1 Flow";
  return `${count} Flows`;
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
