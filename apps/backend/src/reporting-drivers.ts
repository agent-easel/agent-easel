import type { AgentProviderReporting } from "@agent-easel/contracts";
import { HARNESS_PROFILES, type ReportingDriver } from "./harness-profiles.ts";

export const isReportingDriver = (driverKind: unknown): driverKind is ReportingDriver =>
  typeof driverKind === "string" && Object.hasOwn(HARNESS_PROFILES, driverKind);

export function providerReporting(driverKind: unknown): AgentProviderReporting {
  return isReportingDriver(driverKind)
    ? {
        supported: true,
        explanation: "Reports Block results through Factory MCP once it is installed.",
      }
    : {
        supported: false,
        explanation:
          "Factory reporting is not available for this provider yet. Settings → Agent reporting shows the MCP entry to add once support exists.",
      };
}
