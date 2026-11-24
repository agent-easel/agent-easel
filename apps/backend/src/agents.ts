import { optionAvailability, resolveAgentModel } from "@agent-easel/domain-validation";
import type { T3ProviderCapability } from "./t3/projects.ts";
import { providerReporting } from "./reporting-drivers.ts";
import type { VibeReportingLookup } from "./reporting-discovery.ts";
import { failure } from "./result.ts";
import type {
  AgentCapabilities,
  AgentExecutionSettingsStatus,
  AgentExecutionSettings,
  AgentSettingStatus,
  Result,
} from "@agent-easel/contracts";

/**
 * A save may not choose a provider T3 offers but Factory cannot take reports from, as Studio's
 * menu prevents. Providers T3 does not list right now are an availability matter for settings
 * status, not a save error, and an Agent without a model chooses no provider.
 */
export function unsupportedReportingFailure(
  execution: AgentExecutionSettings | null,
  capabilities: AgentCapabilities,
): Result<never> | undefined {
  if (execution === null) return undefined;
  const provider = capabilities.providers.find(
    (entry) => entry.providerInstanceId === execution.providerInstanceId,
  );
  if (!provider || provider.reporting.supported) return undefined;
  return failure("validation", provider.reporting.explanation, [
    {
      code: "harness_unsupported",
      path: "execution.providerInstanceId",
      message: "Choose a provider whose reporting is supported in Agent capabilities.",
    },
  ]);
}

export function agentSettingsStatus(
  execution: AgentExecutionSettings,
  capabilities: AgentCapabilities | null,
): AgentExecutionSettingsStatus {
  if (!capabilities || capabilities.state !== "ready") {
    const unknown = (explanation?: string): AgentSettingStatus => ({
      state: "unknown",
      ...(explanation ? { explanation } : {}),
    });
    const explanation = capabilities?.explanation;
    return {
      environment: unknown(explanation),
      provider: unknown(explanation),
      model: unknown(explanation),
      options: execution.modelOptions.map((option) => ({
        id: option.id,
        state: "unknown" as const,
      })),
    };
  }
  const environmentKnown = capabilities.environments.some(
    (entry) => entry.environmentId === execution.environmentId,
  );
  const { provider, model } = environmentKnown ? resolveAgentModel(execution, capabilities) : {};
  return {
    environment: environmentKnown
      ? { state: "available" }
      : {
          state: "unavailable",
          explanation: "This environment is not available from T3 right now.",
        },
    provider: provider
      ? { state: "available" }
      : {
          state: "unavailable",
          explanation: "This provider is not offered for the selected environment.",
        },
    model: model
      ? { state: "available" }
      : {
          state: "unavailable",
          explanation: "This model is not offered for the selected provider.",
        },
    options: execution.modelOptions.map((option) => ({
      id: option.id,
      state: optionAvailability(model, option),
    })),
  };
}

export function emptyCapabilities(explanation: string, checkedAt: string): AgentCapabilities {
  return {
    state: "unavailable",
    explanation,
    checkedAt,
    environments: [],
    providers: [],
  };
}

export function readyCapabilities(
  environments: AgentCapabilities["environments"],
  providers: readonly T3ProviderCapability[],
  checkedAt: string,
  vibe: VibeReportingLookup | undefined,
): AgentCapabilities {
  return {
    state: "ready",
    explanation: "Provider, model and thinking options come from the live T3 catalog.",
    checkedAt,
    environments,
    providers: providers.map((provider) => ({
      ...provider,
      reporting:
        provider.driverKind === "acpRegistry" && vibe?.problem
          ? { supported: false, explanation: vibe.problem }
          : providerReporting(
              provider.driverKind === "acpRegistry" &&
                vibe?.instances?.has(provider.providerInstanceId)
                ? "mistral-vibe"
                : provider.driverKind,
            ),
    })),
  };
}
