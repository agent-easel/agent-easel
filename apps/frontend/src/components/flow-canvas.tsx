import {
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type RefObject,
} from "react";
import { GripVertical, RotateCcw } from "lucide-react";
import {
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type FlowBlock,
  type FlowGraph,
  type ValidationIssue,
} from "@t3-factory/contracts";
import { cn } from "@/lib/utils";
import {
  addWire,
  FINISH_SELECTION,
  type CanvasBlockSelection,
  canConnect,
  exitRecipients,
  type BlockPosition,
  type CanvasBlock,
  type CanvasNode,
  type FlowWire,
  type WireTarget,
} from "../flow-graph.ts";
import { AUTHORING_DIMENSIONS, type WireSource } from "@t3-factory/flow-layout";
import {
  CanvasSurface,
  IdentityRows,
  type CanvasBlockContent,
  type CanvasFinishContent,
  type CanvasFlowInputContent,
  type CanvasGesture,
  type CanvasPoints,
  type CanvasPort,
  type GrabOffset,
  type Placement,
} from "./canvas-surface.tsx";
import { DragButton } from "./drag-button.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { blockIdentity, conditionRoutes, exitDisplayName } from "./flow-block.tsx";
import { BLOCK_KINDS, blockReference, isSingleOutput, type ReferenceTone } from "../block-kind.ts";
import { issueTag, outputKey, type ReadinessMarks } from "./flow-readiness.tsx";

/** Places a block dragged by `grab` at viewport point x/y, or null when x/y is outside the canvas. */
export type DropAt = (x: number, y: number, grab: GrabOffset) => Placement | null;

/** The selection id of the Flow input, whose settings hold its targets. */
export const FLOW_INPUT = "flow-input";

/** Space the floating readiness summary covers above the graph. */
const READINESS_HEIGHT = 64;

type MoveDrag = Extract<CanvasGesture, { kind: "move" }>;
type ConnectDrag = Extract<CanvasGesture, { kind: "connect" }>;

type DragHandlers = Pick<
  ComponentProps<typeof DragButton>,
  "onDragStart" | "onDragMove" | "onDrop" | "onDragCancel"
>;

/**
 * A block or the Flow input being moved: its live position is shown, but the draft changes
 * only once, on a drop inside the canvas. A cancel or a drop outside the canvas keeps the
 * original position.
 */
function useMoveDrag(
  points: RefObject<CanvasPoints | null>,
  onMove: (moved: CanvasNode, position: BlockPosition) => void,
) {
  const [drag, setDrag] = useState<MoveDrag | null>(null);
  const grab = useRef<GrabOffset>({ x: 0, y: 0 });
  const place = (x: number, y: number) => points.current?.place(x, y, grab.current)?.position;
  return {
    drag,
    handlers: (node: CanvasNode): DragHandlers => ({
      onDragStart: (origin, button) => {
        grab.current = points.current?.grab(origin, button.closest("article") ?? button) ?? {
          x: 0,
          y: 0,
        };
      },
      onDragMove: (x, y) => {
        const position = place(x, y);
        if (position) setDrag({ kind: "move", node, position });
      },
      onDrop: (x, y) => {
        setDrag(null);
        const position = place(x, y);
        if (position) onMove(node, position);
      },
      onDragCancel: () => setDrag(null),
    }),
  };
}

function useConnectDrag(
  surface: RefObject<HTMLElement | null>,
  points: RefObject<CanvasPoints | null>,
  graph: FlowGraph,
  onChange: (graph: FlowGraph) => void,
) {
  const [connect, setConnect] = useState<ConnectDrag | null>(null);
  const port = useRef<HTMLElement | null>(null);
  function targetAt(x: number, y: number, source: WireSource) {
    const hit = document.elementFromPoint(x, y);
    // Releasing over the source port itself is a no-op, not a self-connection.
    if (!hit || !surface.current?.contains(hit) || port.current?.contains(hit)) return null;
    const targetBlockId = hit.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
    const targetEndingId = hit.closest<HTMLElement>("[data-ending-id]")?.dataset.endingId;
    const target: WireTarget | null = targetEndingId
      ? { targetBlockId: FINISH_BLOCK_ID, targetEndingId }
      : targetBlockId
        ? { targetBlockId }
        : null;
    if (!target) return null;
    return canConnect(graph, source, target) ? target : null;
  }
  return {
    connect,
    handlers: (source: WireSource): DragHandlers => {
      const follow = (x: number, y: number) => {
        const pointer = points.current?.at(x, y);
        if (!pointer) return;
        setConnect({ kind: "connect", source, pointer, target: targetAt(x, y, source) });
      };
      return {
        onDragStart: (_origin, button) => {
          port.current = button;
        },
        onDragMove: follow,
        onDrop: (x, y) => {
          const target = targetAt(x, y, source);
          port.current = null;
          setConnect(null);
          if (target) onChange(addWire(graph, { source, ...target }));
        },
        onDragCancel: () => {
          port.current = null;
          setConnect(null);
        },
      };
    },
  };
}

function moveGraphNode(
  graph: FlowGraph,
  moved: CanvasNode,
  position: BlockPosition,
  onChange: (graph: FlowGraph) => void,
  onEdit: (block: FlowBlock) => void,
) {
  if (moved.kind === "flow-input") {
    onChange({ ...graph, flowInput: { ...graph.flowInput, position } });
    return;
  }
  if (moved.kind === "finish") {
    onChange({ ...graph, finish: { ...graph.finish, position } });
    return;
  }
  const block = graph.blocks.find((item) => item.id === moved.blockId);
  if (block) onEdit({ ...block, position });
}

const dragPressClass =
  "flex w-full cursor-grab flex-col text-left outline-none focus-ring active:cursor-grabbing";

function grip(visible: boolean) {
  return (
    <GripVertical
      aria-hidden
      className={cn(
        "size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100",
        visible && "opacity-100",
      )}
    />
  );
}

/**
 * Tags on a block's header: its first readiness issue, and on an Agent block a Revisit
 * instruction (never its text).
 */
function blockTags(block: FlowBlock, issue: ValidationIssue | undefined) {
  const revisit = block.kind === "agent" && !!block.revisitInstruction.trim();
  const fresh = block.kind === "agent" && block.revisitContext === "fresh";
  const issueId = `block-issue-${block.id}`;
  const revisitId = `revisit-instruction-${block.id}`;
  const revisitLabel =
    fresh && revisit
      ? "Fresh · Revisit instruction"
      : fresh
        ? "Fresh context"
        : "Revisit instruction";
  return {
    tags: (
      <>
        {issue && (
          <StatusBadge id={issueId} kind="error">
            {issueTag(issue)}
          </StatusBadge>
        )}
        {(revisit || fresh) && !issue && (
          <StatusBadge id={revisitId} kind="neutral" icon={RotateCcw}>
            {revisitLabel}
          </StatusBadge>
        )}
      </>
    ),
    describedBy: issue ? issueId : revisit || fresh ? revisitId : undefined,
  };
}

/**
 * An output port's handle for drawing a connection. It takes no focus; connections are drawn
 * only with a pointer.
 */
function connectionHandle(
  label: string,
  active: boolean,
  drag: DragHandlers,
  problem = false,
): CanvasPort {
  return {
    className: cn(
      "border-[1.5px] border-muted-foreground bg-background transition-colors group-hover/port:border-primary",
      problem && "border-destructive",
      active && "border-primary bg-primary",
    ),
    handle: (frame: CSSProperties, circle) => (
      <DragButton
        aria-label={label}
        tabIndex={-1}
        className="group/port flex cursor-crosshair items-center justify-center rounded-full outline-none"
        style={frame}
        // Keeps focus where it was, so pressing the port neither blurs a panel field nor selects text.
        onMouseDown={(e) => e.preventDefault()}
        {...drag}
      >
        {circle}
      </DragButton>
    ),
  };
}

/** A hidden or removed wired exit keeps its own endpoint but cannot start a connection. */
const unavailablePort: CanvasPort = { className: "border-[1.5px] border-attention bg-background" };

const incomingPort =
  (accepting: boolean, problem = false) =>
  (pending: boolean): CanvasPort => ({
    className: cn(
      "border-[1.5px] border-muted-foreground bg-background transition-[width,height,top,left]",
      problem && "border-destructive",
      accepting && "border-primary",
      pending && "border-2 border-primary ring-4 ring-primary/25",
    ),
    highlighted: pending,
  });

/**
 * The Flow input block: moved like a block and the source of wires to Agent blocks. Selecting
 * it opens its targets; it cannot be removed.
 */
function authoringFlowInput({
  dragging,
  connecting,
  issue,
  selected,
  onSelect,
  drag,
  connectFrom,
}: {
  dragging: boolean;
  selected: boolean;
  /** A wire is being drawn from its port. */
  connecting: boolean;
  issue: ValidationIssue | null;
  onSelect: () => void;
  drag: DragHandlers;
  connectFrom: DragHandlers;
}): CanvasFlowInputContent {
  return {
    className: cn(
      "group transition-colors hover:bg-accent",
      issue && "border-destructive",
      selected && "ring-2 ring-primary",
      dragging && "z-10 cursor-grabbing shadow-lift",
    ),
    press: (rows) => (
      <DragButton
        className={cn(dragPressClass, "rounded-lg")}
        aria-label="Flow input"
        {...drag}
        onClick={onSelect}
      >
        {rows}
      </DragButton>
    ),
    trailing: issue ? <StatusBadge kind="error">{issueTag(issue)}</StatusBadge> : grip(false),
    prompt: { kind: "none" },
    port: connectionHandle("Connect Flow input", connecting, connectFrom, issue !== null),
  };
}

/** The authoring canvas colour of each reference tone. */
const REFERENCE_TONES: Record<ReferenceTone, string> = {
  plain: "text-emphasis-foreground",
  continued: "text-brand-cyan",
  absent: "text-muted-foreground",
};

/**
 * One exit row: a Condition output's rule, then the exit's name and, for screen readers, its
 * recipients. A Condition output that is not connected shows its name in the error colour.
 */
function AuthoringExit({
  exit,
  route,
  recipients,
  unconnected,
}: {
  exit: CanvasBlock["exits"][number];
  /** When a Condition output is selected. */
  route: string;
  /** The names of the blocks its connections reach. */
  recipients: string;
  unconnected: boolean;
}) {
  const name =
    exit.source === "wait"
      ? "after the wait"
      : exit.source === "continuation"
        ? "response"
        : exitDisplayName(exit);
  return (
    <>
      {exit.source === "condition" && (
        <span className="truncate text-2xs tracking-label text-muted-foreground">{route}</span>
      )}
      <span className="flex-1" />
      <span
        className={cn(
          "truncate text-xs text-muted-foreground",
          unconnected && "text-destructive",
          exit.unavailable && "text-attention line-through",
        )}
      >
        {name}
      </span>
      {exit.unavailable && <span className="sr-only">{exit.unavailable}</span>}
      <span className="sr-only">→ {recipients || "finish here"}</span>
    </>
  );
}

/** The accessible name of an exit's connection handle. */
function exitPortLabel(exit: CanvasBlock["exits"][number], name: string) {
  if (isSingleOutput(exit)) return `Connect output of ${name}`;
  return exit.source === "condition"
    ? `Connect output ${exit.name || "Unnamed output"} of ${name}`
    : `Connect exit ${exit.name || "Unnamed exit"} of ${name}`;
}

/** A block frame's look for its kind, selection, readiness issue and the gestures in progress. */
function blockFrameClass({
  kind,
  selected,
  issue,
  dimmed,
  dragging,
  connectTarget,
}: {
  kind: FlowBlock["kind"] | "finish";
  selected: boolean;
  issue: boolean;
  /** A wire from the Flow input can't reach this block. */
  dimmed: boolean;
  dragging: boolean;
  connectTarget: boolean;
}) {
  const dashedFrame = kind !== "finish" && BLOCK_KINDS[kind].dashedFrame;
  const selectedOnly = selected && !issue;
  return cn(
    "group bg-card transition-[background-color,border-color] hover:border-border-hover hover:bg-accent",
    dashedFrame && "border-dashed border-border-strong",
    // The selected 2 px edge is an outline drawn over the 1 px border and one pixel inside
    // it, so selection keeps the frame inside the box its geometry reserves. The border is
    // transparent so a dashed outline's gaps show the card, as a dashed border's do.
    selectedOnly &&
      "border-transparent outline-2 -outline-offset-2 outline-primary ring-4 ring-primary/20 hover:border-transparent",
    selectedOnly && dashedFrame && "outline-dashed",
    // A Block with an issue keeps its Error edge; selection adds the indigo ring outside it.
    issue &&
      "border-transparent outline-2 -outline-offset-2 outline-destructive hover:border-transparent",
    issue && selected && "ring-2 ring-primary",
    dimmed && "opacity-40",
    dragging && "z-10 cursor-grabbing shadow-lift",
    connectTarget && "ring-2 ring-primary/30",
  );
}

/** An editable block: dragged by its identity rows, with a connection handle on each usable exit. */
function authoringBlock({
  graph,
  recipients,
  block,
  agents,
  marks,
  selected,
  dragging,
  connectTarget,
  connectingExitId,
  fromFlowInput,
  onSelect,
  drag,
  connectFrom,
}: {
  graph: FlowGraph;
  recipients: ReturnType<typeof exitRecipients>;
  block: CanvasBlock;
  agents: readonly AgentDefinition[];
  marks: ReadinessMarks;
  selected: boolean;
  /** Lifted above the other blocks while it follows the pointer. */
  dragging: boolean;
  /** A connection being drawn would connect to this block. */
  connectTarget: boolean;
  /** The exit a connection is being drawn from, when it belongs to this block. */
  connectingExitId: string | null;
  /** A wire is being drawn from the Flow input, which reaches only Agent blocks. */
  fromFlowInput: boolean;
  onSelect: () => void;
  drag: DragHandlers;
  connectFrom: (exit: CanvasBlock["exits"][number]) => DragHandlers;
}): CanvasBlockContent {
  const name = block.name || "Unnamed block";
  const issue = marks.blocks.get(block.id)?.[0]?.issue;
  const { tags, describedBy } = blockTags(block, issue);
  const unconnected = (exitId: string) => marks.unconnectedOutputs.has(outputKey(block.id, exitId));
  const reference = blockReference(block, { graph, agents }).card;
  const route = conditionRoutes(block);
  const identity = blockIdentity({
    kind: block.kind,
    name,
    label: reference.label,
    value: reference.value,
    valueClassName: REFERENCE_TONES[reference.tone],
    trailing: (
      <>
        {tags}
        {grip(selected)}
      </>
    ),
  });
  return {
    className: blockFrameClass({
      kind: block.kind,
      selected,
      issue: issue !== undefined,
      dimmed: fromFlowInput && block.kind !== "agent",
      dragging,
      connectTarget,
    }),
    press: {
      covers: "identity",
      render: (rows) => (
        <DragButton
          className={cn(dragPressClass, "rounded-t-lg")}
          aria-label={`${BLOCK_KINDS[block.kind].name} ${name}`}
          aria-describedby={describedBy}
          aria-pressed={selected}
          {...drag}
          onClick={onSelect}
        >
          {rows}
        </DragButton>
      ),
    },
    header: identity.header,
    title: identity.title,
    exit: (exit) => (
      <AuthoringExit
        exit={exit}
        route={route(exit.id)}
        recipients={recipients(block.id, exit.id).join(", ")}
        unconnected={unconnected(exit.id)}
      />
    ),
    exitPort: (exit) =>
      exit.unavailable
        ? unavailablePort
        : connectionHandle(
            exitPortLabel(exit, name),
            connectingExitId === exit.id,
            connectFrom(exit),
            unconnected(exit.id),
          ),
    incomingPort: incomingPort(fromFlowInput && block.kind === "agent"),
    footers: [],
  };
}

function authoringFinish({
  marks,
  selected,
  dragging,
  connectTarget,
  pendingSource,
  onSelect,
  drag,
}: {
  marks: ReadinessMarks;
  selected: boolean;
  dragging: boolean;
  connectTarget: boolean;
  pendingSource: WireSource | null;
  onSelect: () => void;
  drag: DragHandlers;
}): CanvasFinishContent {
  const issue = marks.finish[0]?.issue;
  const issueId = "finish-issue";
  return {
    state: { kind: "authoring", unconnected: marks.unconnectedEndings },
    className: blockFrameClass({
      kind: "finish",
      selected,
      issue: issue !== undefined,
      dimmed: pendingSource?.kind === "flow-input",
      dragging,
      connectTarget,
    }),
    press: (rows) => (
      <DragButton
        className={cn(dragPressClass, "rounded-t-lg")}
        aria-label="Finish"
        aria-describedby={issue ? issueId : undefined}
        aria-pressed={selected}
        {...drag}
        onClick={onSelect}
      >
        {rows}
      </DragButton>
    ),
    trailing: (
      <>
        {issue && (
          <StatusBadge id={issueId} kind="error">
            {issueTag(issue)}
          </StatusBadge>
        )}
        {grip(selected)}
      </>
    ),
    endingPort: (ending, pending) =>
      incomingPort(false, marks.unconnectedEndings.has(ending.id))(pending),
  };
}

/** The identity rows of a new block as this canvas draws them, for the block library's drag ghost. */
export function BlockPreview({
  kind,
  name,
  label,
  value,
  className,
  style,
}: {
  kind: FlowBlock["kind"];
  name: string;
  label: string;
  value: string;
  className?: string;
  style?: CSSProperties;
}) {
  const rows = AUTHORING_DIMENSIONS.block;
  const identity = blockIdentity({ kind, name, label, value });
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-lg bg-card",
        BLOCK_KINDS[kind].dashedFrame && "border-dashed border-border-strong",
        className,
      )}
      style={{ ...style, width: rows.width, borderWidth: rows.border }}
    >
      <IdentityRows rows={rows} header={identity.header} title={identity.title} />
    </div>
  );
}

/** How a gesture in progress involves one block. */
function blockGesture(drag: MoveDrag | null, connect: ConnectDrag | null, blockId: string) {
  const source = connect?.source;
  return {
    dragging: drag?.node.kind === "block" && drag.node.blockId === blockId,
    connectTarget:
      connect?.target?.targetEndingId === undefined && connect?.target?.targetBlockId === blockId,
    connectingExitId:
      source?.kind === "exit" && source.sourceBlockId === blockId ? source.exitId : null,
  };
}

type FlowCanvasProps = {
  ref: RefObject<HTMLElement | null>;
  graph: FlowGraph;
  agents: readonly AgentDefinition[];
  /** Where readiness issues mark the Flow input, Blocks and Condition outputs. */
  marks: ReadinessMarks;
  selected: CanvasBlockSelection | null;
  selectedWire: FlowWire | null;
  /** Blocks the view keeps visible: the selected Block and the next one. */
  reveal: readonly CanvasBlockSelection[];
  /** Scopes the view: a new Flow opens at its entry view. */
  flowId: string;
  savedGraph: FlowGraph | undefined;
  busy: boolean;
  /** Returns placement without exposing the canvas view transform to the library. */
  placementRef: RefObject<DropAt | null>;
  onSelect: (blockId: CanvasBlockSelection | null) => void;
  onSelectWire: (wire: FlowWire) => void;
  onDeleteWire: (wire: FlowWire) => void;
  onEdit: (block: FlowBlock) => void;
  onChange: (graph: FlowGraph) => void;
  /** Whether an Auto-arrange run is in progress. */
  onArranging: (arranging: boolean) => void;
};

/** The move and connect gestures, and the placement of library drops, in canvas positions. */
function useAuthoringGestures({
  ref,
  graph,
  placementRef,
  onEdit,
  onChange,
}: Pick<FlowCanvasProps, "ref" | "graph" | "placementRef" | "onEdit" | "onChange">) {
  const points = useRef<CanvasPoints | null>(null);
  useImperativeHandle(
    placementRef,
    () => (x, y, grab) => points.current?.place(x, y, grab) ?? null,
  );
  const move = useMoveDrag(points, (moved, position) =>
    moveGraphNode(graph, moved, position, onChange, onEdit),
  );
  const connect = useConnectDrag(ref, points, graph, onChange);
  return { points, move, connect, gesture: move.drag ?? connect.connect };
}

/** What the Flow input block and each block show, given the gestures in progress. */
function authoringContent({
  graph,
  agents,
  marks,
  selected,
  onSelect,
  gestures: { move, connect },
}: Pick<FlowCanvasProps, "graph" | "agents" | "marks" | "selected" | "onSelect"> & {
  gestures: ReturnType<typeof useAuthoringGestures>;
}) {
  const fromFlowInput = connect.connect?.source.kind === "flow-input";
  const recipients = exitRecipients(graph);
  return {
    flowInput: authoringFlowInput({
      dragging: move.drag?.node.kind === "flow-input",
      connecting: fromFlowInput,
      issue: marks.flowInput,
      selected: selected === FLOW_INPUT,
      onSelect: () => onSelect(FLOW_INPUT),
      drag: move.handlers({ kind: "flow-input" }),
      connectFrom: connect.handlers({ kind: "flow-input" }),
    }),
    finish: authoringFinish({
      marks,
      selected: selected === FINISH_SELECTION,
      dragging: move.drag?.node.kind === "finish",
      connectTarget: connect.connect?.target?.targetEndingId !== undefined,
      pendingSource: connect.connect?.source ?? null,
      onSelect: () => onSelect(FINISH_SELECTION),
      drag: move.handlers({ kind: "finish" }),
    }),
    block: (block: CanvasBlock) =>
      authoringBlock({
        graph,
        recipients,
        block,
        agents,
        marks,
        selected: selected === block.id,
        fromFlowInput,
        ...blockGesture(move.drag, connect.connect, block.id),
        onSelect: () => onSelect(block.id),
        drag: move.handlers({ kind: "block", blockId: block.id }),
        connectFrom: (exit) =>
          connect.handlers({ kind: "exit", sourceBlockId: block.id, exitId: exit.id }),
      }),
  };
}

/** The editable Flow graph on the canvas surface: moving, connecting and selecting. */
export function FlowCanvas({
  ref,
  graph,
  agents,
  marks,
  selected,
  selectedWire,
  reveal,
  flowId,
  savedGraph,
  busy,
  placementRef,
  onSelect,
  onSelectWire,
  onDeleteWire,
  onEdit,
  onChange,
  onArranging,
}: FlowCanvasProps) {
  const gestures = useAuthoringGestures({ ref, graph, placementRef, onEdit, onChange });
  const content = authoringContent({ graph, agents, marks, selected, onSelect, gestures });
  return (
    <CanvasSurface
      ref={ref}
      label="Flow canvas"
      scope={savedGraph ? flowId : null}
      graph={graph}
      agents={agents}
      dimensions={AUTHORING_DIMENSIONS}
      reservedFooters={0}
      flowInput={content.flowInput}
      finish={content.finish}
      block={content.block}
      wires={{
        kind: "curved",
        label: "Directed connections",
        selected: selectedWire,
        onSelect: onSelectWire,
        onDelete: onDeleteWire,
      }}
      covered={{ top: READINESS_HEIGHT }}
      reveal={reveal}
      arrangement={{ busy, saved: savedGraph, commit: onChange, onArranging }}
      gesture={gestures.gesture}
      points={gestures.points}
      onTap={() => onSelect(null)}
    />
  );
}
