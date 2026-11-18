import { RenameDialog } from "./rename-dialog.tsx";
import { MutationGate } from "@/client-gate";
import { useShortcutPreferences } from "../shortcut-preferences.ts";
import { shortcutAriaKeys } from "../keyboard-shortcuts.ts";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { runActions, useRunActions, useRunActionsState } from "./run-actions.tsx";
import { publishSidebarNavigation } from "../sidebar-navigation.ts";
import { runListView, useRunListView } from "../run-list-view.ts";
import { mattersNeedingOwner, type RunNavigationEntry } from "@t3-factory/contracts";
import type { RunActionAvailability } from "../run-actions.ts";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CirclePause,
  FilePen,
  LoaderCircle,
  GitBranch,
  GitPullRequest,
  Workflow,
  Moon,
  Pencil,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  byCreation,
  draftTitle,
  runDraft,
  useRunDraft,
  useRunDrafts,
  type SavedRunDraft,
} from "../run-draft.ts";
import { useNavigate } from "@tanstack/react-router";
import { useLiveNavigation } from "../live/navigation.ts";
import { RunStatusChip } from "./run-status-chip.tsx";
import { Button } from "./ui/button";
import { KeyChip } from "@/components/ui/key-chip";
import { Input } from "./ui/input";
import { ContextMenuItem as RowMenuItem } from "./ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ActivityAge, SidebarRow, SidebarRowsProvider } from "./sidebar-row.tsx";
import { ProjectIcon } from "./project-icon.tsx";
import { RunNumber } from "./run-number.tsx";
import { GeneratingTitle } from "./run-title-generation.tsx";
import { RunOriginPreview } from "./run-origin.tsx";
import { repositorySummary, RunRepositories } from "./run-repositories.tsx";
import { cn } from "../lib/utils.ts";

/** Run/ExecIndicator: whole-Run execution only; attention stays in the chips. */
function execution(run: RunNavigationEntry) {
  if (run.settlement)
    return {
      Icon: run.settlement === "stopping" ? LoaderCircle : CircleDashed,
      label: run.settlement === "stopping" ? "Stopping workers" : "Settlement unresolved",
      className: "text-attention",
    };
  if (run.lifecycle === "settled")
    return { Icon: CircleCheck, label: "Settled", className: "text-success" };
  if (run.blocks.some((block) => block.state !== "not-started" && block.freshness !== "fresh"))
    return {
      Icon: CircleDashed,
      label: "Observation unknown or stale",
      className: "text-muted-foreground",
    };
  if (run.blocks.some((block) => block.state === "working"))
    return {
      Icon: LoaderCircle,
      label: "Working",
      className: "text-status-working motion-safe:animate-spin",
    };
  return { Icon: CirclePause, label: "Waiting", className: "text-muted-foreground" };
}

function useRunNavigation() {
  const { value, error } = useLiveNavigation();
  return {
    runs: value ?? [],
    loaded: value !== null,
    loadError: error ? "Run navigation unavailable. Saved history is retained." : "",
  };
}

function NewRunButton({ current }: { current: boolean }) {
  const { hint } = useShortcutPreferences();
  const navigate = useNavigate();
  return (
    <MutationGate>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="New Run (+)"
            aria-current={current ? "page" : undefined}
            className="aria-[current=page]:border-brand-soft-border aria-[current=page]:bg-brand-soft aria-[current=page]:text-link"
            onClick={() => {
              runDraft.openFresh();
              void navigate({ to: "/runs/new" });
            }}
          >
            <Plus aria-hidden strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent shortcut={hint("newRun")}>New Run</TooltipContent>
      </Tooltip>
    </MutationGate>
  );
}

/** The Run list as its search or Needs you filter shows it; groups hide while it is filtered. */
function useRunListRows(runs: readonly RunNavigationEntry[]) {
  const drafts = useRunDrafts();
  const { search, needsYou } = useRunListView();
  const query = search.trim().toLocaleLowerCase();
  const groups = needsYou ? needsYouGroup(runs) : navigationGroups(runs, drafts, query);
  return { ...groups, search, needsYou, query, filtered: !!query || needsYou };
}

export function RunSidebar({ path }: { path: string }) {
  const { runs, loaded, loadError } = useRunNavigation();
  const composition = useRunDraft();
  const searchRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [snoozedExpanded, setSnoozedExpanded] = useState(false);
  const [renamingDraft, setRenamingDraft] = useState<SavedRunDraft>();
  const { open, snoozed, settled, matches, total, search, needsYou, query, filtered } =
    useRunListRows(runs);
  const actionError = useRunActionsState((state) => state.error);
  useLayoutEffect(() => {
    publishSidebarNavigation({
      visibleRows: sidebarRows(open, snoozed, settled, filtered, snoozedExpanded, expanded),
      searching: filtered,
      focusSearch: () => searchRef.current?.focus(),
    });
    return () =>
      publishSidebarNavigation({
        visibleRows: [],
        searching: false,
        focusSearch: () => undefined,
      });
  }, [open, snoozed, settled, expanded, filtered, snoozedExpanded]);
  return (
    <section aria-label="Run navigation" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
        <RunSearchField ref={searchRef} value={search} onChange={runListView.search} />
        <NewRunButton current={path === "/runs/new"} />
      </div>
      {needsYou && <NeedsYouFilter count={open.length} />}
      {(loadError || actionError) && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {loadError || actionError}
        </p>
      )}
      <SidebarRowsProvider>
        <RunGroups
          path={path}
          open={open}
          composingDraftId={composition.draftId}
          settled={settled}
          snoozed={snoozed}
          snoozedExpanded={snoozedExpanded}
          onExpandSnoozed={() => setSnoozedExpanded(!snoozedExpanded)}
          expanded={expanded}
          query={query}
          filtered={filtered}
          needsYou={needsYou}
          search={search.trim()}
          loaded={loaded}
          total={total}
          matches={matches}
          onExpand={() => setExpanded(!expanded)}
          onRenameDraft={setRenamingDraft}
        />
      </SidebarRowsProvider>
      {renamingDraft && (
        <DraftRenameDialog draft={renamingDraft} onClose={() => setRenamingDraft(undefined)} />
      )}
    </section>
  );
}

function sidebarRows(
  open: readonly (RunNavigationEntry | SavedRunDraft)[],
  snoozed: readonly RunNavigationEntry[],
  settled: readonly RunNavigationEntry[],
  filtered: boolean,
  showSnoozed: boolean,
  showSettled: boolean,
) {
  return [
    ...open,
    ...(!filtered && showSnoozed ? snoozed : []),
    ...(!filtered && showSettled ? settled : []),
  ].map((entry) => ({
    kind: "presentation" in entry ? ("run" as const) : ("draft" as const),
    id: entry.id,
  }));
}

function DraftRenameDialog({ draft, onClose }: { draft: SavedRunDraft; onClose: () => void }) {
  return (
    <RenameDialog
      id={draft.id}
      title={draftTitle(draft)}
      kind="draft"
      description="Name this draft. Prompt edits keep the title you choose."
      onClose={onClose}
      save={async (title) => {
        if (!runDraft.rename(draft.id, title))
          throw new Error(
            "This draft was discarded or is waiting for its Start outcome, so it keeps its title.",
          );
      }}
    />
  );
}

/** Active Runs are open or Snoozed and offer Snooze or Restore and Settle; the rest are Settled. */
function isActive(run: RunNavigationEntry) {
  return run.lifecycle === "active";
}

/** Revealed drafts join the open Runs in creation order; title search covers both. */
function navigationGroups(
  runs: readonly RunNavigationEntry[],
  drafts: readonly SavedRunDraft[],
  query: string,
) {
  const titled = (title: string) => title.toLocaleLowerCase().includes(query);
  const runMatches = runs.filter((run) => titled(run.title));
  const draftMatches = drafts.filter((draft) => titled(draftTitle(draft)));
  const active = runMatches.filter(isActive);
  const main = active.filter((run) => !run.presentation.snoozed);
  const snoozed = active.filter((run) => run.presentation.snoozed);
  const settled = runMatches.filter((run) => !isActive(run));
  return {
    open: query
      ? [...runMatches, ...draftMatches].toSorted(byCreation)
      : [...main, ...draftMatches].toSorted(byCreation),
    snoozed,
    settled,
    matches: runMatches.length + draftMatches.length,
    total: runs.length + drafts.length,
  };
}

/**
 * Needs you: exactly the Runs each desktop installation's Dock badge counts, in creation order.
 * A view of the Run list, not an Inbox: rows show their own Needs input and Problem chips.
 */
function needsYouGroup(runs: readonly RunNavigationEntry[]) {
  const waiting = runs.filter((run) => mattersNeedingOwner(run).length > 0).toSorted(byCreation);
  return { open: waiting, snoozed: [], settled: [], matches: waiting.length, total: runs.length };
}

/** The active Needs you filter; choosing it again shows the whole Run list. */
function NeedsYouFilter({ count }: { count: number }) {
  return (
    <div className="flex shrink-0 px-3 pb-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="xs"
            aria-pressed
            className="border-brand-soft-border bg-brand-soft text-link hover:bg-brand-soft"
            onClick={runListView.clearNeedsYou}
          >
            Needs you ({count})
            <X aria-hidden strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Show all Runs</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Snoozed and Settled matches are shown at reduced contrast in search results only. */
function mutedInSearch(run: RunNavigationEntry) {
  return run.presentation.snoozed || !isActive(run);
}

/** Run title search with Escape and a clear button that keeps focus in the field. */
function RunSearchField({
  ref,
  value,
  onChange,
}: {
  ref: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { hint } = useShortcutPreferences();
  const searchHint = hint("searchRuns");
  return (
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden
        strokeWidth={1.5}
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground"
      />
      <Input
        ref={ref}
        aria-label="Search Run titles"
        title={searchHint ? `Search Run titles · ${searchHint}` : "Search Run titles"}
        placeholder="Search Run titles"
        className={cn("bg-muted pl-8", value && "pr-8")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange("");
        }}
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
                ref.current?.focus();
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

function navigationEmptyState(
  loaded: boolean,
  total: number,
  matches: number,
  open: number,
  search: string,
  needsYou: boolean,
) {
  if (!loaded) return undefined;
  if (needsYou && !open) return { title: "Nothing needs you", body: "You're all caught up." };
  if (!total)
    return {
      title: "No Runs yet",
      body: "Start one with + (New Run). Runs from every project appear here.",
    };
  if (!matches)
    return {
      title: `No Run titles match “${search}”`,
      body: "Search looks at titles only. Clear search (Esc) to see all Runs.",
    };
  if (!open && !search) return { title: "Nothing open", body: "You're all caught up." };
  return undefined;
}

function NavigationEmptyState({ state }: { state: ReturnType<typeof navigationEmptyState> }) {
  if (!state) return null;
  return (
    <div
      role="status"
      className="grid gap-1 rounded-md border border-dashed border-border-strong px-2.5 py-3.5"
    >
      <p className="truncate text-sm leading-tight font-medium text-emphasis-foreground">
        {state.title}
      </p>
      <p className="text-2xs leading-tight tracking-label text-muted-foreground">{state.body}</p>
    </div>
  );
}

function RunGroup({
  name,
  expanded,
  onExpand,
  children,
  count,
  loaded,
  searching,
}: {
  name: "Snoozed" | "Settled";
  expanded: boolean;
  onExpand: () => void;
  children: React.ReactNode;
  count: number;
  loaded: boolean;
  searching: boolean;
}) {
  if (!loaded || searching || !count) return null;
  const key = name.toLowerCase();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        id={`${key}-toggle`}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-2xs leading-tight font-semibold tracking-section text-subtle-foreground outline-none hover:bg-accent hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls={`${key}-runs`}
        onClick={onExpand}
      >
        <Chevron aria-hidden strokeWidth={1.5} className="size-3 shrink-0" />
        {name}{" "}
        <span className="rounded-sm bg-accent px-[5px] py-px font-medium tracking-normal text-muted-foreground">
          {count}
        </span>
      </button>
      {expanded && (
        <div className="max-h-[min(14rem,25dvh)] overflow-y-auto">
          <nav id={`${key}-runs`} aria-label={`${name} Runs`} className="flex flex-col gap-0.5">
            {children}
          </nav>
        </div>
      )}
    </div>
  );
}

function RunGroups({
  path,
  open,
  composingDraftId,
  snoozed,
  settled,
  expanded,
  snoozedExpanded,
  query,
  filtered,
  needsYou,
  search,
  loaded,
  total,
  matches,
  onExpand,
  onExpandSnoozed,
  onRenameDraft,
}: {
  path: string;
  open: readonly (RunNavigationEntry | SavedRunDraft)[];
  composingDraftId: string | undefined;
  snoozed: readonly RunNavigationEntry[];
  settled: readonly RunNavigationEntry[];
  expanded: boolean;
  snoozedExpanded: boolean;
  query: string;
  filtered: boolean;
  needsYou: boolean;
  search: string;
  loaded: boolean;
  total: number;
  matches: number;
  onExpand: () => void;
  onExpandSnoozed: () => void;
  onRenameDraft: (draft: SavedRunDraft) => void;
}) {
  const row = (run: RunNavigationEntry, muted = false) => (
    <RunRow key={run.id} run={run} selected={path === `/runs/${run.id}`} searchMuted={muted} />
  );
  const entryRow = (entry: RunNavigationEntry | SavedRunDraft) =>
    "presentation" in entry ? (
      row(entry, !!query && mutedInSearch(entry))
    ) : (
      <DraftRow
        key={entry.id}
        draft={entry}
        selected={path === "/runs/new" && entry.id === composingDraftId}
        onRename={() => onRenameDraft(entry)}
      />
    );
  const empty = navigationEmptyState(loaded, total, matches, open.length, search, needsYou);
  // Open rows scroll on their own; the groups stay pinned below them with capped heights,
  // so a long Settled history never pushes open Runs out of view. On a short sidebar the
  // groups yield first: the open list keeps a floor and the groups scroll as one block.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-24 flex-1 overflow-y-auto px-2">
        <nav aria-label="Open Runs" className="flex flex-col gap-0.5">
          {query && (
            <p className="px-2 pt-1 pb-1.5 text-2xs leading-tight font-semibold tracking-section text-subtle-foreground uppercase">
              Runs · {matches}
            </p>
          )}
          {open.map(entryRow)}
          <NavigationEmptyState state={empty} />
        </nav>
      </div>
      <div className="flex min-h-0 flex-col overflow-y-auto px-2 py-1.5">
        <RunGroup
          loaded={loaded}
          searching={filtered}
          name="Snoozed"
          expanded={snoozedExpanded}
          onExpand={onExpandSnoozed}
          count={snoozed.length}
        >
          {snoozed.map((run) => row(run))}
        </RunGroup>
        <RunGroup
          loaded={loaded}
          searching={filtered}
          name="Settled"
          expanded={expanded}
          onExpand={onExpand}
          count={settled.length}
        >
          {settled.map((run) => row(run))}
        </RunGroup>
      </div>
    </div>
  );
}

function RenameItem({ onSelect, disabled }: { onSelect: () => void; disabled?: boolean }) {
  const { bindings, hint } = useShortcutPreferences();
  const renameHint = hint("rename");
  return (
    <RowMenuItem
      onSelect={onSelect}
      disabled={disabled}
      aria-keyshortcuts={shortcutAriaKeys(bindings.rename)}
    >
      <Pencil aria-hidden strokeWidth={1.5} />
      Rename
      {renameHint && (
        <KeyChip aria-hidden className="ml-auto">
          {renameHint}
        </KeyChip>
      )}
    </RowMenuItem>
  );
}

/** A draft awaiting its Start outcome cannot be renamed or discarded; only the same check settles it. */
function DraftRow({
  draft,
  selected,
  onRename,
}: {
  draft: SavedRunDraft;
  selected: boolean;
  onRename: () => void;
}) {
  const title = draftTitle(draft);
  const pending = !!draft.submission;
  return (
    <SidebarRow
      id={draft.id}
      title={title}
      kind="draft"
      selected={selected}
      onClick={() => runDraft.openDraft(draft.id)}
      preview={
        <>
          <p className="text-sm font-medium break-words">{title}</p>
          <p className="text-muted-foreground">Draft</p>
        </>
      }
      actions={
        <>
          <RenameItem onSelect={onRename} disabled={pending} />
          <RowMenuItem disabled={pending} onSelect={() => runDraft.discard(draft.id)}>
            <Trash2 aria-hidden strokeWidth={1.5} />
            Discard
          </RowMenuItem>
          {pending && (
            <p className="px-2 py-1.5 text-2xs text-muted-foreground">
              Waiting for its Start outcome. Open it to check the same request.
            </p>
          )}
        </>
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        <FilePen aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{title}</span>
      </span>
      <span className="text-2xs text-muted-foreground">Draft</span>
    </SidebarRow>
  );
}

function RunRow({
  run,
  selected,
  searchMuted,
}: {
  run: RunNavigationEntry;
  selected: boolean;
  searchMuted?: boolean;
}) {
  const { available, busy } = useRunActions({ entry: run });
  const state = execution(run);
  const { branches, pullRequests } = repositorySummary(run.repositories);
  const compact = run.lifecycle === "settled";
  const muted = !selected && (searchMuted || compact);
  const hasMetadata =
    run.settlement !== null ||
    branches.length > 0 ||
    pullRequests.length > 0 ||
    run.presentation.woke ||
    run.attention.needsInput ||
    run.attention.problem ||
    run.project.availability !== "available";
  return (
    <SidebarRow
      id={run.id}
      title={run.title}
      kind="run"
      selected={selected}
      compact={compact}
      disabled={busy}
      preview={<RunPreview run={run} />}
      actions={
        <>
          <RenameItem
            onSelect={() => runActions.openDialog("rename", { entry: run })}
            disabled={!available.rename}
          />
          <RunActionItems run={run} available={available} />
        </>
      }
    >
      {compact ? (
        <span className="shrink-0 opacity-50">
          <ProjectIcon icon={run.project.projectIcon} faviconUrl={run.project.faviconUrl} inline />
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
          <ProjectIcon icon={run.project.projectIcon} faviconUrl={run.project.faviconUrl} inline />
          <span className="min-w-0 truncate">{run.project.title}</span>
          <RunNumber number={run.number} aria-hidden />
          <state.Icon
            aria-hidden
            strokeWidth={1.5}
            className={cn("ml-auto size-3.5 shrink-0", state.className)}
          />
          <ActivityAge at={run.lastActivityAt} />
        </span>
      )}
      {compact && <RunNumber number={run.number} aria-hidden />}
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "block min-w-0 truncate text-sm leading-tight font-medium",
            muted ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {run.title}
        </span>
        <GeneratingTitle generation={run.titleGeneration} />
      </span>
      {!compact && hasMetadata && (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          {branches.length > 0 && (
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <GitBranch aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {branches.length === 1 ? branches[0]![0] : `${branches.length} branches`}
              </span>
            </span>
          )}
          {pullRequests.length > 0 && (
            <span
              aria-label={`${pullRequests.length} pull requests`}
              className="inline-flex shrink-0 items-center gap-1"
            >
              <GitPullRequest aria-hidden className="size-3.5" />
              {pullRequests.length}
            </span>
          )}
          <RunRowIndicators run={run} />
        </span>
      )}
      <span className="sr-only">, {state.label}</span>
    </SidebarRow>
  );
}

function RunPreview({ run }: { run: RunNavigationEntry }) {
  const state = execution(run);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm leading-5 font-medium break-words">{run.title}</p>
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <ProjectIcon icon={run.project.projectIcon} faviconUrl={run.project.faviconUrl} inline />
        <span className="break-words">{run.project.title}</span>
      </div>
      <div className="flex items-start gap-2 text-muted-foreground">
        <Workflow aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span className="break-words">{run.flowName}</span>
      </div>
      {run.origin && <RunOriginPreview origin={run.origin} />}
      <div className="flex flex-wrap items-center gap-2">
        <state.Icon aria-hidden className={cn("size-3.5", state.className)} />
        <span>{state.label}</span>
        <RunRowIndicators run={run} />
      </div>
      {run.blocks
        .filter((block) => block.workingMessage)
        .map((block, index) => (
          <p key={index} className="break-words text-muted-foreground">
            {block.workingMessage}
          </p>
        ))}
      <RunRepositories workers={run.repositories} />
      <p className="text-2xs text-muted-foreground">
        Last activity {new Date(run.lastActivityAt).toLocaleString()}
      </p>
    </div>
  );
}

function RunRowIndicators({ run }: { run: RunNavigationEntry }) {
  return (
    <>
      {run.settlement && (
        <span className="text-2xs text-muted-foreground">
          {run.settlement === "stopping" ? "Stopping" : "Settle unresolved"}
        </span>
      )}
      {run.presentation.woke && <RunStatusChip kind="woke" />}
      {run.attention.needsInput && <RunStatusChip kind="needs-input" />}
      {run.attention.problem && <RunStatusChip kind="problem" />}
      {run.project.availability !== "available" && <RunStatusChip kind="project-unavailable" />}
    </>
  );
}

function RunActionItems({
  run,
  available,
}: {
  run: RunNavigationEntry;
  available: RunActionAvailability;
}) {
  const { bindings, hint } = useShortcutPreferences();
  const snoozeHint = hint("snoozeRestore");
  const settleHint = hint("settle");
  const archiveHint = hint("archive");
  return (
    <>
      {isActive(run) && (
        <RowMenuItem
          disabled={!available.snoozeRestore}
          onSelect={() => void runActions.run({ entry: run }, "snoozeRestore")}
          aria-keyshortcuts={shortcutAriaKeys(bindings.snoozeRestore)}
        >
          {run.presentation.snoozed ? (
            <Undo2 aria-hidden strokeWidth={1.5} />
          ) : (
            <Moon aria-hidden strokeWidth={1.5} />
          )}
          {run.presentation.snoozed ? "Restore" : "Snooze"}
          {snoozeHint && (
            <KeyChip aria-hidden className="ml-auto">
              {snoozeHint}
            </KeyChip>
          )}
        </RowMenuItem>
      )}
      {isActive(run) && (
        <RowMenuItem
          disabled={!available.settle}
          onSelect={() => void runActions.run({ entry: run }, "settle")}
          aria-keyshortcuts={shortcutAriaKeys(bindings.settle)}
        >
          <CircleCheck aria-hidden strokeWidth={1.5} />
          Settle
          {settleHint && (
            <KeyChip aria-hidden className="ml-auto">
              {settleHint}
            </KeyChip>
          )}
        </RowMenuItem>
      )}
      <RowMenuItem
        disabled={!available.archive}
        onSelect={() => runActions.openDialog("archive", { entry: run }, `run-row-${run.id}`)}
        aria-keyshortcuts={shortcutAriaKeys(bindings.archive)}
      >
        <Archive aria-hidden strokeWidth={1.5} />
        Archive…
        {archiveHint && (
          <KeyChip aria-hidden className="ml-auto">
            {archiveHint}
          </KeyChip>
        )}
      </RowMenuItem>
    </>
  );
}
