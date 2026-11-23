import { RenameDialog } from "./rename-dialog.tsx";
import { MutationGate } from "@/client-gate";
import { useShortcutPreferences } from "../shortcut-preferences.ts";
import { shortcutAriaKeys } from "../keyboard-shortcuts.ts";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { RunActionItems, useRunActions, useRunActionsState } from "./run-actions.tsx";
import { publishSidebarNavigation } from "../sidebar-navigation.ts";
import {
  runList,
  runListView,
  useRunListView,
  type RunListProject,
  type RunListProjectSelection,
} from "../run-list-view.ts";
import type { RunNavigationEntry } from "@t3-factory/contracts";
import { runActivity } from "../run-status.ts";
import {
  ChevronDown,
  ChevronRight,
  BellRing,
  Circle,
  CircleCheck,
  CircleDashed,
  CirclePause,
  FilePen,
  Flag,
  FolderGit2,
  LoaderCircle,
  GitBranch,
  GitPullRequest,
  Workflow,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  draftTitle,
  runDraft,
  useRunDraft,
  useRunDrafts,
  type SavedRunDraft,
} from "../run-draft.ts";
import { useNavigate } from "@tanstack/react-router";
import { useLiveNavigation } from "../live/navigation.ts";
import { launchChoicesScope } from "../live/launch-choices.ts";
import { useLiveScope } from "../live/live-connection.ts";
import { ChoiceMenu, type MenuChoice } from "./choice-menu.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { Button } from "./ui/button";
import { KeyChip } from "@/components/ui/key-chip";
import { Input } from "./ui/input";
import { ContextMenuItem as RowMenuItem } from "./ui/context-menu";
import { EmptyState } from "./ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ActivityAge, SidebarRow, SidebarRowsProvider } from "./sidebar-row.tsx";
import { ProjectIcon } from "./project-icon.tsx";
import { RunNumber } from "./run-number.tsx";
import { GeneratingTitle } from "./run-title-generation.tsx";
import { RunOriginPreview } from "./run-origin.tsx";
import {
  BranchName,
  repositorySummary,
  runBranches,
  RunRepositories,
} from "./run-repositories.tsx";
import { cn } from "../lib/utils.ts";
import { fullDateTime } from "../time-format.ts";

/**
 * Run/ExecIndicator: the row icon shows activity, never state; a Problem or Needs input chip shows
 * the state. A spinner while an Agent works, a pause while it waits, and the neutral Idle ring when
 * nothing works but something is pending.
 */
function execution(run: RunNavigationEntry) {
  const activity = runActivity(run);
  if (activity === "settled")
    return { Icon: CircleCheck, label: "Settled", className: "text-success" };
  if (activity === "finished")
    return { Icon: CircleCheck, label: "Finished", className: "text-success" };
  if (activity === "stale")
    return {
      Icon: CircleDashed,
      label: "Observation unknown or stale",
      className: "text-muted-foreground",
    };
  if (activity === "working")
    return {
      Icon: LoaderCircle,
      label: "Working",
      className: "text-status-working motion-safe:animate-spin",
    };
  if (activity === "waiting")
    return { Icon: CirclePause, label: "Waiting", className: "text-status-waiting" };
  return { Icon: Circle, label: "Idle", className: "text-muted-foreground" };
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

function useRunListRows(runs: readonly RunNavigationEntry[], loaded: boolean) {
  const drafts = useRunDrafts();
  const view = useRunListView();
  const choices = useLiveScope(launchChoicesScope, { gates: false }).value;
  const catalog = choices
    ? { projects: choices.catalog.projects, flows: choices.flows }
    : undefined;
  const list = runList({ runs, drafts, view, loaded, catalog });
  const fellBack = list.project === null && view.project !== null;
  useEffect(() => {
    if (fellBack) runListView.chooseProject(null);
  }, [fellBack]);
  return { ...list, search: view.search, needsYou: view.needsYou, query: view.search.trim() };
}

function useGroupExpansion(path: string, runs: readonly RunNavigationEntry[], filtered: boolean) {
  const selected = filtered ? undefined : runs.find((run) => path === `/runs/${run.id}`)?.id;
  const [group, setGroup] = useState({ selected, expanded: !!selected });
  if (group.selected !== selected) setGroup({ selected, expanded: group.expanded || !!selected });
  return [group.expanded, () => setGroup({ selected, expanded: !group.expanded })] as const;
}

export function RunSidebar({ path }: { path: string }) {
  const { runs, loaded, loadError } = useRunNavigation();
  const composition = useRunDraft();
  const searchRef = useRef<HTMLInputElement>(null);
  const [renamingDraft, setRenamingDraft] = useState<SavedRunDraft>();
  const list = useRunListRows(runs, loaded);
  const { open, snoozed, settled, matches, total, search, needsYou, query, project, projects } =
    list;
  const filtered = list.flat;
  const [expanded, onExpand] = useGroupExpansion(path, settled, filtered);
  const [snoozedExpanded, onExpandSnoozed] = useGroupExpansion(path, snoozed, filtered);
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
        <ProjectFilter project={project} projects={projects} />
        <NewRunButton current={path === "/runs/new"} />
      </div>
      {/^\d+$/.test(query) && (
        <p className="px-3 pb-2 text-2xs text-muted-foreground">
          {query} also finds branches · #{query} finds Run {query} only
        </p>
      )}
      {needsYou && <NeedsYouFilter count={open.length} />}
      {[loadError, actionError]
        .filter((message) => message !== "")
        .map((message) => (
          <p key={message} role="alert" className="px-3 pb-2 text-xs text-destructive">
            {message}
          </p>
        ))}
      <SidebarRowsProvider>
        <RunGroups
          path={path}
          open={open}
          composingDraftId={composition.draftId}
          settled={settled}
          snoozed={snoozed}
          snoozedExpanded={snoozedExpanded}
          onExpandSnoozed={onExpandSnoozed}
          expanded={expanded}
          filtered={filtered}
          needsYou={needsYou}
          search={query}
          projectName={project?.title}
          loaded={loaded}
          total={total}
          matches={matches}
          onExpand={onExpand}
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

function ProjectFilter({
  project,
  projects,
}: {
  project: RunListProjectSelection | null;
  projects: readonly RunListProject[];
}) {
  const choices: MenuChoice[] = [
    {
      id: "",
      label: "All Projects",
      description: "Every Project in the sidebar",
      icon: <FolderGit2 aria-hidden strokeWidth={1.5} className="size-4 text-muted-foreground" />,
    },
    ...projects.map((choice) => ({
      id: choice.id,
      label: choice.title,
      description: choice.workspaceRoot,
      icon: <ProjectIcon icon={choice.projectIcon} faviconUrl={choice.faviconUrl} inline />,
    })),
  ];
  return (
    <ChoiceMenu
      id="run-list-project"
      label="Project"
      value={project?.id ?? ""}
      choices={choices}
      onChange={(id) => {
        const choice = projects.find((candidate) => candidate.id === id);
        runListView.chooseProject(choice ? { id: choice.id, title: choice.title } : null);
      }}
      disabled={false}
      placeholder="All Projects"
      unlistedLabel={project?.title}
      popupClassName="w-64"
      trigger={{
        iconOnly: { icon: <FolderGit2 aria-hidden strokeWidth={1.5} />, chosen: project !== null },
      }}
    />
  );
}

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
        aria-label="Search Runs"
        title={searchHint ? `Search Runs · ${searchHint}` : "Search Runs"}
        placeholder="Search Runs"
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
  projectName: string | undefined,
  needsYou: boolean,
) {
  if (!loaded) return undefined;
  if (needsYou && !open) return { title: "Nothing needs you", body: "You're all caught up." };
  if (!total) return { title: "No Runs yet", body: "" };
  if (!matches)
    return {
      title: `No Runs match "${search}"${projectName ? ` in ${projectName}` : ""}`,
      body: "Search looks at the Run number, title, Project, Flow and branch. Use #12 for one Run number.",
    };
  if (!open && !search) return { title: "Nothing open", body: "You're all caught up." };
  return undefined;
}

function NavigationEmptyState({ state }: { state: ReturnType<typeof navigationEmptyState> }) {
  if (!state) return null;
  if (!state.body)
    return (
      <p role="status" className="px-2 py-2 text-sm text-muted-foreground">
        {state.title}
      </p>
    );
  return <EmptyState size="compact" title={state.title} body={state.body} />;
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
  filtered,
  needsYou,
  search,
  projectName,
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
  filtered: boolean;
  needsYou: boolean;
  search: string;
  projectName: string | undefined;
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
      row(entry, !!search && mutedInSearch(entry))
    ) : (
      <DraftRow
        key={entry.id}
        draft={entry}
        selected={path === "/runs/new" && entry.id === composingDraftId}
        onRename={() => onRenameDraft(entry)}
      />
    );
  const empty = navigationEmptyState(
    loaded,
    total,
    matches,
    open.length,
    search,
    projectName,
    needsYou,
  );
  // Open rows scroll on their own; the groups stay pinned below them with capped heights,
  // so a long Settled history never pushes open Runs out of view. On a short sidebar the
  // groups yield first: the open list keeps a floor and the groups scroll as one block.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-24 flex-1 overflow-y-auto px-2">
        <nav aria-label="Open Runs" className="flex flex-col gap-0.5">
          {search && (
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
      label={pending ? title : `${title} Draft`}
      preview={
        <>
          <p className="text-sm font-medium break-words">{title}</p>
          {!pending && <p className="text-muted-foreground">Draft</p>}
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
        {pending ? (
          <Circle aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FilePen aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm font-medium">{title}</span>
      </span>
      {!pending && <span className="text-2xs text-muted-foreground">Draft</span>}
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
  const { busy } = useRunActions({ entry: run });
  const ending = run.lifecycle === "settled" ? run.result : null;
  const muted = !selected && (searchMuted || run.lifecycle === "settled");
  return (
    <SidebarRow
      id={run.id}
      title={run.title}
      kind="run"
      selected={selected}
      disabled={busy}
      preview={<RunPreview run={run} />}
      {...(run.result?.outputMissing ? { description: "Output missing" } : {})}
      actions={
        <RunActionItems
          subject={{ entry: run }}
          surface="row"
          returnFocusId={`run-row-${run.id}`}
        />
      }
    >
      <RunRowMeta run={run} ending={ending} />
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
      <RunRowDetails run={run} />
      <RunRowAnnouncement run={run} ending={ending} />
    </SidebarRow>
  );
}

type RunEnding = RunNavigationEntry["result"];

const notInT3Narrow = {
  gap: "@max-[279px]/sidebar:gap-1.5 [@media(any-pointer:coarse)]:@max-[309px]/sidebar:gap-1.5",
  hidden: "@max-[279px]/sidebar:hidden [@media(any-pointer:coarse)]:@max-[309px]/sidebar:hidden",
  srOnly: "@max-[279px]/sidebar:sr-only [@media(any-pointer:coarse)]:@max-[309px]/sidebar:sr-only",
  hiddenBesideTouchActions: "[@media(any-pointer:coarse)]:@max-[259px]/sidebar:hidden",
};

function RunRowMeta({ run, ending }: { run: RunNavigationEntry; ending: RunEnding }) {
  const state = execution(run);
  const notInT3 = run.lifecycle === "settled" && run.project.availability !== "available";
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-2 text-2xs text-muted-foreground",
        notInT3 && notInT3Narrow.gap,
      )}
    >
      <span className={cn("shrink-0", notInT3 && notInT3Narrow.hiddenBesideTouchActions)}>
        <ProjectIcon icon={run.project.projectIcon} faviconUrl={run.project.faviconUrl} inline />
      </span>
      <span className={cn("min-w-0 shrink-[999] truncate", notInT3 && notInT3Narrow.srOnly)}>
        {run.project.title}
      </span>
      <RunNumber number={run.number} aria-hidden />
      {ending && <EndingBadge name={ending.endingName} iconOnlyWhenNarrow={notInT3} />}
      {notInT3 && (
        <StatusBadge kind="neutral" aria-hidden>
          Not in T3
        </StatusBadge>
      )}
      <span
        className={cn("ml-auto flex shrink-0 items-center gap-2", notInT3 && notInT3Narrow.hidden)}
      >
        <state.Icon
          aria-hidden
          strokeWidth={1.5}
          className={cn("size-3.5 shrink-0", state.className)}
        />
        <ActivityAge at={run.lastActivityAt} />
      </span>
    </span>
  );
}

function RunRowDetails({ run }: { run: RunNavigationEntry }) {
  const { pullRequests } = repositorySummary(run.repositories);
  const branches = runBranches(run);
  const availability = run.lifecycle !== "settled";
  const hasDetails =
    run.settlement !== null ||
    branches.length > 0 ||
    pullRequests.length > 0 ||
    run.presentation.woke ||
    run.attention.needsInput ||
    run.attention.problem ||
    (availability && run.project.availability !== "available");
  if (!hasDetails) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
      {branches.length > 0 && (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <GitBranch aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{branches.join(", ")}</span>
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
      <RunRowIndicators run={run} availability={availability} />
    </span>
  );
}

function RunRowAnnouncement({ run, ending }: { run: RunNavigationEntry; ending: RunEnding }) {
  return (
    <span className="sr-only">
      , {execution(run).label}
      {ending && `, ended ${ending.endingName}`}
      {run.lifecycle === "settled" && run.project.availability !== "available" && ", not in T3"}
    </span>
  );
}

function EndingBadge({ name, iconOnlyWhenNarrow }: { name: string; iconOnlyWhenNarrow: boolean }) {
  return (
    <StatusBadge
      kind="neutral"
      icon={Flag}
      aria-hidden
      className="max-w-16 min-w-0 shrink @min-[260px]/sidebar:max-w-22"
    >
      <span className={cn(iconOnlyWhenNarrow && notInT3Narrow.hidden)}>{name}</span>
    </StatusBadge>
  );
}

function RunPreviewResult({ run }: { run: RunNavigationEntry }) {
  if (run.result)
    return (
      <div className="flex flex-wrap items-start gap-2">
        <Flag aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 break-words">{run.result.endingName}</span>
        {run.result.outputMissing && <StatusBadge kind="attention">Output missing</StatusBadge>}
      </div>
    );
  if (run.lifecycle === "settled" && run.flowHasEndings)
    return (
      <div className="flex items-start gap-2 text-muted-foreground">
        <Flag aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
        <span>No result</span>
      </div>
    );
  return null;
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
      <RunPreviewResult run={run} />
      {run.blocks
        .filter((block) => block.workingMessage)
        .map((block, index) => (
          <p key={index} className="break-words text-muted-foreground">
            {block.workingMessage}
          </p>
        ))}
      <RunPreviewBoundBranch run={run} />
      <RunRepositories workers={run.repositories} />
      <p className="text-2xs text-muted-foreground">
        Last activity {fullDateTime(run.lastActivityAt)}
      </p>
    </div>
  );
}

function RunPreviewBoundBranch({ run }: { run: RunNavigationEntry }) {
  const bound = run.boundBranch;
  if (!bound || run.repositories.some((worker) => worker.branch === bound)) return null;
  return (
    <div className="flex items-start gap-2">
      <GitBranch aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <BranchName branch={bound} />
        <p className="text-2xs text-muted-foreground">Run worktree</p>
      </div>
    </div>
  );
}

function RunRowIndicators({
  run,
  availability = true,
}: {
  run: RunNavigationEntry;
  availability?: boolean;
}) {
  return (
    <>
      {run.settlement === "stopping" && (
        <span className="text-2xs text-muted-foreground">Stopping</span>
      )}
      {run.presentation.woke && (
        <StatusBadge kind="attention" icon={BellRing}>
          Woke
        </StatusBadge>
      )}
      {run.attention.needsInput && <StatusBadge kind="needs-input" />}
      {run.attention.problem && <StatusBadge kind="problem" />}
      {availability && run.project.availability !== "available" && (
        <StatusBadge kind="neutral">Not in T3</StatusBadge>
      )}
    </>
  );
}
