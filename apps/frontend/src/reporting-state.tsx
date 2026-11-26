import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { CircleDashed, type LucideIcon } from "lucide-react";
import type { AgentDefinition, ReportingInstallation } from "@agent-easel/contracts";
import type { SettingKind } from "./components/status-badge.tsx";
import { api, ApiError } from "./api.ts";
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
    return {
      state: "checking",
      label: "Checking reporting…",
      message: "",
      launchSkill: null,
    };
  const target =
    targets.find((target) => target.instances.includes(providerInstanceId)) ??
    targets.find((target) => target.kind !== "instance");
  if (!target)
    return {
      state: "attention",
      label: "Reporting not configured",
      launchSkill: null,
      message:
        "AgentEasel could not find a reporting installation for this provider. Check Agent reporting before starting a Run.",
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

/** One request for the list to answer for `key`; every request is its own read generation. */
type ScopeRequest = { readonly key: string };

type ReportingInstallState = {
  running: string | null;
  failures: Readonly<Record<string, string>>;
  install: (targets: readonly ReportingInstallation[]) => Promise<readonly string[]>;
  recheck: () => Promise<readonly string[]>;
};

const ReportingStateContext = createContext<
  | (ReportingReads &
      ReportingInstallState & {
        refresh: () => Promise<void>;
        /**
         * Reads the list again for `key`, such as the ready T3 connection and the harnesses it
         * keeps off; null means nothing the list can answer for yet. Each call is a new request,
         * so an answer read for an earlier call never counts for a later one, even with the same key.
         */
        refreshFor: (key: string | null) => Promise<void>;
        /** The key of the latest request, once a read started under that request has applied. */
        answeredFor: string | null;
        /** A read requested since `targets` applied is outstanding, so they may be out of date. */
        refreshing: boolean;
        readDetails: string;
      })
  | null
>(null);

/** Shared by Agent definitions, reporting setup and the Settings indicator. */
export function ReportingStateProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState<readonly ReportingInstallation[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [requested, setRequested] = useState<ScopeRequest | null>(null);
  const [answered, setAnswered] = useState<ScopeRequest | null>(null);
  const installing = useRef(false);
  const latestRequest = useRef<ScopeRequest | null>(null);
  const agents = useLiveStudio().value?.agents ?? null;
  const {
    failure,
    pending: refreshing,
    refresh,
    supersede,
  } = useRefreshSchedule({
    read: async () => {
      const readFor = latestRequest.current;
      return { readFor, targets: await api.getReportingInstallations() };
    },
    apply: ({ readFor, targets }) => {
      setTargets(targets);
      setAnswered(readFor === latestRequest.current ? readFor : null);
    },
    intervalMs: 30_000,
  });
  const refreshFor = useCallback(
    async (key: string | null) => {
      const request = key === null ? null : { key };
      latestRequest.current = request;
      setRequested(request);
      if (request) await refresh();
    },
    [refresh],
  );
  const answeredFor = answered !== null && answered === requested ? answered.key : null;
  const reads: ReportingReads = failure
    ? {
        targets: null,
        agents,
        error:
          "AgentEasel could not check Agent reporting. Check that AgentEasel is running, then check again.",
      }
    : { targets, agents, error: "" };
  const installHome = async (target: ReportingInstallation): Promise<readonly string[]> => {
    setRunning(target.id);
    return api.installReporting({ targetId: target.id }).then(
      (installed) => {
        supersede();
        setTargets(
          (current) =>
            current?.map((item) => (item.id === installed.id ? installed : item)) ?? current,
        );
        setFailures((current) => {
          const remaining = { ...current };
          delete remaining[target.id];
          return remaining;
        });
        return installed.diagnosticAttempts ?? [];
      },
      (cause: unknown) => {
        setFailures((current) => ({ ...current, [target.id]: String(cause) }));
        return cause instanceof ApiError ? (cause.detail.diagnosticAttempts ?? []) : [];
      },
    );
  };
  const install = async (selection: readonly ReportingInstallation[]) => {
    if (installing.current || !selection.length) return [];
    installing.current = true;
    const run = async () => {
      const attempts: string[] = [];
      for (const target of selection) attempts.push(...(await installHome(target)));
      await refresh();
      return attempts;
    };
    return run().finally(() => {
      setRunning(null);
      installing.current = false;
    });
  };
  const recheck = async () => {
    const rechecked = await api.recheckReporting();
    supersede();
    setTargets(rechecked.installations);
    return rechecked.diagnosticAttempts ?? [];
  };
  const readDetails = failure ? String(failure.cause) : "";
  return (
    <ReportingStateContext.Provider
      value={{
        ...reads,
        refresh,
        refreshFor,
        answeredFor,
        refreshing,
        readDetails,
        running,
        failures,
        install,
        recheck,
      }}
    >
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
    : {
        state: "installed",
        label: "Reporting installed",
        message: "",
        launchSkill: null,
      };
}

export const providerNames: Readonly<Record<string, string>> = {
  antigravity: "Antigravity",
  claudeAgent: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  "mistral-vibe": "Mistral Vibe",
};

/** A harness's name in Factory, from its T3 provider driver. */
export const providerName = (provider: string) => providerNames[provider] ?? provider;

/** A target the reporting install can act on now: Install, or Repair of Factory's own entry. */
export const installable = (target: ReportingInstallation) =>
  target.actions.install || target.actions.repair;

export interface TargetStatus {
  kind: SettingKind;
  label: string;
  badge?: { icon: LucideIcon };
}

const statuses: Record<ReportingInstallation["status"], TargetStatus> = {
  "not-installed": {
    label: "Not installed",
    kind: "attention",
    badge: { icon: CircleDashed },
  },
  installed: { label: "Installed", kind: "success" },
  "needs-attention": { label: "Needs attention", kind: "attention" },
  unsupported: { label: "Not available", kind: "neutral" },
};

/** A harness row's status badge, including an install running or failed in this session. */
export function targetStatus(
  target: ReportingInstallation,
  running: boolean,
  failed: boolean,
): TargetStatus {
  if (running)
    return {
      kind: "checking",
      label: target.actions.repair ? "Repairing…" : "Installing…",
    };
  if (failed) return { kind: "error", label: "Install failed" };
  return statuses[target.status];
}
