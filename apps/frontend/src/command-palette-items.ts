import type { LucideIcon } from "lucide-react";
import { Bot, Play, Settings, Workflow } from "lucide-react";
import type {
  AgentDefinition,
  FlowDraft,
  RunNavigationEntry,
  StudioDefinitions,
} from "@t3-factory/contracts";
import type { useNavigate } from "@tanstack/react-router";
import type { LiveScopeView } from "./live/owner.ts";
import type { useOpenStudio, useSettingsNavigation } from "./settings-navigation.ts";
import type { ShortcutId } from "./keyboard-shortcuts.ts";

export const paletteActionShortcut: Partial<Record<string, ShortcutId>> = {
  "action-new-run": "newRun",
  "action-settings": "settings",
  "action-studio-flows": "studio",
  "action-studio-agents": "studio",
};

export type PaletteItem = {
  id: string;
  kind: "run" | "flow" | "agent" | "action";
  number?: number | null;
  label: string;
  detail?: string;
  icon: LucideIcon;
  keywords: string;
  run: () => void;
};

type Navigate = ReturnType<typeof useNavigate>;

/** The palette opens Studio and Settings only through the settings navigation. */
export type PaletteNavigation = {
  openStudio: ReturnType<typeof useOpenStudio>;
  openSettings: ReturnType<typeof useSettingsNavigation>;
};

/**
 * The palette's items from the navigation and Studio scopes, with each scope's state named by the
 * sections it supplies: unread, cached while not current, or refused. Cached items stay listed.
 */
export function paletteCatalog(
  navigation: LiveScopeView<readonly RunNavigationEntry[]>,
  studio: LiveScopeView<StudioDefinitions>,
) {
  const scopes = [
    { view: navigation, names: ["Runs"] },
    { view: studio, names: ["Flows", "Agents"] },
  ];
  const named = (state: (view: LiveScopeView<unknown>) => boolean) =>
    scopes.filter(({ view }) => state(view)).flatMap(({ names }) => names);
  const pending = (view: LiveScopeView<unknown>) => !view.synchronized && !view.error;
  return {
    loading: named((view) => view.value === null && pending(view)),
    synchronizing: named((view) => view.value !== null && pending(view)),
    refused: named((view) => view.error !== null),
    runs: navigation.value ?? [],
    flows: studio.value?.flows ?? [],
    agents: studio.value?.agents ?? [],
  };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

export function paletteMatchesQuery(item: PaletteItem, query: string) {
  const q = normalize(query);
  if (!q) return true;
  if (q.startsWith(">")) {
    if (item.kind === "action") return normalize(item.label).includes(q.slice(1).trim());
    return false;
  }
  const haystack = `${item.label} ${item.detail ?? ""} ${item.keywords}`.toLowerCase();
  return (
    (item.kind === "run" &&
      typeof item.number === "number" &&
      q.replace(/^#/, "") === String(item.number)) ||
    haystack.includes(q)
  );
}

export function buildPaletteItems(input: {
  navigate: Navigate;
  navigation: PaletteNavigation;
  onNewRun: () => void;
  runs: readonly RunNavigationEntry[];
  flows: readonly FlowDraft[];
  agents: readonly AgentDefinition[];
}): PaletteItem[] {
  const { navigate, navigation, onNewRun, runs, flows, agents } = input;
  const { openStudio, openSettings } = navigation;
  const actions: PaletteItem[] = [
    {
      id: "action-new-run",
      kind: "action",
      label: "New Run",
      detail: "Open the Run composer without starting",
      icon: Play,
      keywords: "composer create",
      run: onNewRun,
    },
    {
      id: "action-studio-flows",
      kind: "action",
      label: "Studio · Flows",
      icon: Workflow,
      keywords: "author studio flows list",
      run: () => openStudio({ tab: "flows" }),
    },
    {
      id: "action-studio-agents",
      kind: "action",
      label: "Studio · Agents",
      icon: Bot,
      keywords: "author studio agents list definitions",
      run: () => openStudio({ tab: "agents" }),
    },
    {
      id: "action-settings",
      kind: "action",
      label: "Settings",
      detail: "T3 connection and reporting",
      icon: Settings,
      keywords: "connection reporting preferences",
      run: () => void openSettings({ tab: "connection" }),
    },
  ];
  const runItems = runs.map((run) => ({
    id: `run-${run.id}`,
    kind: "run" as const,
    number: run.number,
    label: run.title,
    detail: run.project.title,
    icon: Play,
    keywords: `run ${run.project.title}`,
    run: () => {
      void navigate({
        to: "/runs/$runId",
        params: { runId: run.id },
        search: {},
        resetScroll: false,
      });
    },
  }));
  const flowItems = flows.map((flow) => ({
    id: `flow-${flow.id}`,
    kind: "flow" as const,
    label: flow.name,
    detail: "Flow",
    icon: Workflow,
    keywords: "flow studio",
    run: () => openStudio({ tab: "flows", flowId: flow.id }),
  }));
  const agentItems = agents.map((agent) => ({
    id: `agent-${agent.id}`,
    kind: "agent" as const,
    label: agent.name,
    detail: "Agent definition",
    icon: Bot,
    keywords: "agent studio definition",
    run: () => openStudio({ tab: "agents", agentId: agent.id }),
  }));
  return [...actions, ...runItems, ...flowItems, ...agentItems];
}
