import type { ReportDraft, DraftGuardState } from "../draft-guard.ts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, Workflow, Zap, type LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  useStudioNavigation,
  useStudioOptions,
  type StudioSelection,
} from "../settings-navigation.ts";
import { FlowList } from "../routes/flows.tsx";
import { FlowDetail } from "../routes/flow-editor.tsx";
import { StudioAgentsPage } from "../routes/agents.tsx";
import { StudioTriggersPage } from "../routes/triggers.tsx";
import { CreateFlow } from "./create-flow.tsx";
import { triggersInError } from "./studio-triggers/trigger-health.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { WorkspaceDialogHeader } from "./workspace-dialog-header.tsx";
import { cn } from "@/lib/utils";
import { type StudioDraft, useStudioDraftGuard } from "../use-studio-draft-guard.ts";
import {
  createStudioDefinitions,
  useStudioRead,
  type StudioDefinitions,
} from "../studio-definitions.ts";
import type { FlowDraft, TriggerDefinition } from "@t3-factory/contracts";
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
  const registerEscape = useCallback((handler: () => void) => {
    escapeHandler.current = handler;
    return () => {
      if (escapeHandler.current === handler) escapeHandler.current = null;
    };
  }, []);
  return { escapeHandler, registerEscape };
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

/** The header's section: the destination, and for Triggers the opened page within it. */
function studioSection(selection: StudioSelection, triggers: readonly TriggerDefinition[] | null) {
  if (selection.tab === "flows") return "Flows";
  if (selection.tab === "agents") return "Agents";
  if (selection.kind) return "Triggers / New · GitHub Issues";
  if (selection.triggerId === "new") return "Triggers / New";
  const opened = triggers?.find((trigger) => trigger.id === selection.triggerId);
  return opened ? `Triggers / ${opened.name}` : "Triggers";
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
  const triggers = useStudioRead(definitions, "triggers").value;
  const keepEditing = useRetainedFlowReopen(blocker);
  const { escapeHandler, registerEscape } = useEscapeHandler();
  const close = () => void navigate(undefined);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !creating && blocker.status !== "blocked") close();
      }}
    >
      <DialogContent
        data-studio="true"
        presentation="workspace"
        showCloseButton={false}
        ref={dialog}
        className="inset-4 flex h-auto min-h-0 w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden bg-muted p-0 max-sm:inset-2 sm:max-w-none"
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
          }
        }}
      >
        <WorkspaceDialogHeader
          title="Studio"
          section={studioSection(selection, triggers)}
          description="Author global Flows and reusable Agent definitions, and automate when Runs start."
          onClose={close}
          closeLabel="Back to Runs"
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
        <DraftDiscardDialog blocker={blocker} onKeepEditing={keepEditing} />
        {creating && (
          <CreateFlow
            createFlow={definitions.createFlow}
            onClose={() => setCreating(false)}
            onCreated={(flow) => {
              finishCreating(flow);
              void navigate({ tab: "flows", flowId: flow.id });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Reopen a retained Flow only after the blocked navigation has finished cancelling. */
function useRetainedFlowReopen(blocker: ReturnType<typeof useStudioDraftGuard>) {
  const navigate = useStudioNavigation();
  const reopenFlow = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!reopenFlow.current || blocker.status !== "idle") return;
    const flowId = reopenFlow.current;
    reopenFlow.current = undefined;
    void navigate({ tab: "flows", flowId });
  }, [blocker.status, navigate]);
  return () => {
    if (blocker.status !== "blocked") return;
    const flow = blocker.drafts.find((draft) => draft.kind === "flow" && draft.removed);
    if (flow && blocker.drafts.length === 1) reopenFlow.current = flow.id;
    blocker.reset();
  };
}

const draftKinds = { flow: "Flow", agent: "Agent", trigger: "Trigger" } as const;

function discardMessage(drafts: readonly StudioDraft[]) {
  const kinds = drafts.map((draft) => draftKinds[draft.kind]);
  const both = drafts.length > 1;
  const removed = drafts.some((draft) => draft.removed);
  const named = kinds.join(" and ");
  if (removed)
    return {
      removed,
      title: both
        ? `Discard the ${named} drafts?`
        : `This ${named} was removed elsewhere. Discard the retained draft?`,
      description: drafts
        .map((draft) => {
          const kind = draftKinds[draft.kind];
          return draft.removed
            ? `This ${kind} was removed elsewhere. Its retained draft will be discarded.`
            : `Your ${kind} has unsaved changes that will be discarded.`;
        })
        .join(" "),
    };
  if (both)
    return {
      removed,
      title: `Discard unsaved ${named} changes?`,
      description: `Your ${named} have unsaved changes. Keep editing to save them, or discard both to continue.`,
    };
  return {
    removed,
    title: `Discard unsaved ${named} changes?`,
    description:
      drafts[0]?.kind === "flow"
        ? "Your Flow has unsaved changes. Keep editing to save them, or discard them to continue."
        : `This ${named} has unsaved changes. Keep editing to save them, or discard them to continue.`,
  };
}

function DraftDiscardDialog({
  blocker,
  onKeepEditing,
}: {
  blocker: ReturnType<typeof useStudioDraftGuard>;
  onKeepEditing: () => void;
}) {
  if (blocker.status !== "blocked") return null;
  const message = discardMessage(blocker.drafts);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) blocker.reset();
      }}
    >
      <DialogContent
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
      >
        <DialogTitle>{message.title}</DialogTitle>
        <DialogDescription>{message.description}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={blocker.proceed}>
            {message.removed ? "Discard" : "Discard changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const railLinkClass =
  "flex h-8.5 items-center gap-2 rounded-md px-3 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50";

function RailLink({
  selection,
  current,
  label,
  icon: Icon,
  count,
  alert = false,
  describedBy,
}: {
  selection: StudioSelection;
  current: boolean;
  label: string;
  icon: LucideIcon;
  count: number | undefined;
  /** The count is of definitions in Error, not of all definitions. */
  alert?: boolean;
  describedBy?: string | undefined;
}) {
  const options = useStudioOptions(selection);
  return (
    <Link
      {...options}
      aria-label={label}
      aria-describedby={describedBy}
      aria-current={current ? "page" : undefined}
      className={cn(
        railLinkClass,
        current ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={1.5} />
      {label}
      <span
        aria-hidden
        className={cn(
          "ml-auto text-2xs font-medium",
          alert ? "text-destructive" : "text-subtle-foreground",
        )}
      >
        {count}
      </span>
    </Link>
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
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r bg-sidebar max-sm:w-36">
      <nav aria-label="Studio navigation" className="grid gap-0.5 px-3 pt-3">
        <p className="px-3 pb-1 text-2xs font-semibold tracking-section text-subtle-foreground">
          AUTHOR
        </p>
        <RailLink
          selection={{ tab: "flows" }}
          current={selection.tab === "flows"}
          label="Flows"
          icon={Workflow}
          count={flows?.length}
        />
        <RailLink
          selection={{ tab: "agents" }}
          current={selection.tab === "agents"}
          label="Agents"
          icon={Bot}
          count={agents?.length}
        />
        <p className="px-3 pt-3 pb-1 text-2xs font-semibold tracking-section text-subtle-foreground">
          AUTOMATE
        </p>
        <RailLink
          selection={{ tab: "triggers" }}
          current={selection.tab === "triggers"}
          label="Triggers"
          icon={Zap}
          count={failing || triggers?.length}
          alert={failing > 0}
          describedBy={failing ? "studio-triggers-failing" : undefined}
        />
        {failing > 0 && (
          <span id="studio-triggers-failing" className="sr-only">
            {triggersInError(failing)}
          </span>
        )}
      </nav>
    </aside>
  );
}

/** The destination's page; an opened Flow's editor is kept separately so it survives navigation. */
function StudioPage({
  selection,
  definitions,
  reportAgentDraft,
  reportTriggerDraft,
  onCreateFlow,
}: {
  selection: StudioSelection;
  definitions: StudioDefinitions;
  reportAgentDraft: ReportDraft;
  reportTriggerDraft: ReportDraft;
  onCreateFlow: () => void;
}) {
  if (selection.tab === "agents")
    return (
      <StudioAgentsPage
        agentId={selection.agentId}
        definitions={definitions}
        reportAgentDraft={reportAgentDraft}
      />
    );
  if (selection.tab === "flows" && selection.flowId) return null;
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {selection.tab === "triggers" ? (
        <StudioTriggersPage
          selection={selection}
          definitions={definitions}
          reportTriggerDraft={reportTriggerDraft}
        />
      ) : (
        <FlowList definitions={definitions} onCreate={onCreateFlow} />
      )}
    </div>
  );
}

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
  const flowId = selection.tab === "flows" ? selection.flowId : undefined;
  // Keep the current Flow mounted across library and Agent navigation, including its local draft.
  const [openedFlowId, setOpenedFlowId] = useState(flowId);
  if (flowId && openedFlowId !== flowId) setOpenedFlowId(flowId);
  const flowHidden = selection.tab !== "flows" || flowId !== openedFlowId;
  return (
    <div
      ref={content}
      tabIndex={-1}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
    >
      <StudioPage
        selection={selection}
        definitions={definitions}
        reportAgentDraft={reportAgentDraft}
        reportTriggerDraft={reportTriggerDraft}
        onCreateFlow={creation.start}
      />
      {openedFlowId && (
        <div
          key={openedFlowId}
          className={flowHidden ? "hidden" : "min-h-0 flex-1 overflow-auto"}
          inert={flowHidden}
        >
          <FlowDetail
            id={openedFlowId}
            definitions={definitions}
            active={!flowHidden}
            registerEscape={registerEscape}
            reportDraft={reportFlowDraft}
            created={creation.created}
          />
        </div>
      )}
    </div>
  );
}
