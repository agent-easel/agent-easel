import { StudioRemovedDraft } from "../components/studio-removed-draft.tsx";
import { MutationGate } from "@/client-gate";
import { useDraftGuard, type ReportDraft } from "../draft-guard.ts";
import { CanvasLayout } from "../components/screen-layout.tsx";
import { useComposerNavigation } from "../run-draft.ts";
import { useCallback, useEffect, useRef, useState, type FocusEvent, type RefObject } from "react";
import type { AgentDefinition, FlowBlock, FlowDraft, FlowGraph } from "@t3-factory/contracts";
import {
  ArrowLeft,
  Check,
  CircleDot,
  ListChecks,
  RefreshCw,
  Save,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "../api.ts";
import { BLOCK_KINDS } from "../block-kind.ts";
import { StudioLink } from "../components/app-link.tsx";
import { useStudioNavigation } from "../settings-navigation.ts";
import { BlockConfiguration } from "../components/block-inspector.tsx";
import { BlockLibrary } from "../components/block-library.tsx";
import { FlowCanvas, type DropAt } from "../components/flow-canvas.tsx";
import { IssueLink, ReadinessPanel, type IssueSelect } from "../components/flow-readiness.tsx";
import type { ConditionEditing, RuleFocus } from "../components/condition-rules.tsx";
import { FlowWorkspaceControl } from "../components/flow-workspace-control.tsx";
import {
  DefinitionExportControl,
  definitionExportNotice,
} from "../components/definition-export-control.tsx";
import { useDefinitionExport } from "../definition-export.ts";
import { Page } from "../components/page.tsx";
import {
  hasWire,
  newBlock,
  removeBlock,
  removeWire,
  replaceBlock,
  type BlockPosition,
  type FlowWire,
} from "../flow-graph.ts";
import {
  createFlowDraft,
  useFlowDraftSnapshot,
  type FlowContent,
  type FlowDraftModel,
  type FlowDraftSnapshot,
} from "../flow-draft.ts";
import type { RevisionConflict } from "../revisioned-draft.ts";
import {
  placeableAgents,
  studioOwner,
  useStudioOwners,
  useStudioRead,
  type StudioDefinitions,
  type StudioOwner,
} from "../studio-definitions.ts";
import { OwnerBadge } from "../components/studio-owner.tsx";

/**
 * This editor's Flow draft, following the Flow through Studio's saved definitions and told when
 * the editor is hidden. Studio's guard learns of
 * changes to unsaved changes from the draft's notification itself, before any render, and only
 * when that fact changes.
 */
function useOpenedFlowDraft(
  id: string,
  definitions: StudioDefinitions,
  active: boolean,
  reportDraft: ReportDraft,
  created: FlowDraft | undefined,
) {
  const [draft] = useState(() =>
    createFlowDraft(id, definitions, api, created?.id === id ? created : undefined),
  );
  useEffect(() => draft.open(), [draft]);
  // Hiding or unmounting a shown editor ends it, so a late readiness answer is not shown.
  useEffect(() => (active ? () => draft.hide() : undefined), [draft, active]);
  useDraftGuard(draft, id, reportDraft);
  const interactions = useInteractionReports(draft, active);
  return { draft, state: useFlowDraftSnapshot(draft), interactions };
}

/** Whether focus in `target` means the user is typing into a field. */
function isTextEntry(target: EventTarget) {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement &&
    !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(
      target.type,
    )
  );
}

type Interaction = "pointer" | "text" | "composition" | "arrange";

/**
 * Tells the draft about the interactions a newer saved revision waits for: a pointer gesture
 * on the library or canvas (block, library and wire drags), focus in a draft field, text
 * composition and an Auto-arrange run. The pointer gesture ends after the release has reached
 * its drop handler, so a drop's edit counts. Hiding the editor ends every interaction.
 */
function useInteractionReports(draft: FlowDraftModel, active: boolean) {
  const ends = useRef(new Map<Interaction, () => void>());
  const begin = useCallback(
    (kind: Interaction) => {
      if (!ends.current.has(kind)) ends.current.set(kind, draft.interact());
    },
    [draft],
  );
  const end = useCallback((kind: Interaction) => {
    ends.current.get(kind)?.();
    ends.current.delete(kind);
  }, []);
  useEffect(() => {
    if (!active) return;
    const open = ends.current;
    const release = () => end("pointer");
    // Bubbling to the window runs after React's handlers at the root, including drops.
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      for (const finish of open.values()) finish();
      open.clear();
    };
  }, [active, end]);
  const reportArranging = useCallback(
    (arranging: boolean) => (arranging ? begin("arrange") : end("arrange")),
    [begin, end],
  );
  return {
    gestures: { onPointerDownCapture: () => begin("pointer") },
    fields: {
      onFocus: (event: FocusEvent) => {
        if (isTextEntry(event.target)) begin("text");
      },
      onBlur: (event: FocusEvent) => {
        if (isTextEntry(event.target)) end("text");
      },
      onCompositionStart: () => begin("composition"),
      onCompositionEnd: () => end("composition"),
    },
    reportArranging,
  };
}

/** Keeps the last selected block rendered while the floating panel plays its close motion. */
function usePanelBlock(block: FlowBlock | undefined) {
  const [panel, setPanel] = useState<{ block: FlowBlock | undefined; closing: FlowBlock | null }>({
    block,
    closing: null,
  });
  if (panel.block !== block) {
    setPanel({ block, closing: block ? null : (panel.block ?? panel.closing) });
  }
  const { closing } = panel;
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(
      () => setPanel((current) => ({ ...current, closing: null })),
      PANEL_CLOSE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [closing]);
  return closing;
}

/** Whether a key press belongs to a text field or other form control rather than the canvas. */
function isEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

const DIALOG = '[role="dialog"],[role="alertdialog"]';

/**
 * Whether a key press comes from the editor's own layer: not from a dialog opened over it
 * (such as a discard confirmation), whose focused buttons must not edit the draft behind it.
 */
function inEditorLayer(scope: HTMLElement | null, target: EventTarget | null) {
  const own = scope?.closest(DIALOG) ?? null;
  const at = target instanceof Element ? target.closest(DIALOG) : null;
  return at === own || target === document.body;
}

/** Unmodified Delete or Backspace in the editor's layer, outside form controls, runs `onDelete` while `enabled`. */
function useDeleteKey(
  scope: RefObject<HTMLElement | null>,
  enabled: boolean,
  onDelete: () => void,
) {
  const latest = useRef(onDelete);
  useEffect(() => {
    latest.current = onDelete;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      // A modified press belongs to an app shortcut (Mod+Backspace is Archive), which may be
      // blocked over Studio without preventing the key's default.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.defaultPrevented || isEditing(event.target)) return;
      if (!inEditorLayer(scope.current, event.target)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, scope]);
}

/**
 * The canvas selection: one block (its panel open) or one wire, never both. A selected wire
 * that is no longer in the graph counts as unselected. While this editor is active, Escape
 * clears the selection, and Delete or Backspace removes the selected wire.
 */
function useCanvasSelection(
  canvas: RefObject<HTMLElement | null>,
  draft: { graph: FlowGraph; busy: boolean; change: (next: FlowGraph) => void },
  active: boolean,
  registerEscape: (handler: () => void) => () => void,
) {
  const { graph } = draft;
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedWire, setSelectedWire] = useState<FlowWire | null>(null);
  const wire = selectedWire && hasWire(graph, selectedWire) ? selectedWire : null;
  if (selectedWire && !wire) setSelectedWire(null);
  // A newer revision adopted while clean may no longer have the selected block.
  if (selected !== null && !graph.blocks.some((block) => block.id === selected)) setSelected(null);
  /** Selects a block, or with null clears every selection. */
  const select = useCallback((blockId: string | null) => {
    setSelected(blockId);
    setSelectedWire(null);
  }, []);
  const selectWire = useCallback((next: FlowWire | null) => {
    setSelectedWire(next);
    if (next) setSelected(null);
  }, []);
  const hasSelection = selected !== null || wire !== null;
  useEffect(() => {
    if (!active || !hasSelection) return;
    return registerEscape(() => select(null));
  }, [active, hasSelection, registerEscape, select]);
  function deleteWire(removed: FlowWire) {
    draft.change(removeWire(graph, removed));
    setSelectedWire(null);
    // The focused wire or delete button unmounts; keep keyboard focus on the canvas.
    canvas.current?.focus({ preventScroll: true });
  }
  useDeleteKey(canvas, active && !draft.busy && wire !== null, () => {
    if (wire) deleteWire(wire);
  });
  return { selected, wire, select, selectWire, deleteWire };
}

const noAgents: readonly AgentDefinition[] = [];

/**
 * Condition arrival-number text that is not a valid threshold, by block and rule. It stays shown
 * where it was typed, never enters the draft, and makes `invalid` true while its rule exists, so
 * the draft cannot be saved as something other than what is shown.
 */
function useThresholdEntries(graph: FlowGraph) {
  const [entries, setEntries] = useState<ReadonlyMap<string, ReadonlyMap<string, string>>>(
    () => new Map(),
  );
  const invalid = [...entries].some(([blockId, rules]) => {
    const block = graph.blocks.find((item) => item.id === blockId);
    return block?.kind === "condition" && block.rules.some((rule) => rules.has(rule.id));
  });
  function onEntry(blockId: string, ruleId: string, text: string | null) {
    setEntries((current) => {
      const rules = new Map(current.get(blockId));
      if (text === null) rules.delete(ruleId);
      else rules.set(ruleId, text);
      return new Map(current).set(blockId, rules);
    });
  }
  return { entries, invalid, onEntry };
}

const noEntries: ReadonlyMap<string, string> = new Map();

/** The Flow's owner in words, under its canvas. */
const ownerNote = (owner: StudioOwner) =>
  owner.projectId === null
    ? "Global Flow · usable in every project"
    : `Project Flow · owned by ${owner.title}`;

/**
 * Studio's saved Agents for the canvas, and for the block library only those the Flow's owner
 * may place; the last read stays offered during refreshes.
 */
function useLibraryAgents(definitions: StudioDefinitions, saved: FlowDraft | null) {
  const { value, error } = useStudioRead(definitions, "agents");
  const { projects } = useStudioOwners(definitions);
  const agents = value ?? noAgents;
  const projectId = saved?.projectId ?? null;
  const owner = studioOwner(projectId, projects);
  return {
    agents,
    agentError: error ? "Could not load saved Agents. Reopen this Flow to try again." : "",
    owner,
    library: { owner, projects, agents: placeableAgents(agents, { projectId }) },
  };
}

const PANEL_WIDTH = 344;
/** Matches `--duration-panel-out`; the reduced-motion fade is shorter and ends first. */
const PANEL_CLOSE_MS = 140;

export function FlowDetail({
  id,
  definitions,
  active,
  registerEscape,
  reportDraft,
  created,
}: {
  id: string;
  definitions: StudioDefinitions;
  active: boolean;
  registerEscape: (handler: () => void) => () => void;
  reportDraft: ReportDraft;
  /** This Studio's latest create answer, which can arrive before Studio receives that Flow. */
  created: FlowDraft | undefined;
}) {
  const canvas = useRef<HTMLElement>(null);
  const placement = useRef<DropAt | null>(null);
  const { draft, state, interactions } = useOpenedFlowDraft(
    id,
    definitions,
    active,
    reportDraft,
    created,
  );
  const exporter = useDefinitionExport(() => api.exportFlow(id));
  const { saved, error, readiness } = state;
  const { agents, agentError, owner, library } = useLibraryAgents(definitions, saved);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const { graph, name } = state.content;
  const change = (next: FlowGraph) => draft.edit({ graph: next });
  const editBlock = (next: FlowBlock) => change(replaceBlock(graph, next));
  const { selected, select, wire, selectWire, deleteWire } = useCanvasSelection(
    canvas,
    { graph, busy: state.busy, change },
    active,
    registerEscape,
  );
  const thresholds = useThresholdEntries(graph);
  const [ruleFocus, setRuleFocus] = useState<{ blockId: string; rule: RuleFocus } | null>(null);
  const selectBlock = (blockId: string | null) => {
    setRuleFocus(null);
    select(blockId);
  };
  const selectIssue: IssueSelect = (blockId, rule) => {
    select(blockId);
    setRuleFocus(blockId && rule ? { blockId, rule } : null);
  };
  const block = graph.blocks.find((b) => b.id === selected);
  const conditionEditing = (blockId: string): ConditionEditing => ({
    focus: ruleFocus?.blockId === blockId ? ruleFocus.rule : null,
    entries: thresholds.entries.get(blockId) ?? noEntries,
    onEntry: (ruleId, text) => thresholds.onEntry(blockId, ruleId, text),
  });
  const closing = usePanelBlock(block);
  const reservedRight = block ? PANEL_WIDTH + 24 : 0;
  function add(kind: FlowBlock["kind"], agent?: AgentDefinition, position?: BlockPosition) {
    const next = newBlock(graph, kind, agent, position);
    change({ ...graph, blocks: [...graph.blocks, next] });
    selectBlock(next.id);
  }
  const dropAt: DropAt = (x, y, grab) => placement.current?.(x, y, grab) ?? null;
  if (!saved) return <FlowLoadState error={error} />;
  return (
    <CanvasLayout>
      <h1 className="sr-only">{name}</h1>
      <EditorToolbar
        draft={draft}
        state={state}
        revision={saved.revision}
        flowId={id}
        owner={owner}
        exporter={exporter}
        fields={interactions.fields}
        invalidEntry={thresholds.invalid}
      />
      <ExportNotice notice={definitionExportNotice(exporter.state)} />
      <DraftProblems draft={draft} state={state} onSelect={selectIssue} />
      <div inert={state.busy} className="flex min-h-0 flex-1" {...interactions.gestures}>
        <BlockLibrary
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          flowId={id}
          {...library}
          agentError={agentError}
          onAdd={add}
          dropAt={dropAt}
        />
        <div className="relative flex min-w-0 flex-1" {...interactions.fields}>
          <FlowCanvas
            ref={canvas}
            graph={graph}
            agents={agents}
            selected={selected}
            selectedWire={wire}
            reservedRight={reservedRight}
            flow={{ id, ownerNote: ownerNote(owner) }}
            savedGraph={saved.id === id ? saved.graph : undefined}
            busy={state.busy}
            placementRef={placement}
            onSelect={selectBlock}
            onSelectWire={selectWire}
            onDeleteWire={deleteWire}
            onEdit={editBlock}
            onChange={change}
            onArranging={interactions.reportArranging}
          />
          <UnavailableOwnerNotice owner={owner} />
          <ReadinessPanel
            readiness={readiness}
            agentsChanged={state.agentsChanged}
            graph={graph}
            onSelect={selectIssue}
          />
          <EditorSelectionPanel
            block={block}
            closing={closing}
            graph={graph}
            agents={agents}
            condition={conditionEditing}
            onEdit={editBlock}
            onChange={change}
            select={selectBlock}
          />
        </div>
      </div>
    </CanvasLayout>
  );
}

/** An absent definition and a retryable read failure offer different recovery actions. */
function FlowLoadState({ error }: { error: string }) {
  const navigate = useStudioNavigation();
  return (
    <Page>
      <p role={error ? "alert" : "status"} className="text-sm text-muted-foreground">
        {error === "Flow not found." ? "Flow not found" : error || "Opening Flow…"}
      </p>
      {error && (
        <Button variant="outline" onClick={() => void navigate({ tab: "flows" })}>
          Back to list
        </Button>
      )}
    </Page>
  );
}

function EditorSelectionPanel({
  block,
  closing,
  graph,
  agents,
  condition,
  onEdit,
  onChange,
  select,
}: {
  block: FlowBlock | undefined;
  closing: FlowBlock | null;
  graph: FlowGraph;
  agents: readonly AgentDefinition[];
  condition: (blockId: string) => ConditionEditing;
  onEdit: (block: FlowBlock) => void;
  onChange: (graph: FlowGraph) => void;
  select: (id: string | null) => void;
}) {
  const displayed = block ?? closing;
  if (!displayed) return null;
  return (
    <BlockPanel
      block={displayed}
      closing={!block}
      graph={graph}
      agents={agents}
      condition={condition(displayed.id)}
      onClose={() => select(null)}
      onEdit={onEdit}
      onRemove={(removed) => {
        onChange(removeBlock(graph, removed.id));
        select(null);
      }}
    />
  );
}

/** Editor top row: back link, editable Flow name, save status and the explicit actions. */
function EditorToolbar({
  draft,
  state,
  revision,
  flowId,
  owner,
  exporter,
  fields,
  invalidEntry,
}: {
  draft: FlowDraftModel;
  state: FlowDraftSnapshot;
  revision: number;
  flowId: string;
  owner: StudioOwner;
  exporter: ReturnType<typeof useDefinitionExport>;
  /** Reports typing in the toolbar's fields, which a newer revision waits for. */
  fields: ReturnType<typeof useInteractionReports>["fields"];
  /** A shown Condition arrival number is invalid, so neither the check nor a save would match it. */
  invalidEntry: boolean;
}) {
  const invalidTitle = invalidEntry
    ? "Correct or clear the arrival number marked invalid first."
    : undefined;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4" {...fields}>
      <StudioLink
        selection={{ tab: "flows" }}
        className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground no-underline hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" /> All Flows
      </StudioLink>
      <span aria-hidden className="text-subtle-foreground">
        /
      </span>
      <Input
        aria-label="Flow name"
        className="field-sizing-content h-8 w-auto max-w-80 min-w-24 border-transparent bg-transparent text-base font-semibold hover:border-border focus-visible:border-ring"
        value={state.content.name}
        disabled={state.busy}
        onChange={(e) => draft.edit({ name: e.target.value })}
      />
      <FlowWorkspaceControl
        workspace={state.content.workspace}
        disabled={state.busy}
        onChange={(workspace) => draft.edit({ workspace })}
      />
      <span className="flex-1" />
      <OwnerBadge owner={owner} />
      <UpdatedNotice revision={state.removed ? null : state.updatedTo} />
      <FlowSaveStatus state={state} revision={revision} />
      <Separator orientation="vertical" className="h-5!" />
      <Button
        variant="outline"
        disabled={state.busy || state.removed || invalidEntry}
        title={state.removed ? "This Flow was removed elsewhere." : invalidTitle}
        onClick={() => void draft.check()}
      >
        <ListChecks aria-hidden /> Check readiness
      </Button>
      <MutationGate>
        <Button
          title={state.removed ? "This Flow was removed elsewhere." : invalidTitle}
          disabled={!state.canSave || invalidEntry}
          onClick={() => void draft.save()}
        >
          <Save aria-hidden /> Save Flow
        </Button>
      </MutationGate>
      <StartRunAction draft={draft} state={state} flowId={flowId} owner={owner} />
      <DefinitionExportControl
        {...exporter}
        dirty={state.dirty}
        disabled={state.busy || state.removed}
        compact
      />
      <RemoveFlowAction draft={draft} state={state} />
    </div>
  );
}

/** Start Run opens a composition with this Flow once it is ready and its owning Project available. */
function StartRunAction({
  draft,
  state,
  flowId,
  owner,
}: {
  draft: FlowDraftModel;
  state: FlowDraftSnapshot;
  flowId: string;
  owner: StudioOwner;
}) {
  const { openFlowComposer } = useComposerNavigation();
  const unavailable =
    owner.unavailable && `${owner.title}: ${owner.unavailable}. This Flow can’t start.`;
  return (
    <MutationGate>
      <Button
        title={state.removed ? "This Flow was removed elsewhere." : unavailable || undefined}
        disabled={!state.canStartRun || Boolean(unavailable)}
        onClick={() => {
          if (draft.getSnapshot().canStartRun && !unavailable) openFlowComposer(flowId);
        }}
      >
        Start Run
      </Button>
    </MutationGate>
  );
}

/** Over the canvas while the owning Project is unavailable: the Flow stays editable but can't start. */
function UnavailableOwnerNotice({ owner }: { owner: StudioOwner }) {
  if (!owner.unavailable) return null;
  return (
    <Alert
      variant="attention"
      className="absolute top-4 left-1/2 z-10 w-140 max-w-[calc(100%-2rem)] -translate-x-1/2"
    >
      <TriangleAlert aria-hidden />
      <AlertTitle>{owner.title} is unavailable — this Flow can’t start</AlertTitle>
      <AlertDescription>
        {owner.unavailable}. You can still edit, export or remove this Flow; Start Run returns once
        the Project is available again.
      </AlertDescription>
    </Alert>
  );
}

/** Whether the draft matches its saved revision, or was removed elsewhere. */
function FlowSaveStatus({ state, revision }: { state: FlowDraftSnapshot; revision: number }) {
  const attention = state.dirty || state.removed;
  return (
    <span
      role="status"
      aria-label="Flow save status"
      className={cn(
        "flex items-center gap-1.5 px-2 text-2xs font-medium whitespace-nowrap",
        attention ? "text-attention" : "text-muted-foreground",
      )}
    >
      {attention ? (
        <CircleDot aria-hidden className="size-3.5" />
      ) : (
        <Check aria-hidden className="size-3.5 text-success" />
      )}
      {state.removed
        ? "Removed elsewhere · retained draft"
        : `${state.dirty ? "Unsaved changes" : "Saved"} · Revision ${revision}`}
    </span>
  );
}

/** What the last export needs to say, such as a refusal or an omitted driver kind. */
function ExportNotice({ notice }: { notice: string }) {
  if (!notice) return null;
  return (
    <p role="status" className="shrink-0 border-b px-4 py-2 text-sm text-attention">
      {notice}
    </p>
  );
}

const UPDATED_NOTICE_MS = 4000;

/** A brief line after a clean draft switched to a revision saved elsewhere. */
function UpdatedNotice({ revision }: { revision: number | null }) {
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (revision === null) return;
    const timer = window.setTimeout(() => setExpired(revision), UPDATED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [revision]);
  const shown = revision !== null && expired !== revision;
  return (
    <span role="status" className="flex items-center gap-1.5 text-2xs text-muted-foreground">
      {shown && (
        <>
          <RefreshCw aria-hidden className="size-3.5 text-link" />
          Updated to revision {revision}
        </>
      )}
    </span>
  );
}

function RemoveFlowAction({ draft, state }: { draft: FlowDraftModel; state: FlowDraftSnapshot }) {
  const navigate = useStudioNavigation();
  const [open, setOpen] = useState(false);
  const { removing, removalError, busy, dirty, content } = state;
  if (open && state.removed && !removing) setOpen(false);
  async function confirmRemove() {
    if (!(await draft.remove())) return;
    setOpen(false);
    void navigate({ tab: "flows" });
  }
  return (
    <>
      <MutationGate>
        <Button
          type="button"
          variant="outline"
          disabled={busy || removing || state.removed}
          title={state.removed ? "This Flow was removed elsewhere." : undefined}
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (draft.getSnapshot().removed) return;
            draft.clearRemovalError();
            setOpen(true);
          }}
        >
          <Trash2 aria-hidden /> Remove
        </Button>
      </MutationGate>
      <Dialog open={open} onOpenChange={(next) => !removing && setOpen(next)}>
        <DialogContent
          onKeyDownCapture={(event) => {
            if (event.key === "Escape" && !removing) event.stopPropagation();
          }}
        >
          <DialogHeader>
            <DialogTitle>Remove “{content.name}”?</DialogTitle>
            <DialogDescription asChild>
              <div className="grid gap-2 text-sm text-muted-foreground">
                <p>
                  This removes the Flow from Studio with no restore. Its saved revisions are kept,
                  so existing Runs and their history keep the Flow they started with.
                </p>
                {dirty && (
                  <p className="text-attention">
                    You have unsaved changes in this editor. Removing the Flow discards them.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          {removalError && (
            <p role="alert" className="text-sm text-destructive">
              {removalError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={removing}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <MutationGate>
              <Button
                type="button"
                variant="destructive"
                disabled={removing || state.removed}
                onClick={() => void confirmRemove()}
              >
                {removing ? "Removing…" : "Remove Flow"}
              </Button>
            </MutationGate>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Save/validation errors and revision-conflict reconciliation above the canvas. */
function DraftProblems({
  draft,
  state,
  onSelect,
}: {
  draft: FlowDraftModel;
  state: FlowDraftSnapshot;
  onSelect: IssueSelect;
}) {
  const { conflict } = state;
  if (state.removed)
    return <StudioRemovedDraft kind="Flow" json={JSON.stringify(state.content, null, 2)} />;
  return (
    <>
      {state.error && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertTitle>{state.error}</AlertTitle>
          {state.issues.length > 0 && (
            <AlertDescription>
              {state.issues.map((issue, i) => (
                <IssueLink key={i} issue={issue} graph={state.content.graph} onSelect={onSelect}>
                  {issue.path}: {issue.message}
                </IssueLink>
              ))}
            </AlertDescription>
          )}
        </Alert>
      )}
      {conflict.status !== "none" && (
        <ConflictPanel
          local={state.content}
          conflict={conflict}
          onCompare={draft.compareLatest}
          onTakeLatest={draft.takeLatest}
          onKeepLocal={draft.keepLocal}
        />
      )}
    </>
  );
}

/** The floating configuration panel: anchored to the canvas's right edge, only while selected. */
function BlockPanel({
  block,
  closing,
  graph,
  agents,
  condition,
  onClose,
  onEdit,
  onRemove,
}: {
  block: FlowBlock;
  closing: boolean;
  graph: FlowGraph;
  agents: readonly AgentDefinition[];
  condition: ConditionEditing;
  onClose: () => void;
  onEdit: (block: FlowBlock) => void;
  onRemove: (block: FlowBlock) => void;
}) {
  return (
    <aside
      aria-label="Block configuration"
      aria-hidden={closing || undefined}
      inert={closing}
      data-state={closing ? "closed" : "open"}
      className={cn(
        "absolute top-3 right-3 bottom-3 z-10 flex max-w-[calc(100%-24px)] flex-col gap-3 rounded-xl border border-border-strong bg-card py-3.5 shadow-panel",
        // Reduced motion keeps only the fade; durations come from the motion tokens.
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--duration-panel-in) data-[state=open]:ease-panel-in motion-safe:data-[state=open]:slide-in-from-right-4",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--duration-panel-out) data-[state=closed]:ease-panel-out motion-safe:data-[state=closed]:slide-out-to-right-4",
      )}
      style={{ width: PANEL_WIDTH }}
    >
      <div className="flex items-center gap-2 px-4">
        <Badge variant="default" className="rounded-md px-2 py-1 font-medium">
          {BLOCK_KINDS[block.kind].panelLabel}
        </Badge>
        <span className="flex-1" />
        <kbd className="rounded-sm border border-border-strong bg-accent px-1.25 font-mono text-2xs text-muted-foreground">
          Esc
        </kbd>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="bg-muted"
              aria-label="Close block configuration"
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close · Esc</TooltipContent>
        </Tooltip>
      </div>
      <div
        key={block.id}
        className="flex min-h-0 flex-1 flex-col gap-3 animate-in duration-(--duration-fast) fade-in-0"
      >
        <BlockConfiguration
          block={block}
          graph={graph}
          agents={agents}
          condition={condition}
          onEdit={onEdit}
          onRemove={() => onRemove(block)}
        />
      </div>
    </aside>
  );
}

type FlowRevisionConflict = Exclude<RevisionConflict<FlowDraft>, { status: "none" }>;

/** The newest revision Factory holds beyond the draft's baseline, when Studio has it. */
function newerRevision(conflict: FlowRevisionConflict) {
  if (conflict.status === "compared") return conflict.latest.revision;
  return conflict.status === "detected" ? conflict.revision : null;
}

/**
 * A newer saved revision than the unsaved draft's baseline. Its actions name the revision they
 * show, and the draft ignores them once another revision or a removal replaced it.
 */
function ConflictPanel({
  local,
  conflict,
  onCompare,
  onTakeLatest,
  onKeepLocal,
}: {
  local: FlowContent;
  conflict: FlowRevisionConflict;
  onCompare: () => void;
  onTakeLatest: (revision: number) => void;
  onKeepLocal: (revision: number) => void;
}) {
  const latest = conflict.status === "compared" ? conflict.latest : null;
  const revision = newerRevision(conflict);
  return (
    <section
      aria-label="Reconcile Flow"
      className="grid gap-3 border-b border-attention/40 bg-attention/5 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-foreground">
          {revision !== null && (
            <span className="font-medium">Revision {revision} was saved elsewhere. </span>
          )}
          Your local draft is preserved. Load the latest revision to compare before choosing what to
          save.
        </p>
        <Button variant="outline" size="sm" onClick={onCompare}>
          Compare latest revision
        </Button>
      </div>
      {latest && (
        <>
          <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
            <div className="min-w-0">
              <h3 className="mb-1.5 text-base font-semibold">Your local draft</h3>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-2 font-mono text-2xs">
                {JSON.stringify(local, null, 2)}
              </pre>
            </div>
            <div className="min-w-0">
              <h3 className="mb-1.5 text-base font-semibold">Saved revision {latest.revision}</h3>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-2 font-mono text-2xs">
                {JSON.stringify(
                  { name: latest.name, workspace: latest.workspace, graph: latest.graph },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onTakeLatest(latest.revision)}>
              Use latest saved Flow
            </Button>
            <Button variant="outline" size="sm" onClick={() => onKeepLocal(latest.revision)}>
              Keep local draft against revision {latest.revision}
            </Button>
            <p className="text-xs text-muted-foreground">
              Keeping your draft requires another explicit Save Flow. Reconcile any differences
              first.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
