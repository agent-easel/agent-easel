import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ArchivedRunMatch } from "@agent-easel/contracts";
import { Search, Unplug } from "lucide-react";
import { api } from "../api.ts";
import {
  buildPaletteGroups,
  paletteActionShortcut,
  paletteCatalog,
  type PaletteItem,
} from "../command-palette-items.ts";
import { useLiveNavigation } from "../live/navigation.ts";
import { useLiveStudio } from "../live/studio.ts";
import { useOpenStudio, useSettingsNavigation } from "../settings-navigation.ts";
import { useShortcutPreferences } from "../shortcut-preferences.ts";
import { transport, useTransport } from "../transport.ts";
import { RunNumber } from "./run-number.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { Dialog, DialogSurface, DialogDescription, DialogDismiss, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { KeyChip } from "./ui/key-chip";
import { cn } from "@/lib/utils";

function PaletteBadge({ item }: { item: PaletteItem }) {
  if (item.status === "needs-input" || item.status === "problem")
    return <StatusBadge kind={item.status} />;
  if (item.disabled)
    return (
      <StatusBadge kind="neutral" icon={Unplug}>
        Offline
      </StatusBadge>
    );
  return item.status === "archived" && <StatusBadge kind="stopped">Archived</StatusBadge>;
}

function PaletteRow({
  item,
  id,
  active,
  keys,
  onActivate,
  onHover,
}: {
  item: PaletteItem;
  id: string;
  active: boolean;
  keys: string | undefined;
  onActivate: (item: PaletteItem) => void;
  onHover: (id: string) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      aria-disabled={item.disabled}
      disabled={item.disabled}
      className={cn(
        "relative flex min-h-8 w-full items-center gap-2 rounded-sm px-3 py-1 text-left text-sm leading-4 outline-none",
        active &&
          "bg-accent before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:bg-muted-foreground",
        item.disabled && "text-muted-foreground",
      )}
      onMouseMove={item.disabled ? undefined : () => onHover(item.id)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onActivate(item)}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <RunNumber number={item.number ?? null} />
          <span className="truncate font-medium">{item.label}</span>
        </span>
        {item.detail && (
          <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
        )}
      </span>
      <PaletteBadge item={item} />
      {keys && <KeyChip>{keys}</KeyChip>}
    </button>
  );
}

function scopeNames(scopes: readonly string[]) {
  return scopes.length < 2 ? scopes[0] : `${scopes.slice(0, -1).join(", ")} and ${scopes.at(-1)}`;
}

function CatalogStatus({
  loading,
  refused,
  empty,
}: {
  loading: readonly string[];
  refused: readonly string[];
  empty: boolean;
}) {
  return (
    <>
      {loading.length > 0 && (
        <p role="status" className="px-3 py-5 text-center text-sm text-muted-foreground">
          Loading {scopeNames(loading)}…
        </p>
      )}
      {refused.length > 0 && (
        <p role="alert" className="px-3 py-6 text-center text-sm text-destructive">
          Couldn't load {scopeNames(refused)}.
        </p>
      )}
      {empty && loading.length === 0 && refused.length === 0 && (
        <p role="status" className="px-3 py-5 text-center text-sm text-muted-foreground">
          No matches
        </p>
      )}
    </>
  );
}

const noArchivedRuns: readonly ArchivedRunMatch[] = [];

function useArchivedSearch(query: string) {
  const online = useTransport().kind === "online";
  const search = online && !query.startsWith(">") ? query.trim().toLowerCase() : "";
  const [result, setResult] = useState<{
    search: string;
    matches: readonly ArchivedRunMatch[];
    refused?: boolean;
  }>();
  useEffect(() => {
    if (!search) return;
    let current = true;
    const send = window.setTimeout(() => {
      void api.searchArchivedRuns(search).then(
        (matches) => {
          if (current) setResult({ search, matches });
        },
        () => {
          if (current) setResult({ search, matches: noArchivedRuns, refused: true });
        },
      );
    }, 150);
    return () => {
      current = false;
      window.clearTimeout(send);
    };
  }, [search]);
  const matches = search && result?.search === search ? result : null;
  return {
    archived: matches?.matches ?? noArchivedRuns,
    searching: !!search && !matches,
    refused: matches?.refused ?? false,
  };
}

function useListFade(ref: React.RefObject<HTMLSpanElement | null>) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const end = ref.current;
    if (!end) return;
    const observer = new IntersectionObserver(
      ([entry]) => setMore(entry ? !entry.isIntersecting : false),
      { root: end.closest('[role="listbox"]') },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [ref]);
  return more;
}

function PaletteList({
  listId,
  groups,
  selected,
  onActivate,
  onHover,
}: {
  listId: string;
  groups: ReturnType<typeof buildPaletteGroups>;
  selected: PaletteItem | undefined;
  onActivate: (item: PaletteItem) => void;
  onHover: (id: string) => void;
}) {
  const { hint } = useShortcutPreferences();
  const listRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const showFade = useListFade(endRef);
  const selectedId = selected?.id;
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  return (
    <div className="relative min-h-0">
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Palette results"
        className="max-h-[min(340px,calc(88dvh-100px))] overflow-y-auto supports-[not_selector(::-webkit-scrollbar)]:[scrollbar-color:var(--border-strong)_transparent] supports-[not_selector(::-webkit-scrollbar)]:[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border-strong"
      >
        {groups.map(({ name, items }) => (
          <div key={name} role="group" aria-label={name} className="px-1 pt-2 first:pt-2.5">
            <div aria-hidden className="px-2 pb-0.5 text-2xs font-medium text-muted-foreground">
              {name}
            </div>
            {items.map((item) => {
              const shortcut = paletteActionShortcut[item.id];
              return (
                <PaletteRow
                  key={item.id}
                  item={item}
                  id={`${listId}-${item.id}`}
                  active={item.id === selected?.id}
                  keys={shortcut && !item.disabled ? hint(shortcut) : undefined}
                  onActivate={onActivate}
                  onHover={onHover}
                />
              );
            })}
          </div>
        ))}
        <span ref={endRef} aria-hidden className="block h-1" />
      </div>
      {showFade && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0.5 bottom-0 h-5 bg-linear-to-t from-card"
        />
      )}
    </div>
  );
}

function usePaletteSelection(
  groups: ReturnType<typeof buildPaletteGroups>,
  listId: string,
  onActivate: (item: PaletteItem) => void,
) {
  const [activeId, setActiveId] = useState<string>();
  const enabled = groups.flatMap((group) => group.items.filter((item) => !item.disabled));
  const activeIndex = enabled.findIndex((item) => item.id === activeId);
  const index = activeIndex < 0 ? 0 : activeIndex;
  const selected = enabled[index];
  const selectedId = selected ? `${listId}-${selected.id}` : undefined;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (enabled.length)
        setActiveId(enabled[(index + direction + enabled.length) % enabled.length]?.id);
    } else if (event.key === "Enter" && !event.repeat) {
      event.preventDefault();
      if (selected) onActivate(selected);
    }
  }

  return { selected, selectedId, setActiveId, onKeyDown };
}

/** Mounted for each opening, so the query and selection cannot leak into a new session. */
function PaletteContent({
  onActivate,
  onNewRun,
}: {
  onActivate: (item: PaletteItem) => void;
  onNewRun: () => void;
}) {
  const navigate = useNavigate();
  const openStudio = useOpenStudio();
  const openSettings = useSettingsNavigation();
  const listId = useId();
  const [query, setQuery] = useState("");
  const canStart = useSyncExternalStore(transport.subscribe, transport.acceptsMutations);
  const { loading, refused, runs, flows, agents } = paletteCatalog(
    useLiveNavigation(),
    useLiveStudio(),
  );
  const archive = useArchivedSearch(query.trim());
  const groups = buildPaletteGroups({
    navigate,
    navigation: { openStudio, openSettings },
    onNewRun,
    canStart,
    runs,
    flows,
    agents,
    archived: archive.archived,
    query,
  });
  const { selected, selectedId, setActiveId, onKeyDown } = usePaletteSelection(
    groups,
    listId,
    onActivate,
  );

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Search aria-hidden className="ml-0.5 size-4 shrink-0 text-muted-foreground" />
        <Input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={selectedId}
          aria-label="Search commands and items"
          placeholder="Search Runs, Flows, Agents…"
          className="min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none placeholder:text-muted-foreground focus-visible:ring-0 dark:bg-transparent"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(undefined);
          }}
          onKeyDown={onKeyDown}
        />
        <DialogDismiss label="Close command palette" />
      </div>
      <PaletteList
        listId={listId}
        groups={groups}
        selected={selected}
        onActivate={onActivate}
        onHover={setActiveId}
      />
      <CatalogStatus
        loading={loading}
        refused={archive.refused && !refused.includes("Runs") ? ["Runs", ...refused] : refused}
        empty={groups.length === 0 && !archive.searching}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <KeyChip>↑↓</KeyChip> Navigate
        </span>
        <span className="flex items-center gap-1.5">
          <KeyChip>↵</KeyChip> Open
        </span>
        <span className="flex items-center gap-1.5">
          <KeyChip>&gt;</KeyChip> Actions only
        </span>
      </div>
    </>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  restoreFocus,
  onNewRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocus: () => void;
  onNewRun: () => void;
}) {
  const pendingAction = useRef<(() => void) | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogSurface
        presentation="workspace"
        className="top-[12%] flex max-h-[88dvh] w-[calc(100%-2rem)] max-w-lg translate-y-0 flex-col overflow-hidden"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
          const action = pendingAction.current;
          pendingAction.current = null;
          action?.();
        }}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search Runs, Flows, Agents and navigation actions.
        </DialogDescription>
        {open && (
          <PaletteContent
            onNewRun={onNewRun}
            onActivate={(item) => {
              if (item.disabled || (item.id === "action-new-run" && !transport.acceptsMutations()))
                return;
              pendingAction.current = item.run;
              onOpenChange(false);
            }}
          />
        )}
      </DialogSurface>
    </Dialog>
  );
}
