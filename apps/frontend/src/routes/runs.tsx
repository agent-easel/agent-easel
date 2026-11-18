import { T3LinksAvailable } from "../components/open-in-t3.tsx";
import { CanvasLayout } from "../components/screen-layout.tsx";
import { RunConversationAction, RunConversationNotice } from "../components/run-conversation.tsx";
import { RunInspector } from "../components/run-inspector.tsx";
import { RunOriginMeta } from "../components/run-origin.tsx";
import { useSettings, useStudio } from "../settings-navigation.ts";
import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FactoryProject, RunDetail, RunNavigationEntry } from "@t3-factory/contracts";
import { Ellipsis, Info, Moon, PanelRight, TriangleAlert, Unplug, Workflow } from "lucide-react";
import { attentionPending, RunAttentionDetails } from "../components/run-attention.tsx";
import { RunNumber } from "../components/run-number.tsx";
import { StudioLink } from "../components/app-link.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { NotLiveMarker } from "../components/run-header-status.tsx";
import {
  lifecycleAt,
  runFreshness,
  waitsForWorkerConfirmation,
  type RunFreshness,
} from "../run-status.ts";
import { GeneratingTitle } from "../components/run-title-generation.tsx";
import { RunTimeline } from "../components/run-timeline.tsx";
import { ExecutionCanvas } from "../components/execution-canvas.tsx";
import { clockTime, dayAndTime } from "../components/execution-state.tsx";
import { Notice, NoticeSettingsLink } from "../components/notice.tsx";
import { useConnectionState } from "../connection-state.tsx";
import { RunActionItems, runActions } from "../components/run-actions.tsx";
import { useLiveNavigation } from "../live/navigation.ts";
import { useRunInspectorOpen, toggleRunInspector } from "../run-inspector-preference.ts";
import { useShortcutPreferences } from "../shortcut-preferences.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "../api.ts";
import { useProjects } from "../use-projects.ts";
import { useLiveRun } from "../live/run.ts";
import { useLiveDelivery } from "../transport.ts";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Run detail is live; descriptive catalogs are read once for this screen entry. */
function useRunObservation(id: string) {
  const { value: run, error: scopeError, synchronized } = useLiveRun(id);
  const delivery = useLiveDelivery();
  const catalog = useProjects(id);
  const unavailable = !!scopeError || !synchronized || delivery !== "current";
  const error =
    scopeError?.message ??
    ((run && unavailable) || delivery === "offline"
      ? "Observations unavailable. Saved history is retained."
      : "");
  return {
    run,
    error,
    unavailable,
    project: catalog?.find((item) => item.id === run?.task.projectId),
    projectsLoaded: catalog !== undefined,
  };
}

type RunObservation = ReturnType<typeof useRunObservation>;

/**
 * Marks Woke seen once per opened Run, as soon as its live view is current: the command
 * is refused while delivery synchronizes. A Run opened under Settings is marked once Settings
 * closes; Studio, Settings, canvas selection and viewport changes over it do not mark it again.
 */
function useRunOpened(id: string, current: boolean) {
  const settingsOpen = !!useSettings();
  const [seenError, setSeenError] = useState<{ id: string; message: string }>();
  // The opening being marked. Its answer applies while the same opening lasts, so Settings or
  // Studio opening over the Run before the answer arrives does not drop it.
  const marked = useRef<{ readonly id: string } | undefined>(undefined);
  useEffect(() => {
    if (!current || settingsOpen || marked.current?.id === id) return;
    const opening = { id };
    marked.current = opening;
    void api
      .markRunWokeSeen(id)
      .then(() => {
        if (marked.current === opening) setSeenError(undefined);
      })
      .catch(() => {
        if (marked.current === opening)
          setSeenError({
            id,
            message: "Could not mark Woke as seen. Reopen this Run to try again.",
          });
      });
  }, [id, current, settingsOpen]);
  return seenError?.id === id ? seenError.message : "";
}

function useEscapeToDeselect(active: boolean, deselect: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="menu"], [role="dialog"]')) return;
      deselect();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, deselect]);
}

/** Declares this screen's Run to Run actions, so the keyboard and desktop menu act on it. Live
 * updates replace the subject in place; clearing only on unmount keeps an unchanged native menu
 * from being rebuilt in between. */
function useOpenRunActions(entry: RunNavigationEntry | undefined, detail: RunDetail | undefined) {
  useLayoutEffect(() => runActions.setOpenRun({ entry, detail }), [entry, detail]);
  useLayoutEffect(() => () => runActions.setOpenRun(undefined), []);
}

/** What the inspector shows besides the overview: a selected Block, or the Run title, which is not a Block. */
type Inspected = { readonly blockId: string } | "run-title" | null;

/** A desktop route selects its Block, or shows the overview, once per navigation that carries it. */
function useRoutedInspection(setInspected: (inspected: Inspected) => void) {
  const routedKey = useLocation({
    select: ({ state }) => (state.routedBlock === undefined ? undefined : state.__TSR_key),
  });
  const routedBlock = useLocation({ select: ({ state }) => state.routedBlock ?? null });
  const [appliedKey, setAppliedKey] = useState<string>();
  if (routedKey !== undefined && routedKey !== appliedKey) {
    setAppliedKey(routedKey);
    setInspected(routedBlock === null ? null : { blockId: routedBlock });
  }
}

export function RunScreen({ id }: { id: string }) {
  const observed = useRunObservation(id);
  const { value: runs } = useLiveNavigation();
  const navigationRun = runs?.find((run) => run.id === id);
  const [inspected, setInspected] = useState<Inspected>(null);
  useRoutedInspection(setInspected);
  const deselect = useCallback(() => setInspected(null), []);
  const seenError = useRunOpened(id, !observed.unavailable);
  useEscapeToDeselect(inspected !== null, deselect);
  const { run, error } = observed;
  useOpenRunActions(navigationRun, run ?? undefined);
  return (
    <CanvasLayout>
      {run ? (
        <RunDetailView
          observed={observed}
          entry={navigationRun}
          run={run}
          seenError={seenError}
          inspected={inspected}
          onInspect={setInspected}
        />
      ) : (
        <>
          {(error || seenError) && (
            <Alert variant="destructive" className="m-3 mb-0">
              <AlertDescription>{error || seenError}</AlertDescription>
            </Alert>
          )}
          {!error && <p className="p-6 text-sm text-muted-foreground">Loading Run…</p>}
        </>
      )}
    </CanvasLayout>
  );
}

function RunDetailView({
  observed,
  entry,
  run,
  seenError,
  inspected,
  onInspect,
}: {
  observed: RunObservation;
  entry: RunNavigationEntry | undefined;
  run: RunDetail;
  seenError: string;
  inspected: Inspected;
  onInspect: (inspected: Inspected) => void;
}) {
  const settings = useSettings();
  const studio = useStudio();
  const inspectorOpen = useRunInspectorOpen();
  const selected = inspected !== null && inspected !== "run-title" ? inspected.blockId : null;
  const onSelect = (blockId: string | null) => onInspect(blockId === null ? null : { blockId });
  const inspectedTitle = inspected === "run-title" ? run.titleGeneration : null;
  const unavailable = observed.unavailable;
  const freshness = runFreshness(run, unavailable);
  const projectUnavailable = entry
    ? entry.project.availability !== "available"
    : projectIsUnavailable(observed.project, observed.projectsLoaded);
  return (
    <T3LinksAvailable value={!projectUnavailable}>
      <RunTopBar
        run={run}
        entry={entry}
        project={entry?.project ?? observed.project}
        projectUnavailable={projectUnavailable}
        freshness={freshness}
        inspectorOpen={inspectorOpen}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-72 flex-1">
            <ExecutionCanvas
              shown={!settings && !studio}
              run={run}
              selected={selected}
              observationUnavailable={unavailable}
              onSelect={onSelect}
              title={{
                inspected: inspectedTitle !== null,
                onInspect: () => onInspect("run-title"),
              }}
              overlay={
                <CanvasOverlay
                  run={run}
                  observed={observed}
                  freshness={freshness}
                  seenError={seenError}
                />
              }
            />
          </div>
          {!inspectorOpen && attentionPending(run) && (
            <div className="max-h-60 shrink-0 overflow-auto border-t px-4 py-3">
              <RunAttentionDetails run={run} />
            </div>
          )}
          <RunTimeline run={run} selectedBlockId={selected} />
        </div>
        {inspectorOpen && (
          <RunInspector
            run={run}
            selected={selected}
            titleGeneration={inspectedTitle}
            project={observed.project}
            projectUnavailable={projectUnavailable}
            waitingForWorkers={entry !== undefined && waitsForWorkerConfirmation(entry)}
            observationUnavailable={unavailable}
            onSelect={onSelect}
          />
        )}
      </div>
    </T3LinksAvailable>
  );
}

function projectIsUnavailable(project: FactoryProject | undefined, loaded: boolean) {
  return loaded && (!project || project.availability !== "available");
}

const metaClass = "text-2xs leading-3 text-subtle-foreground";

/** Run top bar: title and meta, Run actions, state and the primary conversation. */
function RunTopBar({
  run,
  entry,
  project,
  projectUnavailable,
  freshness,
  inspectorOpen,
}: {
  run: RunDetail;
  entry: RunNavigationEntry | undefined;
  project: RunNavigationEntry["project"] | undefined;
  projectUnavailable: boolean;
  freshness: RunFreshness;
  inspectorOpen: boolean;
}) {
  const { hint } = useShortcutPreferences();
  const inspectorHint = hint("toggleInspector");
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b pr-4 pl-5">
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-base leading-4 font-semibold tracking-[-0.26px]">
            {run.title}
          </h1>
          {run.lifecycle === "active" && entry?.presentation.snoozed && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border bg-muted px-1.5 text-2xs leading-4 text-muted-foreground">
              <Moon aria-hidden className="size-3" strokeWidth={1.5} />
              Snoozed · until new attention
            </span>
          )}
          <GeneratingTitle generation={run.titleGeneration} />
        </div>
        <p className={cn(metaClass, "flex min-w-0 items-center gap-1.5 whitespace-nowrap")}>
          {run.number !== null && (
            <>
              <RunNumber number={run.number} />
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate font-medium">{project?.title ?? "Project"}</span>
          {projectUnavailable && <StatusBadge kind="neutral">Not in T3</StatusBadge>}
          <span aria-hidden>·</span>
          <Workflow aria-hidden className="size-2.75 shrink-0" strokeWidth={1.75} />
          <RunFlowName run={run} />
          <span aria-hidden>·</span>
          <span aria-label="Run lifecycle" className="tracking-label">
            {lifecycleText(run)}
          </span>
          {run.origin && <RunOriginMeta origin={run.origin} />}
        </p>
      </div>
      <NotLiveMarker freshness={freshness} />
      <RunConversationAction run={run} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle inspector"
            aria-pressed={inspectorOpen}
            onClick={toggleRunInspector}
          >
            <PanelRight aria-hidden strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent shortcut={inspectorHint}>
          {inspectorOpen ? "Hide inspector" : "Show inspector"}
        </TooltipContent>
      </Tooltip>
      {run.lifecycle !== "archived" && <RunActionsMenu run={run} entry={entry} />}
    </header>
  );
}

/** The Run's Flow, linking to it in Studio while the Flow exists. */
function RunFlowName({ run }: { run: RunDetail }) {
  const name = (
    <>
      <span className="sr-only">Flow for this Run: </span>
      {run.flowName}
    </>
  );
  if (run.currentFlowRevision === null) return <span className="truncate font-medium">{name}</span>;
  return (
    <StudioLink
      selection={{ tab: "flows", flowId: run.flowId }}
      className="truncate font-medium text-subtle-foreground hover:text-foreground"
    >
      {name}
    </StudioLink>
  );
}

/** While a confirmed Settle waits for its workers, the meta line says when it was asked. */
function lifecycleText(run: RunDetail) {
  if (run.settlement) return `Settle requested ${dayAndTime(run.settlement.requestedAt)}`;
  if (run.lifecycle === "active") return `Started ${dayAndTime(run.startedAt)}`;
  const archived = run.lifecycle === "archived";
  const at = lifecycleAt(run, archived ? "run-archived" : "run-settled");
  const label = archived ? "Archived" : "Settled";
  return at ? `${label} ${dayAndTime(at)}` : label;
}

function RunActionsMenu({ run, entry }: { run: RunDetail; entry: RunNavigationEntry | undefined }) {
  const trigger = `run-actions-${run.id}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button id={trigger} type="button" variant="ghost" size="icon-sm" aria-label="Run actions">
          <Ellipsis aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-58">
        <RunActionItems subject={{ entry, detail: run }} surface="header" returnFocusId={trigger} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Figma RD15: shown only when the Flow changed after Start; the canvas keeps the captured revision. */
function RevisionBadge({ run }: { run: RunDetail }) {
  if (run.currentFlowRevision === run.definitions.flow.revision) return null;
  return (
    <p
      role="status"
      aria-label="Flow revision"
      className="flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs leading-4 whitespace-nowrap"
    >
      <StatusBadge kind="attention" icon={Info}>
        {run.currentFlowRevision === null ? "Flow removed since Start" : "Flow edited since Start"}
      </StatusBadge>
      <span className="truncate text-muted-foreground">
        · this Run keeps the revision captured {dayAndTime(run.startedAt)}
      </span>
    </p>
  );
}

/** Shown exactly while the header says Not live, from the same freshness. */
function ObservationBadge({ freshness }: { freshness: RunFreshness }) {
  if (freshness.live) return null;
  return (
    <p
      role="status"
      aria-label="Run observation"
      className="flex min-w-0 items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs leading-4 whitespace-nowrap"
    >
      <StatusBadge kind="attention" icon={Unplug}>
        Not live
      </StatusBadge>
      <span className="truncate text-muted-foreground">
        ·{" "}
        {freshness.lastObservedAt
          ? `showing what Factory last observed at ${clockTime(freshness.lastObservedAt)}`
          : "Factory has not observed this Run yet"}
      </span>
    </p>
  );
}

function CanvasOverlay({
  run,
  observed,
  freshness,
  seenError,
}: {
  run: RunDetail;
  observed: RunObservation;
  freshness: RunFreshness;
  seenError: string;
}) {
  // Start and live observation depend on readiness: keep it current while shown.
  const { presentation } = useConnectionState();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        <RevisionBadge run={run} />
        <ObservationBadge freshness={freshness} />
      </div>
      <RunConversationNotice coordinator={run.runCoordinator} />
      {observed.error && (
        <Notice tone="critical" icon={TriangleAlert} title={observed.error} className="w-140" />
      )}
      {seenError && (
        <Notice tone="attention" icon={TriangleAlert} title={seenError} className="w-140" />
      )}
      {run.lifecycle !== "archived" && presentation === "unavailable" && (
        <Notice
          tone="critical"
          icon={Unplug}
          title="T3 is disconnected"
          className="w-140"
          action={
            <NoticeSettingsLink selection={{ tab: "connection" }}>
              Open T3 connection settings
            </NoticeSettingsLink>
          }
        >
          Showing what Factory last observed. Blocks won’t advance here until Factory reconnects;
          nothing is lost.
        </Notice>
      )}
    </>
  );
}
