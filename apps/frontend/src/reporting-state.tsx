import { createContext, useContext, useState, type ReactNode } from "react";
import type { AgentDefinition, ReportingInstallation } from "@t3-factory/contracts";
import { api } from "./api.ts";
import { useLiveStudio } from "./live/studio.ts";
import { useRefreshSchedule } from "./refresh-schedule.ts";

interface ReportingReads {
  targets: readonly ReportingInstallation[] | null;
  agents: readonly AgentDefinition[] | null;
  error: string;
}

interface ReportingStatus {
  launchSkill: ReportingInstallation["launchSkill"];
  state: "checking" | "attention" | "installed";
  label: string;
  message: string;
}

/** Configuration only: an installed Factory MCP entry is not evidence that a live worker can report. */
export function agentReportingStatus(
  providerInstanceId: string,
  { targets, error }: Pick<ReportingReads, "targets" | "error">,
): ReportingStatus {
  if (error)
    return {
      state: "attention",
      label: "Reporting status unavailable",
      message: error,
      launchSkill: null,
    };
  if (!targets)
    return { state: "checking", label: "Checking reporting…", message: "", launchSkill: null };
  const target =
    targets.find((target) => target.instances.includes(providerInstanceId)) ??
    targets.find((target) => target.instances.length === 0 && target.status === "needs-attention");
  if (!target)
    return {
      state: "attention",
      label: "Reporting not configured",
      launchSkill: null,
      message:
        "Factory could not find a reporting installation for this provider. Check Agent reporting before starting a Run.",
    };
  if (target.status === "installed")
    return {
      state: "installed",
      label: "Reporting installed",
      message: target.message,
      launchSkill: target.launchSkill,
    };
  return {
    state: "attention",
    launchSkill: target.launchSkill,
    label:
      target.status === "not-installed" ? "Reporting not installed" : "Reporting needs attention",
    message: target.message,
  };
}

const ReportingStateContext = createContext<
  (ReportingReads & { refresh: () => Promise<void> }) | null
>(null);

/** Shared by Agent definitions, reporting setup and the Settings indicator. */
export function ReportingStateProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<readonly ReportingInstallation[] | null>(null);
  const agents = useLiveStudio().value?.agents ?? null;
  const { failure, refresh } = useRefreshSchedule({
    read: api.getReportingInstallations,
    apply: setTargets,
    intervalMs: 30_000,
  });
  const reads: ReportingReads = failure
    ? {
        targets: null,
        agents,
        error: "Factory could not check Agent reporting. Recheck the installation in Settings.",
      }
    : { targets, agents, error: "" };
  return (
    <ReportingStateContext.Provider value={{ ...reads, refresh }}>
      {children}
    </ReportingStateContext.Provider>
  );
}

export function useReportingState() {
  const value = useContext(ReportingStateContext);
  if (!value) throw new Error("useReportingState requires ReportingStateProvider");
  return value;
}

/** A harness configuration that needs Install or Repair, whether or not an Agent uses it yet. */
export function targetNeedsAttention(target: ReportingInstallation) {
  return target.status === "not-installed" || target.status === "needs-attention";
}

/** The Agent reporting nav marker: a failed read or any target needing install or repair. */
export function reportingTargetsMarker({
  targets,
  error,
}: Pick<ReportingReads, "targets" | "error">): string | undefined {
  if (error) return agentReportingStatus("", { targets, error }).label;
  return targets?.some(targetNeedsAttention) ? "Needs attention" : undefined;
}

export function reportingSummary(reads: ReportingReads): ReportingStatus {
  if (reads.error || !reads.targets) return agentReportingStatus("", reads);
  // Installations may arrive before the Studio scope's first Agents.
  if (!reads.agents) return agentReportingStatus("", { targets: null, error: "" });
  const needsAttention = reads.agents.some(
    (agent) =>
      agent.execution !== null &&
      agentReportingStatus(agent.execution.providerInstanceId, reads).state !== "installed",
  );
  return needsAttention
    ? {
        state: "attention",
        label: "Agent reporting needs attention",
        message: "Agent reporting needs attention",
        launchSkill: null,
      }
    : { state: "installed", label: "Reporting installed", message: "", launchSkill: null };
}
