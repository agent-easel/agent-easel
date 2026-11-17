import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import type { TriggerKind } from "@t3-factory/contracts";

const settingsTabs = [
  "connection",
  "agent-reporting",
  "devices",
  "run-titles",
  "run-images",
  "appearance",
  "keyboard",
  "desktop",
  "chat-model",
  "chat-discord",
] as const;
export type SettingsSelection = { tab: (typeof settingsTabs)[number] };
/** A known Settings section, or undefined for removed and unknown ones. */
function settingsTab(value: unknown): SettingsSelection["tab"] | undefined {
  return settingsTabs.find((tab) => tab === value);
}
export type StudioSelection =
  | { tab: "flows"; flowId?: string }
  | { tab: "agents"; agentId?: string }
  /** `triggerId: "new"` picks the type; adding `kind` opens that type's create form. */
  | { tab: "triggers"; triggerId?: string; kind?: TriggerKind };
export type AppSearch = { settings?: SettingsSelection; studio?: StudioSelection };

function searchRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function studioSelection(value: unknown): StudioSelection | undefined {
  const selection = searchRecord(value);
  if (selection.tab === "flows")
    return {
      tab: "flows",
      ...(typeof selection.flowId === "string" ? { flowId: selection.flowId } : {}),
    };
  if (selection.tab === "agents")
    return {
      tab: "agents",
      ...(typeof selection.agentId === "string" ? { agentId: selection.agentId } : {}),
    };
  if (selection.tab === "triggers") {
    if (typeof selection.triggerId !== "string") return { tab: "triggers" };
    return selection.triggerId === "new" && selection.kind === "github_issues"
      ? { tab: "triggers", triggerId: "new", kind: "github_issues" }
      : { tab: "triggers", triggerId: selection.triggerId };
  }
  return undefined;
}
export function validateAppSearch(search: Record<string, unknown>): AppSearch {
  const studio = studioSelection(search.studio);
  if (studio) return { studio };
  const tab = settingsTab(searchRecord(search.settings).tab);
  return tab ? { settings: { tab } } : {};
}

export function studioMask(selection: StudioSelection) {
  if (selection.tab === "flows")
    return selection.flowId
      ? { to: "/studio/flows/$flowId" as const, params: { flowId: selection.flowId } }
      : { to: "/studio/flows" as const };
  if (selection.tab === "agents")
    return selection.agentId
      ? { to: "/studio/agents/$agentId" as const, params: { agentId: selection.agentId } }
      : { to: "/studio/agents" as const };
  if (selection.kind) return { to: "/studio/triggers/new/github-issues" as const };
  return selection.triggerId
    ? { to: "/studio/triggers/$triggerId" as const, params: { triggerId: selection.triggerId } }
    : { to: "/studio/triggers" as const };
}
export function settingsMask(selection: SettingsSelection) {
  return {
    to: "/settings/$" as const,
    params: {
      _splat:
        selection.tab === "chat-model"
          ? "chat-control/model"
          : selection.tab === "chat-discord"
            ? "chat-control/discord"
            : selection.tab,
    },
  };
}
/** The Settings section a location shows, named by its search or masked path. */
export function settingsTabAt(location: { pathname: string; search: unknown }) {
  return (
    validateAppSearch(searchRecord(location.search)).settings?.tab ??
    settingsTabs.find(
      (tab) => `/settings/${settingsMask({ tab }).params._splat}` === location.pathname,
    )
  );
}
export function useSettings() {
  return useSearch({ from: "__root__", select: (search) => search.settings });
}
export function useStudio() {
  return useSearch({ from: "__root__", select: (search) => search.studio });
}
export function useSettingsOptions(selection: SettingsSelection) {
  const pathname = useLocation({ select: (location) => location.pathname });
  return {
    to: pathname,
    search: { settings: selection },
    mask: settingsMask(selection),
    resetScroll: false,
  };
}
export function useStudioOptions(selection: StudioSelection) {
  const pathname = useLocation({ select: (location) => location.pathname });
  return {
    to: pathname,
    search: { studio: selection },
    mask: studioMask(selection),
    resetScroll: false,
  };
}
export function useStudioNavigation() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (selection: StudioSelection | undefined) =>
    navigate({
      to: pathname,
      search: selection ? { studio: selection } : {},
      ...(selection ? { mask: studioMask(selection) } : {}),
      resetScroll: false,
    });
}
/**
 * Opens Studio from the keyboard or palette. Opening an open Studio again does nothing, so it
 * keeps its selection and history; choosing a Flow or Agent shows it.
 */
export function useOpenStudio() {
  const studioOpen = !!useStudio();
  const navigate = useStudioNavigation();
  return (selection: StudioSelection) => {
    const definition =
      selection.tab === "flows"
        ? selection.flowId
        : selection.tab === "agents"
          ? selection.agentId
          : selection.triggerId;
    if (studioOpen && !definition) return;
    void navigate(selection);
  };
}
export function useSettingsNavigation() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (selection: SettingsSelection | undefined) =>
    navigate({
      to: pathname,
      search: selection ? { settings: selection } : {},
      ...(selection ? { mask: settingsMask(selection) } : {}),
      resetScroll: false,
    });
}
