import { StudioRemovedDraft } from "../components/studio-removed-draft.tsx";
import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { useDraftGuard, type ReportDraft } from "../draft-guard.ts";
import { CanvasLayout } from "../components/screen-layout.tsx";
import type { OwnerMove } from "../revisioned-draft.ts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  AgentCapabilities,
  AgentDefinition,
  FactoryProject,
  FlowBlock,
  FlowDraft,
  FlowGraph,
} from "@t3-factory/contracts";
import {
  Check,
  CircleAlert,
  CircleDot,
  Copy,
  FolderGit2,
  MoreHorizontal,
  RefreshCw,
  TextCursorInput,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeyChip } from "@/components/ui/key-chip";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "../api.ts";
import { BLOCK_KINDS } from "../block-kind.ts";
import { fixedShortcuts, matchesShortcut } from "../keyboard-shortcuts.ts";
import { useStudioNavigation } from "../settings-navigation.ts";
import { BlockConfiguration, type BlockAgents } from "../components/block-inspector.tsx";
import { PanelHeading, TargetSelect } from "../components/block-exit-configuration.tsx";
import { BlockLibrary, NewAgentLink } from "../components/block-library.tsx";
import { FlowCanvas, FLOW_INPUT, type DropAt } from "../components/flow-canvas.tsx";
import {
  IssueLink,
  ReadinessPanel,
  readinessMarks,
  useShownReadiness,
  type BlockIssue,
  type IssueSelect,
} from "../components/flow-readiness.tsx";
import type { ConditionEditing, RuleFocus } from "../components/condition-rules.tsx";
import { FlowWorkspaceControl } from "../components/flow-workspace-control.tsx";
import {
  DefinitionExportDialog,
  DefinitionExportMenuItem,
  definitionExportNotice,
} from "../components/definition-export-control.tsx";
import { useMenuActions } from "../components/menu-actions.ts";
import { Notice, NoticeButton } from "../components/notice.tsx";
import { StatusBadge } from "../components/status-badge.tsx";
import { useDefinitionExport } from "../definition-export.ts";
import { Page } from "../components/page.tsx";
import {
  hasWire,
  newBlock,
  removeBlock,
  removeWire,
  replaceBlock,
  canvasGraph,
  undoRemoval,
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
import { OwnerBadge, OwnerChangeNotice } from "../components/studio-owner.tsx";
import {
  CantRemoveDialog,
  RemoveMenuItem,
  namedBlockers,
  racedBlockers,
  triggerBlockers,
} from "../components/studio-removal.tsx";
import { ChangeOwnerDialog, DuplicateFlowDialog } from "../components/studio-owner-dialogs.tsx";

/** This editor's Flow draft, following the Flow through Studio's saved definitions. */
function useOpenedFlowDraft(
  id: string,
  definitions: StudioDefinitions,
  created: FlowDraft | undefined,
) {
  const [draft] = useState(() =>
    createFlowDraft(id, definitions, api, created?.id === id ? created : undefined),
  );
  useEffect(() => draft.open(), [draft]);
  const interactions = useInteractionReports(draft);
  const state = useFlowDraftSnapshot(draft);
  useLiveReadiness(draft, state.checkDue);
  return { draft, state, interactions };
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
 * its drop handler, so a drop's edit counts. Closing the editor ends every interaction.
 */
function useInteractionReports(draft: FlowDraftModel) {
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
  }, [end]);
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

/** A removal ⌘Z can undo: the graph before and after it. */
type Removal = { readonly before: FlowGraph; readonly after: FlowGraph };

/**
 * Structural edits ⌘Z undoes until Save: a removed Block together with its wires, or a removed
 * wire. Undo brings back what the last removal took and keeps every edit made since; a field
 * keeps its own text undo.
 */
function useStructuralUndo(
  scope: RefObject<HTMLElement | null>,
  draft: { graph: FlowGraph; dirty: boolean; busy: boolean; change: (next: FlowGraph) => void },
) {
  const [removals, setRemovals] = useState<readonly Removal[]>([]);
  if (!draft.dirty && removals.length) setRemovals([]);
  const latest = useRef({ ...draft, removals });
  useEffect(() => {
    latest.current = { ...draft, removals };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, fixedShortcuts.undoFlowEdit)) return;
      if (event.defaultPrevented || isEditing(event.target)) return;
      if (!inEditorLayer(scope.current, event.target)) return;
      const { graph, busy, change, removals: stack } = latest.current;
      const last = stack.at(-1);
      if (busy || !last) return;
      event.preventDefault();
      setRemovals(stack.slice(0, -1));
      change(undoRemoval(graph, last.before, last.after));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scope]);
  /** Applies a removal that ⌘Z can undo. */
  return (after: FlowGraph) => {
    setRemovals((stack) => [...stack, { before: draft.graph, after }]);
    draft.change(after);
  };
}

/**
 * The canvas selection: one block or the Flow input (its panel open), or one wire, never both. A
 * selected wire or block that is no longer in the graph counts as unselected. Escape clears the
 * selection, and Delete or Backspace removes the selected wire.
 */
function useCanvasSelection(
  canvas: RefObject<HTMLElement | null>,
  draft: { graph: FlowGraph; busy: boolean; remove: (next: FlowGraph) => void },
  registerEscape: (handler: () => void) => () => void,
) {
  const { graph } = draft;
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedWire, setSelectedWire] = useState<FlowWire | null>(null);
  const wire = selectedWire && hasWire(graph, selectedWire) ? selectedWire : null;
  if (selectedWire && !wire) setSelectedWire(null);
  // A newer revision adopted while clean may no longer have the selected block.
  if (
    selected !== null &&
    selected !== FLOW_INPUT &&
    !graph.blocks.some((block) => block.id === selected)
  )
    setSelected(null);
  /** Selects a block or the Flow input, or with null clears every selection. */
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
    if (!hasSelection) return;
    return registerEscape(() => select(null));
  }, [hasSelection, registerEscape, select]);
  function deleteWire(removed: FlowWire) {
    draft.remove(removeWire(graph, removed));
    setSelectedWire(null);
    // The focused wire or delete button unmounts; keep keyboard focus on the canvas.
    canvas.current?.focus({ preventScroll: true });
  }
  useDeleteKey(canvas, !draft.busy && wire !== null, () => {
    if (wire) deleteWire(wire);
  });
  /** Removes a block with its wires and closes its settings. */
  function deleteBlock(blockId: string) {
    draft.remove(removeBlock(graph, blockId));
    select(null);
  }
  return { selected, wire, select, selectWire, deleteWire, deleteBlock };
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

/**
 * Tells Studio's guard about this editor's unsaved work: the draft's own changes, learnt from its
 * notification before any render, and an invalid Condition arrival entry, which lives only in this
 * editor and is lost when it closes. An accepted removal here leaves nothing to keep, so the
 * guard is clear before Remove navigates away.
 */
function useFlowDraftGuard(
  draft: FlowDraftModel,
  id: string,
  reportDraft: ReportDraft,
  invalidEntry: boolean,
) {
  const guarded = useMemo(
    () => ({
      subscribe: draft.subscribe,
      getSnapshot: () => {
        const { dirty, removed, removedHere } = draft.getSnapshot();
        return { dirty: dirty || (invalidEntry && !removedHere), removed };
      },
    }),
    [draft, invalidEntry],
  );
  useDraftGuard(guarded, id, reportDraft);
}

/** The Agent capabilities that name each Agent's provider and model; null until read or unread. */
function useAgentCapabilities() {
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  useEffect(() => {
    let active = true;
    void api.getAgentCapabilities().then(
      (value) => active && setCapabilities(value),
      // Summaries fall back to the saved provider id.
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  return capabilities;
}

/**
 * Studio's saved Agents for the canvas, and for the block library only those the Flow's owner
 * may place; the last read stays offered during refreshes.
 */
function useLibraryAgents(definitions: StudioDefinitions, projectId: string | null) {
  const { value, error } = useStudioRead(definitions, "agents");
  const { projects } = useStudioOwners(definitions);
  const capabilities = useAgentCapabilities();
  const agents = value ?? noAgents;
  const placeable = placeableAgents(agents, { projectId });
  return {
    agents,
    agentError: error ? "Could not load saved Agents. Reopen this Flow to try again." : "",
    owner: studioOwner(projectId, projects),
    projects,
    blockAgents: { all: agents, placeable, capabilities } satisfies BlockAgents,
  };
}

/** Checks the unsaved draft's readiness once edits pause, and again after each change. */
function useLiveReadiness(draft: FlowDraftModel, due: number | null) {
  useEffect(() => {
    if (due === null) return;
    const timer = window.setTimeout(() => void draft.check(), READINESS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, due]);
}

const READINESS_DEBOUNCE_MS = 400;

/**
 * Selecting a block or a readiness issue; an issue about a Condition rule also focuses that rule
 * in the block's configuration.
 */
function useRuleFocus(
  select: (blockId: string | null) => void,
  thresholds: ReturnType<typeof useThresholdEntries>,
) {
  const [ruleFocus, setRuleFocus] = useState<{ blockId: string; rule: RuleFocus } | null>(null);
  const selectIssue: IssueSelect = (blockId, rule) => {
    select(blockId);
    setRuleFocus(blockId && rule ? { blockId, rule } : null);
  };
  return {
    selectIssue,
    selectBlock(blockId: string | null) {
      setRuleFocus(null);
      select(blockId);
    },
    conditionEditing: (blockId: string): ConditionEditing => ({
      focus: ruleFocus?.blockId === blockId ? ruleFocus.rule : null,
      entries: thresholds.entries.get(blockId) ?? noEntries,
      onEntry: (ruleId, text) => thresholds.onEntry(blockId, ruleId, text),
    }),
  };
}

/** The selected Block and the next one it connects to, which the canvas keeps in view. */
function revealed(graph: FlowGraph, selected: string | null): readonly string[] {
  if (selected === null || selected === FLOW_INPUT) return [];
  const next = graph.connections.find((c) => c.sourceBlockId === selected)?.targetBlockId;
  return next && next !== selected ? [selected, next] : [selected];
}

const noIssues: readonly BlockIssue[] = [];

export function FlowDetail({
  id,
  definitions,
  registerEscape,
  reportDraft,
  created,
}: {
  id: string;
  definitions: StudioDefinitions;
  registerEscape: (handler: () => void) => () => void;
  reportDraft: ReportDraft;
  /** This Studio's latest create answer, which can arrive before Studio receives that Flow. */
  created: FlowDraft | undefined;
}) {
  const canvas = useRef<HTMLElement>(null);
  const { draft, state, interactions } = useOpenedFlowDraft(id, definitions, created);
  const exporter = useDefinitionExport(() => api.exportFlow(id));
  const { saved, error } = state;
  const { agents, agentError, owner, projects, blockAgents } = useLibraryAgents(
    definitions,
    state.owner,
  );
  const ownerDialogs = useOwnerDialogs(definitions);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const { graph, name } = state.content;
  const { change, editBlock } = graphEdits(draft, graph);
  const remove = useStructuralUndo(canvas, {
    graph,
    dirty: state.dirty,
    busy: state.busy,
    change,
  });
  const { selected, select, wire, selectWire, deleteWire, deleteBlock } = useCanvasSelection(
    canvas,
    { graph, busy: state.busy, remove },
    registerEscape,
  );
  const thresholds = useThresholdEntries(graph);
  useFlowDraftGuard(draft, id, reportDraft, thresholds.invalid);
  const { selectBlock, selectIssue, conditionEditing } = useRuleFocus(select, thresholds);
  const { readiness, folderMissing, marks } = useEditorReadiness(state.readiness, owner, graph);
  // A Project that left T3 leaves its Flow read-only until it is moved or removed.
  const readOnly = owner.gone;
  const { add, dropAt, placement } = useBlockAdding(graph, change, selectBlock);
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
        readOnly={readOnly}
        exporter={exporter}
        fields={interactions.fields}
        invalidEntry={thresholds.invalid}
        onOwnerDialog={ownerDialogs.open}
        definitions={definitions}
      />
      <ExportNotice notice={definitionExportNotice(exporter.state)} />
      <DraftProblems
        draft={draft}
        state={state}
        owner={owner}
        projects={projects}
        agents={agents}
        onSelect={selectIssue}
        onChangeOwner={ownerDialogs.changeOwner}
      />
      <EditorBody busy={state.busy} readOnly={readOnly} gestures={interactions.gestures}>
        <BlockLibrary
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          flowId={id}
          agents={blockAgents.placeable}
          projects={projects}
          capabilities={blockAgents.capabilities}
          agentError={agentError}
          onAdd={add}
          dropAt={dropAt}
        />
        <div className="relative flex min-w-0 flex-1" {...interactions.fields}>
          <FlowCanvas
            ref={canvas}
            graph={graph}
            agents={agents}
            marks={marks}
            selected={selected}
            selectedWire={wire}
            reveal={revealed(graph, selected)}
            flowId={id}
            savedGraph={savedGraphOf(saved, id)}
            busy={state.busy}
            placementRef={placement}
            onSelect={selectBlock}
            onSelectWire={selectWire}
            onDeleteWire={deleteWire}
            onEdit={editBlock}
            onChange={change}
            onArranging={interactions.reportArranging}
          />
          <ReadinessPanel
            readiness={readiness}
            folderMissing={folderMissing}
            graph={graph}
            onSelect={selectIssue}
            newAgent={<NewAgentOffer agents={blockAgents} flowId={id} />}
          />
        </div>
        <EditorSettings
          selected={selected}
          graph={graph}
          agents={blockAgents}
          marks={marks}
          flowId={id}
          condition={conditionEditing}
          onClose={select}
          onEdit={editBlock}
          onChange={change}
          onRemove={deleteBlock}
        />
      </EditorBody>
      <FlowOwnerDialogs
        dialogs={ownerDialogs}
        subject={{ id, name: saved.name, projectId: state.owner }}
        revision={saved.revision}
        dirty={state.dirty}
        definitions={definitions}
        onChanged={draft.ownerChangedHere}
      />
    </CanvasLayout>
  );
}

/** Graph edits of the draft: the whole graph, or one block in it. */
function graphEdits(draft: FlowDraftModel, graph: FlowGraph) {
  const change = (next: FlowGraph) => draft.edit({ graph: next });
  return { change, editBlock: (next: FlowBlock) => change(replaceBlock(graph, next)) };
}

/** New Agent on the Flow input issue, while no placeable Agent has a model. */
function NewAgentOffer({ agents, flowId }: { agents: BlockAgents; flowId: string }) {
  if (agents.placeable.some((agent) => agent.execution)) return null;
  return <NewAgentLink flowId={flowId} className="shrink-0 pr-4" />;
}

/** The library, canvas and settings; inert while saving, and dimmed while read-only. */
function EditorBody({
  busy,
  readOnly,
  gestures,
  children,
}: {
  busy: boolean;
  readOnly: boolean;
  gestures: ReturnType<typeof useInteractionReports>["gestures"];
  children: ReactNode;
}) {
  return (
    <div
      inert={busy || readOnly}
      className={cn("flex min-h-0 flex-1", readOnly && "opacity-50")}
      {...gestures}
    >
      {children}
    </div>
  );
}

/** Adding a library block, at a drop point or at the default place, and selecting it. */
function useBlockAdding(
  graph: FlowGraph,
  change: (next: FlowGraph) => void,
  select: (blockId: string) => void,
) {
  /** The canvas fills it with the placement of a drop point. */
  const placement = useRef<DropAt | null>(null);
  return {
    placement,
    add(kind: FlowBlock["kind"], agent?: AgentDefinition, position?: BlockPosition) {
      const next = newBlock(graph, kind, agent, position);
      change({ ...graph, blocks: [...graph.blocks, next] });
      select(next.id);
    },
    dropAt: ((x, y, grab) => placement.current?.(x, y, grab) ?? null) satisfies DropAt,
  };
}

/** The saved graph of the Flow this editor opened, once Studio holds it. */
const savedGraphOf = (saved: FlowDraft, id: string) => (saved.id === id ? saved.graph : undefined);

/**
 * Readiness as the editor shows it: the last known answer, and its Block marks; a missing Project
 * folder is the one reason and marks no Block.
 */
function useEditorReadiness(
  checked: FlowDraftSnapshot["readiness"],
  owner: StudioOwner,
  graph: FlowGraph,
) {
  const readiness = useShownReadiness(checked);
  const folderMissing = owner.folderMissing ? owner.unavailable : null;
  return {
    readiness,
    folderMissing,
    marks: readinessMarks(folderMissing ? null : readiness, graph),
  };
}

/** The selected Block's or the Flow input's docked settings; nothing while neither is selected. */
function EditorSettings({
  selected,
  graph,
  agents,
  marks,
  flowId,
  condition,
  onClose,
  onEdit,
  onChange,
  onRemove,
}: {
  selected: string | null;
  graph: FlowGraph;
  agents: BlockAgents;
  marks: ReturnType<typeof readinessMarks>;
  flowId: string;
  condition: (blockId: string) => ConditionEditing;
  /** Called with null to close the settings. */
  onClose: (selection: null) => void;
  onEdit: (block: FlowBlock) => void;
  onChange: (graph: FlowGraph) => void;
  onRemove: (blockId: string) => void;
}) {
  const close = () => onClose(null);
  if (selected === FLOW_INPUT)
    return (
      <SettingsPanel title="Flow input" icon={TextCursorInput} onClose={close}>
        <section aria-label="Starts" className="grid gap-2 p-4">
          <PanelHeading>Starts</PanelHeading>
          <TargetSelect
            graph={graph}
            source={{ kind: "flow-input" }}
            label="the Flow input"
            onChange={onChange}
          />
        </section>
      </SettingsPanel>
    );
  const block = graph.blocks.find((b) => b.id === selected);
  if (!block) return null;
  return (
    <SettingsPanel
      title={BLOCK_KINDS[block.kind].name}
      icon={BLOCK_KINDS[block.kind].Icon}
      onClose={close}
      footer={
        <Button
          variant="outline"
          className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onRemove(block.id)}
        >
          Remove block
        </Button>
      }
    >
      <BlockConfiguration
        key={block.id}
        block={block}
        graph={graph}
        agents={agents}
        issues={marks.blocks.get(block.id) ?? noIssues}
        flowId={flowId}
        condition={condition(block.id)}
        onEdit={onEdit}
        onChange={onChange}
      />
    </SettingsPanel>
  );
}

/** The settings panel docked at the editor's right: kind and name, Esc, ✕, body and footer. */
function SettingsPanel({
  title,
  icon: Icon,
  onClose,
  footer,
  children,
}: {
  title: string;
  icon: typeof X;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={`${title} settings`}
      className="flex w-90 shrink-0 flex-col border-l bg-card"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <Icon aria-hidden className="size-4 text-link" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="flex-1" />
        <KeyChip>Esc</KeyChip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close block settings"
              onClick={onClose}
            >
              <X aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent shortcut="Esc">Close</TooltipContent>
        </Tooltip>
      </div>
      {children}
      {footer && <div className="mt-auto shrink-0 border-t p-4">{footer}</div>}
    </aside>
  );
}

type FlowOwnerDialog =
  | { readonly kind: "change-owner" }
  | { readonly kind: "duplicate"; readonly target?: string | null };

/** Which owner dialog the Flow editor shows, and opening the Flow a Duplicate created. */
function useOwnerDialogs(definitions: StudioDefinitions) {
  const navigate = useStudioNavigation();
  const [dialog, setDialog] = useState<FlowOwnerDialog | null>(null);
  return {
    dialog,
    open: setDialog,
    changeOwner: () => setDialog({ kind: "change-owner" }),
    close: () => setDialog(null),
    async opened(flow: FlowDraft) {
      setDialog(null);
      await definitions.listed("flows", flow.id);
      void navigate({ tab: "flows", flowId: flow.id });
    },
  };
}

function FlowOwnerDialogs({
  dialogs,
  subject,
  revision,
  dirty,
  definitions,
  onChanged,
}: {
  dialogs: ReturnType<typeof useOwnerDialogs>;
  subject: { id: string; name: string; projectId: string | null };
  revision: number;
  dirty: boolean;
  definitions: StudioDefinitions;
  onChanged: (moved: OwnerMove) => void;
}) {
  const { dialog } = dialogs;
  if (dialog?.kind === "change-owner")
    return (
      <ChangeOwnerDialog
        kind="Flow"
        subject={subject}
        definitions={definitions}
        onClose={dialogs.close}
        onChanged={onChanged}
        onDuplicateInstead={(target) => dialogs.open({ kind: "duplicate", target })}
      />
    );
  if (dialog?.kind === "duplicate")
    return (
      <DuplicateFlowDialog
        source={subject}
        revision={revision}
        dirty={dirty}
        definitions={definitions}
        initialTarget={dialog.target}
        onClose={dialogs.close}
        onDuplicated={(flow) => void dialogs.opened(flow)}
      />
    );
  return null;
}

const removedReason = "This Flow was removed elsewhere.";

/**
 * Figma S02: Duplicate…, Change owner…, Export JSON and Remove… of the saved Flow. Their dialogs
 * live outside the menu, which closes on select.
 */
function FlowMoreActions({
  draft,
  state,
  exporter,
  onOwnerDialog,
  definitions,
  flowId,
}: {
  draft: FlowDraftModel;
  state: FlowDraftSnapshot;
  exporter: ReturnType<typeof useDefinitionExport>;
  onOwnerDialog: (dialog: FlowOwnerDialog) => void;
  definitions: StudioDefinitions;
  flowId: string;
}) {
  const { trigger, queue, onCloseAutoFocus } = useMenuActions();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  if (confirmingRemove && state.removed && !state.removing) setConfirmingRemove(false);
  const writable = useMutationsAllowed() && !state.removed;
  const reason = state.removed ? removedReason : undefined;
  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                ref={trigger}
                type="button"
                variant="outline"
                size="icon"
                aria-label="More Flow actions"
                disabled={state.busy}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>More Flow actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-58" onCloseAutoFocus={onCloseAutoFocus}>
          <DropdownMenuItem
            disabled={!writable}
            description={reason}
            onSelect={() => queue(() => onOwnerDialog({ kind: "duplicate" }))}
          >
            <Copy aria-hidden />
            Duplicate…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!writable}
            description={reason}
            onSelect={() => queue(() => onOwnerDialog({ kind: "change-owner" }))}
          >
            <FolderGit2 aria-hidden />
            Change owner…
          </DropdownMenuItem>
          <DefinitionExportMenuItem
            state={exporter.state}
            disabled={state.removed}
            description={reason}
            onSelect={() => queue(() => void exporter.model.request(state.dirty))}
          />
          <DropdownMenuSeparator />
          <RemoveMenuItem
            disabled={!writable || state.removing}
            description={reason}
            onSelect={() =>
              queue(() => {
                if (draft.getSnapshot().removed) return;
                draft.clearRemovalError();
                setConfirmingRemove(true);
              })
            }
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <DefinitionExportDialog {...exporter} />
      <RemoveFlowDialog
        open={confirmingRemove}
        draft={draft}
        state={state}
        definitions={definitions}
        flowId={flowId}
        onClose={() => setConfirmingRemove(false)}
      />
    </>
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

/**
 * Editor top row: owner badge, editable Flow name and save status, then Workspace, More Flow
 * actions and Save, the only primary, which is filled only while there are unsaved changes.
 */
function EditorToolbar({
  draft,
  state,
  revision,
  flowId,
  owner,
  readOnly,
  exporter,
  fields,
  invalidEntry,
  onOwnerDialog,
  definitions,
}: {
  draft: FlowDraftModel;
  state: FlowDraftSnapshot;
  revision: number;
  flowId: string;
  owner: StudioOwner;
  /** The owning Project left T3: nothing can be edited or saved. */
  readOnly: boolean;
  exporter: ReturnType<typeof useDefinitionExport>;
  /** Reports typing in the toolbar's fields, which a newer revision waits for. */
  fields: ReturnType<typeof useInteractionReports>["fields"];
  /** A shown Condition arrival number is invalid, so a save would not match it. */
  invalidEntry: boolean;
  onOwnerDialog: (dialog: FlowOwnerDialog) => void;
  definitions: StudioDefinitions;
}) {
  const filled = state.dirty && !state.removed && !readOnly;
  return (
    <div className="flex h-13 shrink-0 items-center gap-2.5 border-b px-4" {...fields}>
      <OwnerBadge owner={owner} />
      {readOnly && <StatusBadge kind="neutral">Not in T3</StatusBadge>}
      <Input
        aria-label="Flow name"
        className="field-sizing-content h-8 w-auto max-w-80 min-w-24 border-transparent bg-transparent px-1.5 text-base font-semibold hover:border-border focus-visible:border-ring"
        value={state.content.name}
        disabled={state.busy || readOnly}
        onChange={(e) => draft.edit({ name: e.target.value })}
      />
      <FlowSaveStatus state={state} revision={revision} />
      <UpdatedNotice revision={state.removed ? null : state.updatedTo} />
      <span className="flex-1" />
      <FlowWorkspaceControl
        workspace={state.content.workspace}
        disabled={state.busy || readOnly}
        onChange={(workspace) => draft.edit({ workspace })}
      />
      <FlowMoreActions
        draft={draft}
        state={state}
        exporter={exporter}
        onOwnerDialog={onOwnerDialog}
        definitions={definitions}
        flowId={flowId}
      />
      <MutationGate>
        <Button
          variant={filled ? "default" : "outline"}
          disabled={!state.canSave || !state.dirty || invalidEntry || readOnly}
          onClick={() => void draft.save()}
        >
          {state.saving ? "Saving…" : "Save"}
        </Button>
      </MutationGate>
    </div>
  );
}

/** Whether the draft matches its saved revision, or was removed elsewhere. */
function FlowSaveStatus({ state, revision }: { state: FlowDraftSnapshot; revision: number }) {
  const attention = state.dirty || state.removed;
  return (
    <span
      role="status"
      aria-label="Flow save status"
      className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground"
    >
      {attention ? (
        <CircleDot aria-hidden className="size-3 text-attention" />
      ) : (
        <Check aria-hidden className="size-3.5 text-success" />
      )}
      {state.saving
        ? "Saving…"
        : state.removed
          ? "Removed elsewhere · draft kept"
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

/** Remove… confirms, or lists the Triggers that still start this Flow. */
function RemoveFlowDialog({
  open,
  draft,
  state,
  definitions,
  flowId,
  onClose,
}: {
  open: boolean;
  draft: FlowDraftModel;
  state: FlowDraftSnapshot;
  definitions: StudioDefinitions;
  flowId: string;
  onClose: () => void;
}) {
  const navigate = useStudioNavigation();
  const triggers = useStudioRead(definitions, "triggers").value ?? [];
  const { projects } = useStudioOwners(definitions);
  const { removing, removalError, removalIssues, dirty, content } = state;
  const live = triggers.filter((trigger) => trigger.flowId === flowId);
  const raced = namedBlockers(removalIssues, "flow_in_use").filter(
    (blocker) => !live.some((trigger) => trigger.id === blocker.id),
  );
  async function confirmRemove() {
    if (!(await draft.remove())) return;
    onClose();
    void navigate({ tab: "flows" });
  }
  if (live.length > 0 || raced.length > 0)
    return (
      <CantRemoveDialog open={open} name={content.name} label="Triggers" onClose={onClose}>
        {triggerBlockers(live, projects, (id) => void navigate({ tab: "triggers", triggerId: id }))}
        {racedBlockers(raced, "Trigger", (id) => void navigate({ tab: "triggers", triggerId: id }))}
      </CantRemoveDialog>
    );
  const inUse = removalIssues.some((issue) => issue.code === "flow_in_use");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !removing) onClose();
      }}
    >
      <DialogContent
        title={<>Remove “{content.name}”?</>}
        description={
          dirty
            ? "Removing this Flow discards your unsaved edits and keeps the saved revisions for existing Runs."
            : "Removing this Flow keeps its saved revisions for existing Runs."
        }
        actions={
          <>
            <Button type="button" variant="outline" disabled={removing} onClick={onClose}>
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
          </>
        }
        closeDisabled={removing}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && !removing) event.stopPropagation();
        }}
      >
        {removalError && !inUse && (
          <p role="alert" className="text-sm text-destructive">
            {removalError}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Couldn't save (Error), or the save outcome is unknown (Warning); refused issues select their Block. */
function SaveProblem({ state, onSelect }: { state: FlowDraftSnapshot; onSelect: IssueSelect }) {
  const unknown = state.saveOutcome === "unknown";
  return (
    <Notice
      tone={unknown ? "attention" : "critical"}
      icon={unknown ? TriangleAlert : CircleAlert}
      title={unknown ? "Save outcome unknown" : state.error}
    >
      {unknown && state.error}
      {state.issues.map((issue, i) => (
        <IssueLink key={i} issue={issue} graph={state.content.graph} onSelect={onSelect}>
          {issue.message}
        </IssueLink>
      ))}
    </Notice>
  );
}

/** The owning Project left T3: the Flow is read-only until it is moved or removed. */
function OwnerGoneNotice({
  owner,
  onChangeOwner,
}: {
  owner: StudioOwner;
  onChangeOwner: () => void;
}) {
  return (
    <Notice
      tone="attention"
      icon={TriangleAlert}
      title={`${owner.title} is no longer in T3`}
      action={
        <MutationGate>
          <NoticeButton onClick={onChangeOwner}>Change owner…</NoticeButton>
        </MutationGate>
      }
    >
      This Flow can’t be edited or started. Move it to another owner or remove it.
    </Notice>
  );
}

/**
 * Page-level problems, one card each under the toolbar: the Project left T3, removed elsewhere,
 * owner changed elsewhere, couldn't save or save outcome unknown, and a revision saved elsewhere.
 */
function DraftProblems({
  draft,
  state,
  owner,
  projects,
  agents,
  onSelect,
  onChangeOwner,
}: {
  draft: FlowDraftModel;
  state: FlowDraftSnapshot;
  owner: StudioOwner;
  projects: readonly FactoryProject[];
  agents: readonly AgentDefinition[];
  onSelect: IssueSelect;
  onChangeOwner: () => void;
}) {
  const live = !state.removed;
  const cards = [
    owner.gone && <OwnerGoneNotice key="gone" owner={owner} onChangeOwner={onChangeOwner} />,
    state.removed && (
      <StudioRemovedDraft key="removed" kind="Flow" json={JSON.stringify(state.content, null, 2)} />
    ),
    live && state.ownerChange.status !== "none" && (
      <OwnerChangeNotice
        key="owner"
        kind="Flow"
        change={state.ownerChange}
        projects={projects}
        onAcknowledge={draft.acknowledgeOwner}
      />
    ),
    live && state.error && <SaveProblem key="error" state={state} onSelect={onSelect} />,
    live && state.conflict.status !== "none" && (
      <ConflictNotice
        key="conflict"
        local={state.content}
        agents={agents}
        conflict={state.conflict}
        onCompare={draft.compareLatest}
        onTakeLatest={draft.takeLatest}
        onKeepLocal={draft.keepLocal}
      />
    ),
  ].filter(Boolean);
  if (!cards.length) return null;
  return <div className="grid shrink-0 gap-2 border-b p-4">{cards}</div>;
}

type FlowRevisionConflict = Exclude<RevisionConflict<FlowDraft>, { status: "none" }>;

/** The newest revision Factory holds beyond the draft's baseline, when Studio has it. */
function newerRevision(conflict: FlowRevisionConflict) {
  if (conflict.status === "compared") return conflict.latest.revision;
  return conflict.status === "detected" ? conflict.revision : null;
}

/** A Flow's content as comparable lines: its workspace, Blocks and connections. */
function contentLines(content: FlowContent, agents: readonly AgentDefinition[]) {
  const graph = canvasGraph(content.graph, agents);
  const name = (id: string) => graph.blocks.find((b) => b.id === id)?.name || "Unnamed block";
  const { workspace } = content;
  const lines = [
    `Workspace  ${
      workspace.mode === "checkout"
        ? "Project checkout"
        : `New worktree · ${workspace.base.kind === "default" ? "default branch" : workspace.base.ref}`
    }`,
    "",
    "Blocks",
    ...graph.blocks.map((b) => `  ${b.name || "Unnamed block"} · ${BLOCK_KINDS[b.kind].name}`),
    "",
    "Connections",
    ...graph.flowInput.targetBlockIds.map((id) => `  Flow input → ${name(id)}`),
    ...graph.connections.map((c) => {
      const source = graph.blocks.find((b) => b.id === c.sourceBlockId);
      const exit = source?.exits.find((e) => e.id === c.exitId);
      const label =
        exit?.source === "wait"
          ? "after the wait"
          : exit?.source === "continuation"
            ? "response"
            : exit?.name || name(c.sourceBlockId);
      return `  ${label} → ${name(c.targetBlockId)}`;
    }),
  ];
  return lines;
}

/** One side of the comparison; lines the other side lacks are tinted. */
function ComparedLines({
  title,
  lines,
  other,
  tint,
}: {
  title: string;
  lines: readonly string[];
  other: readonly string[];
  tint: string;
}) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <h3 className="text-xs text-muted-foreground">{title}</h3>
      <pre className="max-h-[50vh] overflow-auto rounded-md border bg-background py-2 font-mono text-xs leading-relaxed">
        {lines.map((line, index) => (
          <span
            key={index}
            className={cn(
              "block min-h-[1lh] px-3 whitespace-pre-wrap",
              line.trim() && !other.includes(line) && tint,
            )}
          >
            {line}
          </span>
        ))}
      </pre>
    </div>
  );
}

/**
 * A newer saved revision than the unsaved draft's baseline: one Warning card whose Compare latest
 * revision opens the draft beside that revision. Keep my edits keeps the draft against it; Load
 * revision N replaces the draft at once. The draft ignores either once another revision or a
 * removal replaced the compared one.
 */
function ConflictNotice({
  local,
  agents,
  conflict,
  onCompare,
  onTakeLatest,
  onKeepLocal,
}: {
  local: FlowContent;
  agents: readonly AgentDefinition[];
  conflict: FlowRevisionConflict;
  onCompare: () => void;
  onTakeLatest: (revision: number) => void;
  onKeepLocal: (revision: number) => void;
}) {
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const latest = conflict.status === "compared" ? conflict.latest : null;
  const revision = newerRevision(conflict);
  const mine = contentLines(local, agents);
  const theirs = latest ? contentLines(latest, agents) : [];
  return (
    <>
      <Notice
        tone="attention"
        icon={TriangleAlert}
        title={
          revision === null
            ? "A newer revision was saved elsewhere"
            : `Revision ${revision} was saved elsewhere`
        }
        action={
          <NoticeButton
            onClick={() => {
              setComparisonOpen(true);
              onCompare();
            }}
          >
            Compare latest revision
          </NoticeButton>
        }
      >
        Your changes are kept. Compare them with the latest revision before you save.
      </Notice>
      {comparisonOpen && latest && (
        <Dialog open onOpenChange={(open) => !open && setComparisonOpen(false)}>
          <DialogContent
            title={`Compare with revision ${latest.revision}`}
            size="wide"
            actions={
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    onKeepLocal(latest.revision);
                    setComparisonOpen(false);
                  }}
                >
                  Keep my edits
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    onTakeLatest(latest.revision);
                    setComparisonOpen(false);
                  }}
                >
                  Load revision {latest.revision}
                </Button>
              </>
            }
          >
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <ComparedLines
                title="Your draft"
                lines={mine}
                other={theirs}
                tint="bg-destructive/16"
              />
              <ComparedLines
                title={`Revision ${latest.revision}`}
                lines={theirs}
                other={mine}
                tint="bg-success/16"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
