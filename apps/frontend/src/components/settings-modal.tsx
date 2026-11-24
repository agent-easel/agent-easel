import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Monitor,
  BotMessageSquare,
  ImageIcon,
  Keyboard,
  Lock,
  MonitorSmartphone,
  MessagesSquare,
  Palette,
  Plug,
  RadioTower,
  Search,
  Sparkle,
  X,
  type LucideIcon,
} from "lucide-react";
import { fixedShortcutRows, shortcutDefinitions } from "../keyboard-shortcuts.ts";
import { api } from "../api.ts";
import { KeyboardSettings } from "./keyboard-settings.tsx";
import { AccessSettings, DeviceAccessProvider, usePendingDeviceCount } from "./access-settings.tsx";
import { AppearanceSettings } from "./appearance-settings.tsx";
import { DesktopAppSettings } from "./desktop-app-settings.tsx";
import { RunImageSettings } from "./run-image-settings.tsx";
import { RunTitleSettings } from "./run-title-settings.tsx";
import { ChatModelSettings } from "./chat-model-settings.tsx";
import { ChatDiscordSettings } from "./chat-discord-settings.tsx";
import { useChatModelAttention, useDiscordAttention } from "../chat-control-attention.ts";
import { useClientScope } from "../client-scope.ts";
import { desktopBridge } from "../desktop-bridge.ts";
import { RuntimeSettings } from "../routes/runtime.tsx";
import { providerNames, reportingTargetsMarker, useReportingState } from "../reporting-state.tsx";
import { SettingsPanel } from "./screen-layout.tsx";
import { ConnectionSettingsPanel } from "../routes/connection.tsx";
import {
  ConnectionStateDot,
  connectionStatusLabel,
  settingsConnectionPresentation,
  useConnectionState,
} from "../connection-state.tsx";
import {
  useSettings,
  useSettingsNavigation,
  type SettingsSelection,
} from "../settings-navigation.ts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogSurface } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NavRow } from "@/components/ui/nav-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SettingsLink } from "./app-link.tsx";
import { WorkspaceDialogHeader } from "./workspace-dialog-header.tsx";

type ClientScope = ReturnType<typeof useClientScope>;

/** Settings are grouped by whose settings they are: the whole Factory, its Runs or this device. */
const settingsGroups = [
  { id: "factory", label: "Factory" },
  { id: "chat", label: "Chat control" },
  { id: "runs", label: "Runs" },
  { id: "device", label: "This device" },
] as const;

type SettingsSection = {
  tab: SettingsSelection["tab"];
  label: string;
  icon: LucideIcon;
  rowLabels: readonly string[];
  group: (typeof settingsGroups)[number]["id"];
  /** Where the section applies; absent sections are not listed at all. */
  visibility?: "desktop" | "host";
  /** Changed only on the Factory host; other clients see it locked and read-only. */
  managedOnHost?: boolean;
  content: () => ReactNode;
};

/** Settings sections in nav order; Flows and Agents live in Studio. */
const settingsSections: readonly SettingsSection[] = [
  {
    tab: "connection",
    rowLabels: ["Connection", "Address", "T3 version", "Authorization", "Last checked"],
    label: "T3 connection",
    icon: Plug,
    group: "factory",
    content: () => <ConnectionSettingsPanel />,
  },
  {
    tab: "agent-reporting",
    rowLabels: ["Harnesses", ...Object.values(providerNames)],
    label: "Agent reporting",
    icon: RadioTower,
    group: "factory",
    content: () => <RuntimeSettings />,
  },
  {
    tab: "devices",
    rowLabels: [
      "Devices",
      "Remote access",
      "Allow approved devices on my LAN or tailnet",
      "Address",
      "CA fingerprint",
      "Desktop link",
      "Browser certificate",
    ],
    label: "Devices & access",
    icon: MonitorSmartphone,
    group: "factory",
    visibility: "host",
    content: () => <AccessSettings />,
  },
  {
    tab: "chat-model",
    rowLabels: ["Connection", "Provider", "Base URL", "Model", "API key", "Last tested"],
    label: "Language model",
    icon: BotMessageSquare,
    group: "chat",
    visibility: "host",
    content: () => <ChatModelSettings />,
  },
  {
    tab: "chat-discord",
    rowLabels: [
      "Chat control",
      "Public key",
      "Bot token",
      "Bot",
      "Access",
      "Users",
      "Channels",
      "Projects",
      "Delivery",
    ],
    label: "Discord",
    icon: MessagesSquare,
    group: "chat",
    visibility: "host",
    content: () => <ChatDiscordSettings />,
  },
  {
    tab: "run-titles",
    rowLabels: [
      "Generate Run titles",
      "Generation",
      "Worker",
      "Provider",
      "Model",
      "Latest result",
    ],
    label: "Run titles",
    icon: Sparkle,
    group: "runs",
    managedOnHost: true,
    content: () => <RunTitleSettings />,
  },
  {
    tab: "run-images",
    rowLabels: ["Project", "Used by", "Delete all"],
    label: "Run images",
    icon: ImageIcon,
    group: "runs",
    content: () => <RunImageSettings />,
  },
  {
    tab: "appearance",
    rowLabels: ["Mode", "Light", "Dark", "Color theme", "Theme config", "Custom colors"],
    label: "Appearance",
    icon: Palette,
    group: "device",
    content: () => <AppearanceSettings />,
  },
  {
    tab: "keyboard",
    rowLabels: [
      "Fixed",
      ...shortcutDefinitions.map((command) => command.label),
      ...fixedShortcutRows().map((row) => row.label),
    ],
    label: "Keyboard shortcuts",
    icon: Keyboard,
    group: "device",
    content: () => <KeyboardSettings />,
  },
  {
    tab: "desktop",
    rowLabels: [
      "Updates",
      "Version",
      "Release channel",
      "Last checked",
      "Startup",
      "Open in the background at login",
      "Show in the menu bar",
      "Notifications",
      "Notify when a Run finishes",
      "Dock badge",
      "Run details in notifications",
      "macOS permission",
      "Role",
      "Server",
    ],
    label: "Desktop app",
    icon: Monitor,
    group: "device",
    visibility: "desktop",
    content: () => <DesktopAppSettings />,
  },
];
const defaultSection = settingsSections[0]!;

function sectionApplies(section: SettingsSection, scope: ClientScope) {
  if (section.visibility === "host") return scope === "host";
  if (section.visibility === "desktop") return !!desktopBridge();
  return true;
}

function matchingSections(
  sections: readonly SettingsSection[],
  query: string,
  extraLabels: Partial<Record<SettingsSection["tab"], readonly string[]>>,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections.filter((section) =>
    [section.label, ...section.rowLabels, ...(extraLabels[section.tab] ?? [])].some((label) =>
      label.toLowerCase().includes(needle),
    ),
  );
}

/**
 * Run titles shows one row per option of the chosen Worker, and those labels come from T3's
 * capabilities. They are read again when a search starts and whenever the T3 connection changes
 * during one, so a search that stays open while T3 recovers matches the rows the Run titles pane
 * shows. Until a read answers, the last labels stay.
 */
function useWorkerOptionLabels(searching: boolean) {
  const { presentation } = useConnectionState();
  const [labels, setLabels] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!searching) return;
    let active = true;
    api.getAgentCapabilities().then(
      (capabilities) => {
        if (!active) return;
        const names = capabilities.providers.flatMap((provider) =>
          provider.models.flatMap((model) => model.options?.map((option) => option.label) ?? []),
        );
        setLabels([...new Set(names)]);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [searching, presentation]);
  return labels;
}

/** Figma Settings/ModalShell: breadcrumb header, section nav and the selected section's pane. */
export function SettingsModal() {
  const openSettings = useSettingsNavigation();
  const [query, setQuery] = useState("");
  const selection = useSettings();
  const scope = useClientScope();
  const sections = settingsSections.filter((section) => sectionApplies(section, scope));
  const current = sections.find((section) => section.tab === selection?.tab) ?? defaultSection;
  const origin = sections.find((section) => section.tab === selection?.from);
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const close = () => void openSettings(origin && { tab: origin.tab });
  const dialog = (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogSurface
        data-settings="true"
        presentation="workspace"
        className="flex h-[calc(100vh-32px)] w-[calc(100vw-32px)] flex-col overflow-hidden bg-background [@media(min-width:1024px)_and_(min-height:720px)]:h-[clamp(560px,80vh,960px)] [@media(min-width:1024px)_and_(min-height:720px)]:w-[clamp(840px,50vw,1280px)]"
        ref={content}
        onOpenAutoFocus={(event) => {
          // Land on the dialog itself, not the header Close button, so opening shows no focus ring.
          event.preventDefault();
          content.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          // While the nav search is filled, Esc clears it first; the next Esc closes Settings.
          if (query) {
            event.preventDefault();
            setQuery("");
          }
        }}
      >
        <WorkspaceDialogHeader
          title="Settings"
          className="h-12 bg-card"
          section={current.label}
          description="Settings for the whole Factory, its Runs and this device."
          onClose={close}
        />
        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <SettingsNav
            sections={sections}
            current={current}
            query={query}
            searchRef={search}
            onQueryChange={setQuery}
          />
          {/* One keyed list, so the origin stays mounted beneath with its unsaved edits. */}
          {(origin ? [origin, current] : [current]).map((section) => (
            <SettingsPanel key={section.tab} hidden={section !== current}>
              {section.content()}
            </SettingsPanel>
          ))}
        </div>
      </DialogSurface>
    </Dialog>
  );
  return scope === "host" ? <DeviceAccessProvider>{dialog}</DeviceAccessProvider> : dialog;
}

function SettingsNav({
  sections,
  current,
  query,
  searchRef,
  onQueryChange,
}: {
  sections: readonly SettingsSection[];
  current: SettingsSection;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
}) {
  const workerOptionLabels = useWorkerOptionLabels(query.trim() !== "");
  const visible = matchingSections(sections, query, { "run-titles": workerOptionLabels });
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar px-2 py-3 max-sm:max-h-[40%] max-sm:w-full max-sm:border-r-0 max-sm:border-b">
      <SettingsSearchField inputRef={searchRef} value={query} onChange={onQueryChange} />
      <nav aria-label="Settings sections" className="grid gap-0.5">
        {settingsGroups.map((group) => {
          const grouped = visible.filter((section) => section.group === group.id);
          if (grouped.length === 0) return null;
          return (
            <div key={group.id} role="group" aria-label={group.label} className="grid gap-0.5">
              <p aria-hidden className="pt-3 pb-1 pl-2 text-xs text-subtle-foreground">
                {group.label}
              </p>
              {grouped.map((section) => (
                <SettingsNavItem
                  key={section.tab}
                  section={section}
                  active={section.tab === current.tab}
                />
              ))}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p role="status" className="px-2 pt-3 text-sm text-muted-foreground">
            No settings match “{query.trim()}”.
          </p>
        )}
      </nav>
    </aside>
  );
}

/** Why a section needs action, from data Settings already reads; undefined when it does not. */
function useSectionAttention(tab: SettingsSection["tab"]) {
  const reportingMarker = reportingTargetsMarker(useReportingState());
  const pendingDevices = usePendingDeviceCount();
  const discordAttention = useDiscordAttention(tab === "chat-discord");
  const modelAttention = useChatModelAttention(tab === "chat-model");
  if (tab === "agent-reporting") return reportingMarker;
  const chatAttention =
    tab === "chat-discord" ? discordAttention : tab === "chat-model" ? modelAttention : null;
  if (chatAttention === "error") return "failing";
  if (chatAttention === "attention") return "needs attention";
  if (tab === "devices" && pendingDevices > 0)
    return `${pendingDevices} ${pendingDevices === 1 ? "device" : "devices"} waiting for approval`;
  return undefined;
}

function SettingsNavItem({ section, active }: { section: SettingsSection; active: boolean }) {
  const { connection, presentation: state } = useConnectionState();
  const presentation = settingsConnectionPresentation(connection, state);
  const status = connectionStatusLabel(presentation);
  const attention = useSectionAttention(section.tab);
  const scope = useClientScope();
  const locked = section.managedOnHost === true && scope === "remote";
  let marker = attention;
  if (section.tab === "connection") marker = status;
  else if (!attention && locked) marker = "Managed on the Factory host";
  const Icon = section.icon;
  return (
    <NavRow asChild density="compact" selected={active}>
      <SettingsLink
        selection={{ tab: section.tab }}
        aria-label={marker ? `${section.label}, ${marker}` : section.label}
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <span className="min-w-0 flex-1 truncate">{section.label}</span>
        {section.tab === "connection" && (
          <ConnectionStateDot presentation={presentation} label={status} />
        )}
        {attention && (
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              attention === "failing" ? "bg-destructive" : "bg-attention",
            )}
          />
        )}
        {locked && (
          <Lock
            aria-hidden
            className="size-3.5 shrink-0 text-subtle-foreground"
            strokeWidth={1.5}
          />
        )}
      </SettingsLink>
    </NavRow>
  );
}

/** Nav search over section labels; Escape in the field clears it. */
function SettingsSearchField({
  inputRef,
  value,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative shrink-0">
      <Search
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground"
      />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search settings"
        placeholder="Search settings"
        className={cn("bg-muted pl-8 [&::-webkit-search-cancel-button]:hidden", value && "pr-8")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 size-5 -translate-y-1/2 text-muted-foreground"
              onClick={() => {
                onChange("");
                inputRef.current?.focus();
              }}
            >
              <X aria-hidden strokeWidth={1.5} className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent shortcut="Esc">Clear search</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
