import * as Effect from "effect/Effect";
import type {
  AgentExecutionSettings,
  ReportingInstallation,
  Result,
  RuntimeReadiness,
} from "@agent-easel/contracts";

/**
 * Why Factory MCP is not installed for this provider instance's harness, or undefined when it is.
 * Installation is a prerequisite, not proof of live tool visibility or attribution.
 * `chooseProviderIn` names where the caller's provider is chosen, such as "Studio → Agents".
 */
export function reportingInstallationProblem(
  providerInstanceId: string,
  targets: Result<readonly ReportingInstallation[]>,
  chooseProviderIn: string,
): string | undefined {
  const target = targets.ok
    ? (targets.value.find((target) => target.instances.includes(providerInstanceId)) ??
      targets.value.find((target) => target.kind !== "instance"))
    : undefined;
  if (target?.status === "installed") return undefined;
  return !targets.ok
    ? targets.error.message
    : target?.status === "needs-attention" || target?.status === "unsupported"
      ? target.message
      : !target
        ? `Agent reporting lists no installation for this provider. If the provider is disabled in T3 Code, enable it there and recheck, or choose another provider in ${chooseProviderIn}.`
        : "Install AgentEasel MCP for this provider's effective home in Settings → Agent reporting, then start a fresh session.";
}

export const explicitReadiness = Effect.fn(function* (
  readiness: Result<RuntimeReadiness>,
  execution: AgentExecutionSettings,
  installations: () => Effect.Effect<Result<readonly ReportingInstallation[]>, unknown>,
): Generator<Effect.Effect<unknown, unknown>, Result<RuntimeReadiness>, never> {
  if (!readiness.ok) return readiness;
  const message = reportingInstallationProblem(
    execution.providerInstanceId,
    yield* installations(),
    "Studio → Agents",
  );
  if (message === undefined) return readiness;
  return {
    ok: true,
    value: {
      ...readiness.value,
      ready: false,
      issues: [
        ...readiness.value.issues,
        {
          code: "reporting_installation",
          path: "runtime",
          message,
        },
      ],
    },
  };
});
