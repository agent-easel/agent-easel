import {
  connectionFooterText,
  connectionStatusLabel,
  type ConnectionPresentation,
} from "./connection-state.tsx";
import type { reportingSummary } from "./reporting-state.tsx";
import type { FactoryConnectionNotice } from "./client-gate.tsx";
import { clockTimeWithSeconds } from "./time-format.ts";

export interface SidebarFooterState {
  readonly factory: FactoryConnectionNotice | null;
  readonly presentation: ConnectionPresentation;
  readonly reporting: ReturnType<typeof reportingSummary>;
  readonly configured: boolean;
}

export type SidebarFooterTone = "connection" | "attention" | "checking" | "error";

export interface SidebarFooterIndicator {
  readonly label: string;
  readonly text: string;
  readonly tone: SidebarFooterTone;
  readonly tab: "connection" | "agent-reporting";
  readonly signal: boolean;
  readonly status: boolean;
}

function t3Indicator({
  presentation,
  reporting,
  configured,
}: SidebarFooterState): SidebarFooterIndicator {
  const quiet = { status: false, tab: "connection" as const };
  if (!configured) return { ...quiet, label: "", text: "", tone: "connection", signal: false };
  if (presentation !== "ready" || reporting.state === "installed")
    return {
      ...quiet,
      label: connectionStatusLabel(presentation),
      text: connectionFooterText(presentation),
      tone: "connection",
      signal: true,
    };
  const needsAttention = reporting.state === "attention";
  return {
    ...quiet,
    label: reporting.label,
    text: reporting.message,
    tone: needsAttention ? "attention" : "checking",
    tab: needsAttention ? "agent-reporting" : "connection",
    signal: true,
  };
}

export function sidebarFooterIndicator(state: SidebarFooterState): SidebarFooterIndicator {
  const t3 = t3Indicator(state);
  const { factory } = state;
  if (factory?.kind === "offline")
    return {
      ...t3,
      label: "Offline",
      text:
        factory.observedAt === null
          ? "Offline"
          : `Offline · last observed ${clockTimeWithSeconds(factory.observedAt)}`,
      tone: "error",
      signal: true,
      status: true,
    };
  if (factory?.kind === "synchronizing")
    return {
      ...t3,
      label: "Synchronizing",
      text: "Synchronizing…",
      tone: "checking",
      signal: true,
      status: true,
    };
  return t3;
}
