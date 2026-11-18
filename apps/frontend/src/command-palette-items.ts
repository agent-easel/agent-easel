import type { LucideIcon } from "lucide-react";
import { Bot, ClipboardCheck, Play, Settings, Workflow, Zap } from "lucide-react";
import type {
  AgentDefinition,
  ArchivedRunMatch,
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
};

export type PaletteItem = {
  id: string;
  kind: "run" | "flow" | "agent" | "action";
  number?: number | null;
  label: string;
  detail?: string;
  disabled?: boolean;
  status?: "archived" | "needs-input" | "problem" | undefined;
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
 * sections it supplies. Cached items stay listed while the scopes resynchronize.
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
  if (/^#?\d+$/.test(q)) return item.kind === "run" && String(item.number) === q.replace(/^#/, "");
  const haystack = `${item.label} ${item.detail ?? ""} ${item.keywords}`.toLowerCase();
  return haystack.includes(q);
}

export function buildPaletteGroups(input: {
  navigate: Navigate;
  navigation: PaletteNavigation;
  onNewRun: () => void;
  canStart: boolean;
  query: string;
  archived: readonly ArchivedRunMatch[];
  runs: readonly RunNavigationEntry[];
  flows: readonly FlowDraft[];
  agents: readonly AgentDefinition[];
}) {
  const { navigate, navigation, onNewRun, canStart, runs, archived, flows, agents } = input;
  const { openStudio, openSettings } = navigation;
  const actions: PaletteItem[] = [
    {
      id: "action-new-run",
      kind: "action",
      label: "New Run",
      disabled: !canStart,
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
      id: "action-studio-triggers",
      kind: "action",
      label: "Studio · Triggers",
      icon: Zap,
      keywords: "author studio triggers list",
      run: () => openStudio({ tab: "triggers" }),
    },
    {
      id: "action-settings",
      kind: "action",
      label: "Settings",
      icon: Settings,
      keywords: "t3 connection preferences",
      run: () => void openSettings({ tab: "connection" }),
    },
    {
      id: "action-agent-reporting",
      kind: "action",
      label: "Settings · Agent reporting",
      icon: ClipboardCheck,
      keywords: "t3 reporting preferences",
      run: () => void openSettings({ tab: "agent-reporting" }),
    },
  ];
  const runItem = (run: ArchivedRunMatch, status?: PaletteItem["status"]): PaletteItem => ({
    id: `run-${run.id}`,
    kind: "run",
    number: run.number,
    label: run.title,
    detail: run.projectTitle,
    status,
    icon: Play,
    keywords: "run",
    run: () => {
      void navigate({
        to: "/runs/$runId",
        params: { runId: run.id },
        search: {},
        resetScroll: false,
      });
    },
  });
  const runItems = runs.map((run) =>
    runItem(
      { id: run.id, number: run.number, title: run.title, projectTitle: run.project.title },
      run.attention.problem ? "problem" : run.attention.needsInput ? "needs-input" : undefined,
    ),
  );
  const flowItems = flows.map((flow) => ({
    id: `flow-${flow.id}`,
    kind: "flow" as const,
    label: flow.name,
    icon: Workflow,
    keywords: "flow studio",
    run: () => openStudio({ tab: "flows", flowId: flow.id }),
  }));
  const agentItems = agents.map((agent) => ({
    id: `agent-${agent.id}`,
    kind: "agent" as const,
    label: agent.name,
    icon: Bot,
    keywords: "agent studio definition",
    run: () => openStudio({ tab: "agents", agentId: agent.id }),
  }));
  const matching = (items: readonly PaletteItem[]) =>
    items.filter((item) => paletteMatchesQuery(item, input.query));
  return [
    { name: "Actions", items: matching(actions) },
    {
      name: "Runs",
      items: [...matching(runItems), ...archived.map((run) => runItem(run, "archived"))],
    },
    { name: "Flows", items: matching(flowItems) },
    { name: "Agents", items: matching(agentItems) },
  ].filter((group) => group.items.length > 0);
}
