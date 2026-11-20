import type { ReportDraft, DraftGuardState } from "../draft-guard.ts";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, Workflow, Zap } from "lucide-react";
import { useStudioNavigation, type StudioSelection } from "../settings-navigation.ts";
import { FlowList } from "../routes/flows.tsx";
import { FlowDetail } from "../routes/flow-editor.tsx";
import { StudioAgentsPage } from "../routes/agents.tsx";
import { StudioTriggersPage } from "../routes/triggers.tsx";
import { StudioLink } from "./app-link.tsx";
import { CreateFlow } from "./create-flow.tsx";
import { triggersInError } from "./studio-triggers/trigger-health.tsx";
import { Dialog, DialogContent, DialogSurface } from "./ui/dialog";
import { Button } from "./ui/button";
import { NavRow } from "./ui/nav-row";
import { TextLink } from "./ui/text-link";
import { WorkspaceDialogHeader } from "./workspace-dialog-header.tsx";
import { cn } from "@/lib/utils";
import { type StudioDraft, useStudioDraftGuard } from "../use-studio-draft-guard.ts";
import {
  createStudioDefinitions,
  useStudioRead,
  type StudioDefinitions,
} from "../studio-definitions.ts";
import type { AgentDefinition, FlowDraft, TriggerDefinition } from "@t3-factory/contracts";
import { liveOwner } from "../live/live-connection.ts";

/** This Studio session's saved definitions, delivered live while Studio is open. */
function useStudioSession() {
  const [definitions] = useState(() => createStudioDefinitions(liveOwner()));
  useLayoutEffect(() => definitions.open(), [definitions]);
  return definitions;
}

/** The Escape handler an open Studio page registers; Studio runs it instead of closing. */
function useEscapeHandler() {
  const escapeHandler = useRef<(() => void) | null>(null);
  // A page that takes Escape (an open block panel) shows its own Esc chip instead of the header's.
  const [escapeTaken, setEscapeTaken] = useState(false);
  const registerEscape = useCallback((handler: () => void) => {
    escapeHandler.current = handler;
    setEscapeTaken(true);
    return () => {
      if (escapeHandler.current !== handler) return;
      escapeHandler.current = null;
      setEscapeTaken(false);
    };
  }, []);
  return { escapeHandler, escapeTaken, registerEscape };
}

/**
 * Whether New Flow's dialog is open, and the Flow it created last: its editor opens from the
 * create answer, which can arrive before Studio receives the Flow.
 */
function useFlowCreation() {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<FlowDraft>();
  const finishCreating = useCallback((flow: FlowDraft) => {
    setCreating(false);
    setCreated(flow);
  }, []);
  return { creating, created, setCreating, finishCreating };
}

/** One kind's unsaved or removed draft, reported by its editor, as state and as a current ref. */
function useReportedDraft(kind: StudioDraft["kind"]) {
  const [draft, setDraft] = useState<StudioDraft>();
  const ref = useRef<StudioDraft | undefined>(undefined);
  const report = useCallback(
    (id: string, state: DraftGuardState) => {
      if (!state.dirty && !state.removed && ref.current?.id !== id) return;
      const next = state.dirty || state.removed ? { kind, id, ...state } : undefined;
      ref.current = next;
      setDraft(next);
    },
    [kind],
  );
  return { draft, ref, report };
}

/** Each Agent's last listed name, kept after it leaves the list. */
function useLastAgentNames(agents: readonly AgentDefinition[] | null) {
  const [names] = useState(() => new Map<string, string>());
  agents?.forEach((agent) => names.set(agent.id, agent.name));
  return names;
}

function breadcrumbParent(label: string, selection: StudioSelection) {
  return {
    label,
    link: (
      <TextLink asChild tone="neutral" className="shrink-0 font-normal">
        <StudioLink selection={selection}>{label}</StudioLink>
      </TextLink>
    ),
  };
}

function useTriggerTitle(id: string | undefined, triggers: readonly TriggerDefinition[] | null) {
  const name = triggers?.find((trigger) => trigger.id === id)?.name;
  const [lastOpened, setLastOpened] = useState<{ id: string; name: string }>();
  if (id && name && (id !== lastOpened?.id || name !== lastOpened.name)) {
    setLastOpened({ id, name });
  }
  if (id === "new") return "New GitHub Issues Trigger";
  return name ?? (lastOpened?.id === id ? lastOpened?.name : undefined) ?? "Trigger";
}

type FlowSelection = Extract<StudioSelection, { tab: "flows" }>;

function selectedFlow(selection: StudioSelection): FlowSelection | undefined {
  if (selection.tab === "flows") return selection;
  if (selection.tab === "agents" && selection.fromFlow)
    return {
      tab: "flows",
      flowId: selection.fromFlow,
      ...(selection.fromTrigger && { fromTrigger: selection.fromTrigger }),
    };
  return undefined;
}

function selectedTrigger(selection: StudioSelection) {
  if (selection.tab === "triggers") return selection;
  if (selection.fromTrigger) return { tab: "triggers" as const, triggerId: selection.fromTrigger };
  return undefined;
}

function flowParents(fromTrigger: string | undefined, triggerName: string) {
  return fromTrigger
    ? [
        breadcrumbParent("Triggers", { tab: "triggers" }),
        breadcrumbParent(triggerName, { tab: "triggers", triggerId: fromTrigger }),
      ]
    : [breadcrumbParent("Flows", { tab: "flows" })];
}

/** The header links the parents of the editor or list currently shown. */
function studioSection(
  selection: StudioSelection,
  triggerName: string,
  flowName: string | undefined,
  lists: AgentCrumbLists,
) {
  if (selection.tab === "flows")
    return selection.flowId
      ? { parents: flowParents(selection.fromTrigger, triggerName), section: flowName ?? "Flow" }
      : { section: "Flows" };
  if (selection.tab === "agents") return agentSection(selection, lists, triggerName, flowName);
  if (!selection.triggerId) return { section: "Triggers" };
  return {
    parents: [breadcrumbParent("Triggers", { tab: "triggers" })],
    section: triggerName,
  };
}

function useStudioHeader(selection: StudioSelection, definitions: StudioDefinitions) {
  const triggers = useStudioRead(definitions, "triggers").value;
  const flows = useStudioRead(definitions, "flows").value;
  const agents = useStudioRead(definitions, "agents").value;
  const agentNames = useLastAgentNames(agents);
  const trigger = selectedTrigger(selection);
  const flow = selectedFlow(selection);
  const triggerName = useTriggerTitle(trigger?.triggerId, triggers);
  const flowName = flows?.find((entry) => entry.id === flow?.flowId)?.name;
  return {
    title: trigger ? breadcrumbParent("Studio", { tab: "flows" }).link : "Studio",
    section: studioSection(selection, triggerName, flowName, { agents, agentNames }),
    /** Saved names for the leave dialog. */
    names: leaveDialogNames(flows, agentNames),
    ...studioReturn(selection),
  };
}

/**
 * Where closing the shown page returns: a Flow opened from a Trigger to that Trigger, an Agent
 * opened from the Flow editor to that Flow, and otherwise out of Studio.
 */
function studioReturn(selection: StudioSelection) {
  if (selection.tab === "flows" && selection.fromTrigger)
    return {
      closeLabel: "Back to Trigger",
      returnTo: selectedTrigger(selection),
    };
  if (selection.tab === "agents" && selection.fromFlow)
    return {
      closeLabel: "Back to Flow",
      returnTo: selectedFlow(selection),
    };
  return { closeLabel: "Back to Runs", returnTo: undefined };
}

/** Esc from an open Flow, Agent or Trigger with no other return goes back to its list. */
function studioList(selection: StudioSelection): StudioSelection | undefined {
  if (selection.tab === "flows" && selection.flowId) return { tab: "flows" };
  if (selection.tab === "agents" && selection.agentId) return { tab: "agents" };
  if (selection.tab === "triggers" && selection.triggerId) return { tab: "triggers" };
  return undefined;
}

/** The saved names the leave dialog quotes. */
const leaveDialogNames = (
  flows: readonly FlowDraft[] | null,
  agentNames: ReadonlyMap<string, string>,
) => ({
  flow: (id: string) => flows?.find((entry) => entry.id === id)?.name ?? "Flow",
  agent: (id: string) => agentNames.get(id) ?? "Agent",
});

type AgentCrumbLists = {
  readonly agents: readonly AgentDefinition[] | null;
  readonly agentNames: ReadonlyMap<string, string>;
};

/**
 * An Agent page's breadcrumb ends with the opened Agent's name, or New Agent; one opened from a
 * Flow editor (New Agent, Open Agent) nests under that Flow.
 */
function agentSection(
  selection: Extract<StudioSelection, { tab: "agents" }>,
  lists: AgentCrumbLists,
  triggerName: string,
  flowName: string | undefined,
) {
  const { agentId } = selection;
  if (agentId === undefined) return { section: "Agents" };
  const flow = selectedFlow(selection);
  const parents = flow
    ? [...flowParents(flow.fromTrigger, triggerName), breadcrumbParent(flowName ?? "Flow", flow)]
    : [breadcrumbParent("Agents", { tab: "agents" })];
  if (agentId === "new") return { parents, section: "New Agent" };
  const agent = lists.agents?.find((entry) => entry.id === agentId);
  // An Agent removed elsewhere keeps its open draft, so the breadcrumb keeps its last name.
  const name = agent?.name ?? lists.agentNames.get(agentId);
  if (name === undefined) return { section: "Agents" };
  return { parents, section: name };
}

export function StudioModal({ selection }: { selection: StudioSelection }) {
  const navigate = useStudioNavigation();
  const definitions = useStudioSession();
  const dialog = useRef<HTMLDivElement>(null);
  const { creating, created, setCreating, finishCreating } = useFlowCreation();
  const flow = useReportedDraft("flow");
  const agent = useReportedDraft("agent");
  const trigger = useReportedDraft("trigger");
  const blocker = useStudioDraftGuard({
    flow: flow.draft,
    agent: agent.draft,
    trigger: trigger.draft,
    flowRef: flow.ref,
    agentRef: agent.ref,
    triggerRef: trigger.ref,
  });
  const { escapeHandler, escapeTaken, registerEscape } = useEscapeHandler();
  const header = useStudioHeader(selection, definitions);
  const close = () => void navigate(header.returnTo);
  const escapeTo = header.returnTo ?? studioList(selection);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !creating && blocker.status !== "blocked") close();
      }}
    >
      <DialogSurface
        data-studio="true"
        presentation="workspace"
        ref={dialog}
        className="flex h-[calc(100vh-32px)] w-[calc(100vw-32px)] flex-col overflow-hidden bg-muted"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dialog.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (creating || blocker.status === "blocked") {
            event.preventDefault();
            return;
          }
          if (escapeHandler.current) {
            event.preventDefault();
            escapeHandler.current();
          } else if (escapeTo) {
            event.preventDefault();
            void navigate(escapeTo);
          }
        }}
      >
        <WorkspaceDialogHeader
          title={header.title}
          {...header.section}
          escChip={!escapeTaken && escapeTo === header.returnTo}
          description="Author Flows and reusable Agent definitions, global or owned by one Project, and automate when Runs start."
          onClose={close}
          closeLabel={header.closeLabel}
          closeDisabled={creating}
        />
        <div className="flex min-h-0 flex-1">
          <StudioSidebar selection={selection} definitions={definitions} />
          <StudioContent
            selection={selection}
            definitions={definitions}
            registerEscape={registerEscape}
            reportFlowDraft={flow.report}
            reportAgentDraft={agent.report}
            reportTriggerDraft={trigger.report}
            creation={{ start: () => setCreating(true), created }}
          />
        </div>
        <DraftDiscardDialog blocker={blocker} names={header.names} />
        {creating && (
          <CreateFlow
            definitions={definitions}
            onClose={() => setCreating(false)}
            onCreated={(flow) => {
              finishCreating(flow);
              void navigate({ tab: "flows", flowId: flow.id });
            }}
          />
        )}
      </DialogSurface>
    </Dialog>
  );
}

const draftKinds = { flow: "Flow", agent: "Agent", trigger: "Trigger" } as const;

function discardMessage(draft: StudioDraft, name: string | undefined) {
  const kind = draftKinds[draft.kind];
  if (draft.removed)
    return {
      title: `This ${kind} was removed elsewhere. Discard the retained draft?`,
      description: "Discard the retained draft to continue.",
      discard: "Discard",
    };
  // Figma SA06v: the Agent editor's guard is the short form; Flow and Trigger keep theirs until
  // their own reviews (#519, #518) move to it.
  if (draft.kind === "agent")
    return {
      title: "Discard unsaved changes?",
      description: undefined,
      discard: "Discard changes",
    };
  return {
    title: "Discard unsaved changes?",
    description: `${name ? `“${name}”` : `This ${kind}`} has changes that aren’t saved.`,
    discard: "Discard changes",
  };
}

function DraftDiscardDialog({
  blocker,
  names,
}: {
  blocker: ReturnType<typeof useStudioDraftGuard>;
  /** The saved name of a Flow or Agent draft. */
  names: { readonly flow: (id: string) => string; readonly agent: (id: string) => string };
}) {
  if (blocker.status !== "blocked") return null;
  const { kind, id } = blocker.unsaved;
  const message = discardMessage(
    blocker.unsaved,
    kind === "flow"
      ? names.flow(id)
      : kind === "agent" && id !== "new"
        ? names.agent(id)
        : undefined,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) blocker.reset();
      }}
    >
      <DialogContent
        title={message.title}
        description={message.description}
        actions={
          <>
            <Button variant="outline" onClick={blocker.reset}>
              Keep editing
            </Button>
            <Button variant="destructive" onClick={blocker.proceed}>
              {message.discard}
            </Button>
          </>
        }
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            blocker.reset();
          }
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          blocker.reset();
        }}
      ></DialogContent>
    </Dialog>
  );
}

function StudioSidebar({
  selection,
  definitions,
}: {
  selection: StudioSelection;
  definitions: StudioDefinitions;
}) {
  const flows = useStudioRead(definitions, "flows").value;
  const agents = useStudioRead(definitions, "agents").value;
  const triggers = useStudioRead(definitions, "triggers").value;
  const failing = triggers?.filter((trigger) => trigger.error).length ?? 0;
  const groups = [
    {
      heading: "Author",
      rows: [
        { tab: "flows", label: "Flows", icon: Workflow, count: flows?.length },
        { tab: "agents", label: "Agents", icon: Bot, count: agents?.length },
      ],
    },
    {
      heading: "Automate",
      rows: [{ tab: "triggers", label: "Triggers", icon: Zap, count: failing || triggers?.length }],
    },
  ] as const;
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r bg-sidebar max-sm:w-36">
      <nav aria-label="Studio navigation" className="grid gap-0.5 px-3 pt-3">
        {groups.map(({ heading, rows }, index) => (
          <Fragment key={heading}>
            <p
              className={cn(
                "px-3 pb-1 text-2xs font-semibold tracking-section text-subtle-foreground",
                index > 0 && "pt-3",
              )}
            >
              {heading}
            </p>
            {rows.map(({ tab, label, icon: Icon, count }) => {
              const hasErrors = tab === "triggers" && failing > 0;
              return (
                <NavRow key={tab} asChild density="regular" selected={selection.tab === tab}>
                  <StudioLink
                    selection={{ tab }}
                    aria-label={label}
                    aria-describedby={hasErrors ? "studio-triggers-failing" : undefined}
                  >
                    <Icon aria-hidden className="size-4" strokeWidth={1.5} />
                    {label}
                    <span
                      aria-hidden
                      className={cn(
                        "ml-auto text-2xs font-medium",
                        hasErrors ? "text-destructive" : "text-subtle-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </StudioLink>
                </NavRow>
              );
            })}
          </Fragment>
        ))}
        {failing > 0 && (
          <span id="studio-triggers-failing" className="sr-only">
            {triggersInError(failing)}
          </span>
        )}
      </nav>
    </aside>
  );
}

/** A hidden Flow editor takes no Escape; the page shown over it does. */
const ignoreEscape = () => () => {};

function StudioContent({
  selection,
  definitions,
  registerEscape,
  reportFlowDraft,
  reportAgentDraft,
  reportTriggerDraft,
  creation,
}: {
  selection: StudioSelection;
  definitions: StudioDefinitions;
  registerEscape: (handler: () => void) => () => void;
  /** New Flow, and the Flow it created last, which can open before Studio receives it. */
  creation: { readonly start: () => void; readonly created: FlowDraft | undefined };
  reportFlowDraft: ReportDraft;
  reportAgentDraft: ReportDraft;
  reportTriggerDraft: ReportDraft;
}) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      (focused.closest("[inert]") || focused === document.body)
    ) {
      content.current?.focus();
    }
  }, [selection]);
  // Keep any covered editors mounted, with the same identity when they come back to the front.
  const flow = selectedFlow(selection);
  const flowId = flow?.flowId;
  const flowShown = selection.tab === "flows";
  const trigger = selectedTrigger(selection);
  const triggerShown = selection.tab === "triggers";
  return (
    <div
      ref={content}
      tabIndex={-1}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
    >
      {trigger && (
        <div hidden={!triggerShown} inert={!triggerShown} className="min-h-0 flex-1 overflow-auto">
          <StudioTriggersPage
            selection={trigger}
            definitions={definitions}
            reportTriggerDraft={reportTriggerDraft}
          />
        </div>
      )}
      {flowId && (
        <div
          key={flowId}
          hidden={!flowShown}
          inert={!flowShown}
          className="min-h-0 flex-1 overflow-auto"
        >
          <FlowDetail
            id={flowId}
            definitions={definitions}
            registerEscape={flowShown ? registerEscape : ignoreEscape}
            reportDraft={reportFlowDraft}
            created={creation.created}
          />
        </div>
      )}
      {selection.tab === "agents" && (
        <StudioAgentsPage
          agentId={selection.agentId}
          returnToFlow={flow}
          definitions={definitions}
          reportAgentDraft={reportAgentDraft}
        />
      )}
      {flowShown && !flowId && (
        <div className="min-h-0 flex-1 overflow-auto">
          <FlowList definitions={definitions} onCreate={creation.start} />
        </div>
      )}
    </div>
  );
}
