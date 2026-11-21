import {
  createFlowLayoutDimensions,
  type CanvasDimensions,
  type WireSource,
} from "@t3-factory/flow-layout";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { type AgentDefinition, type FlowEnding, type FlowGraph } from "@t3-factory/contracts";
import { cn } from "@/lib/utils";
import {
  authoringEntryView,
  entryView,
  fitGraphView,
  mergeGraphBounds,
  type GraphBounds,
} from "../canvas-fit.ts";
import { drawWindow, reaches, shownRect, windowFits, type Rect } from "../canvas-culling.ts";
import { clampGraphPosition, clientToGraphPoint, type CanvasView } from "../canvas-viewport.ts";
import { createCanvasGeometry } from "../flow-geometry.ts";
import {
  addWire,
  canvasGraph,
  type CanvasBlockSelection,
  type BlockPosition,
  type CanvasBlock,
  type CanvasGraph,
  type CanvasNode,
  type FlowWire,
  type WireTarget,
} from "../flow-graph.ts";
import { useCanvasViewport } from "../use-canvas-viewport.ts";
import { useConnectionPreview } from "../use-connection-preview.ts";
import { useFlowLayoutSession } from "../use-flow-layout.ts";
import { CanvasZoomControls } from "./canvas-zoom-controls.tsx";
import { AutoArrangeButton, AutoArrangeStatus } from "./flow-arrange-control.tsx";
import { flowInputIdentity, IdentityRows } from "./flow-block.tsx";
import {
  FinishEndingList,
  finishIdentity,
  finishShowsRows,
  type FinishBlockState,
} from "./finish-block.tsx";
import {
  ConnectionPreview,
  FlowWires,
  nestedWiresReach,
  type WirePresentation,
} from "./flow-wires.tsx";
import { SubflowGroup } from "./subflow-group.tsx";
import {
  computeSubflowPreviews,
  displaceSubflowSiblings,
  placementKey,
  previewBlockFrame,
  SUBFLOW_HEADER_HEIGHT,
  type CanvasFlow,
  type SubflowPreview,
} from "../subflow-preview.ts";

/**
 * How an adapter draws one port. The surface sizes it from the port dimensions and places it
 * at its anchor; a handle receives the frame of the port's hit area and the circle to draw in it.
 */
export type CanvasPort = {
  /** The circle's border, fill and transitions. */
  readonly className: string;
  /** Drawn at the highlight size, as the input a connection being drawn will use. */
  readonly highlighted?: boolean;
  readonly handle?: (frame: CSSProperties, circle: ReactNode) => ReactNode;
};

/** What an adapter draws in the Flow input block; the surface sizes its rows and places its port. */
export type CanvasFlowInputContent = {
  readonly label?: string;
  /** The frame's look. */
  readonly className?: string;
  /** Wraps the identity rows, and a prompt line, in the block's press target. */
  readonly press: (rows: ReactNode) => ReactNode;
  readonly trailing?: ReactNode;
  /** A prompt line is a row inside the press target; prompt images hold controls, so they sit below it. */
  readonly prompt:
    | { readonly kind: "none" }
    | { readonly kind: "line"; readonly content: ReactNode }
    | { readonly kind: "images"; readonly content: ReactNode };
  /** A read-only status row below the prompt, outside the press target. */
  readonly status?: ReactNode;
  readonly port: CanvasPort;
};

export type CanvasFinishContent = {
  readonly state: FinishBlockState;
  /** The frame's look: state and selection. */
  readonly className?: string;
  readonly press: (rows: ReactNode) => ReactNode;
  readonly trailing?: ReactNode;
  readonly endingPort: (ending: FlowEnding, pending: boolean) => CanvasPort;
};

/**
 * What an adapter draws in one block. The surface places the frame and sizes every row and port
 * from the block dimensions; each node here fills its row.
 */
export type CanvasBlockContent = {
  readonly className: string;
  /**
   * The block's press target and the rows it wraps: the identity rows when exit rows hold their
   * own controls, otherwise the whole block.
   */
  readonly press: {
    readonly covers: "identity" | "block";
    readonly render: (rows: ReactNode) => ReactNode;
  };
  readonly header: ReactNode;
  readonly title: ReactNode;
  readonly exit: (exit: CanvasBlock["exits"][number]) => ReactNode;
  readonly exitPort: (exit: CanvasBlock["exits"][number]) => CanvasPort;
  /** `pending` marks the input a connection being drawn will use. */
  readonly incomingPort: (pending: boolean) => CanvasPort;
  /** The status footers drawn now, in order. */
  readonly footers: readonly ReactNode[];
  readonly subflowFooter?: ReactNode;
  readonly subflowBadge?: ReactNode;
};

/**
 * A gesture in progress, drawn over the graph without changing it: a node at its dragged
 * position, or a connection being drawn to the pointer or to the block it would connect to.
 */
export type CanvasGesture =
  | { readonly kind: "move"; readonly node: CanvasNode; readonly position: BlockPosition }
  | {
      readonly kind: "connect";
      readonly source: WireSource;
      readonly pointer: BlockPosition;
      readonly target: WireTarget | null;
    };

/** Pointer offset from a block's corner, in canvas units. */
export type GrabOffset = { x: number; y: number };

/** Where a dropped block lands: its canvas position and its top-left corner in the viewport. */
export type Placement = { position: BlockPosition; left: number; top: number };

/** Viewport points as canvas positions, for an adapter's gestures. */
export type CanvasPoints = {
  /** The canvas position under a viewport point, clamped to the canvas range. */
  readonly at: (x: number, y: number) => BlockPosition;
  /** The offset of a viewport point from an element's top-left corner, in canvas units. */
  readonly grab: (point: { x: number; y: number }, element: Element) => GrabOffset;
  /** Where a block held at `grab` lands when dropped at a viewport point; null outside the canvas. */
  readonly place: (x: number, y: number, grab: GrabOffset) => Placement | null;
};

type Dimensions = CanvasDimensions;
type Geometry = ReturnType<typeof createCanvasGeometry>;

/** Space kept around Blocks a selection reveals. */
const REVEAL_MARGIN = 24;

/** Fit keeps this margin at the sides and room for the zoom controls at the bottom. */
const FIT_MARGIN = { x: 48, bottom: 80 };

/**
 * A port centred on its wire anchor: `center` below its container's inner top edge, on the
 * block's outer left or right edge. Anchors are measured from the block's outer edge, while the
 * port is placed inside the block's drawn `border`.
 */
function SurfacePort({
  side,
  center,
  border,
  port,
  look,
  graphY,
}: {
  side: "left" | "right";
  center: number;
  border: number;
  port: Dimensions["port"];
  look: CanvasPort;
  /** An input's anchor below the block's top, for the journeys that read it. */
  graphY?: number;
}) {
  const frame = (size: number): CSSProperties => ({
    position: "absolute",
    top: center - size / 2,
    [side]: -(border + size / 2),
    width: size,
    height: size,
  });
  if (look.handle)
    return look.handle(
      frame(port.handle),
      <span
        aria-hidden
        className={cn("rounded-full", look.className)}
        style={{ width: port.size, height: port.size }}
      />,
    );
  return (
    <span
      aria-hidden
      data-incoming-port={graphY === undefined ? undefined : true}
      data-graph-y={graphY}
      className={cn("rounded-full", look.className)}
      style={frame(look.highlighted ? port.highlight : port.size)}
    />
  );
}

function SurfaceFlowInput({
  graph,
  geometry,
  dimensions,
  content,
}: {
  graph: CanvasGraph;
  geometry: Geometry;
  dimensions: Dimensions;
  content: CanvasFlowInputContent;
}) {
  const input = dimensions.flowInput;
  const { prompt } = content;
  const identity = flowInputIdentity(content.trailing, content.label);
  return (
    <article
      aria-label="Flow input block"
      data-flow-input
      className={cn(
        "absolute flex flex-col rounded-lg border-brand-soft-border bg-card",
        content.className,
      )}
      style={{
        left: graph.flowInput.position.x,
        top: graph.flowInput.position.y,
        width: input.width,
        borderWidth: input.border,
      }}
    >
      {content.press(
        <>
          <IdentityRows rows={input} header={identity.header} title={identity.title} />
          {prompt.kind === "line" && (
            <span className="flex flex-col" style={{ height: input.promptLine }}>
              {prompt.content}
            </span>
          )}
        </>,
      )}
      {prompt.kind === "images" && prompt.content}
      {content.status && (
        <div className="flex flex-col border-t" style={{ height: input.statusLine }}>
          {content.status}
        </div>
      )}
      <SurfacePort
        side="right"
        center={geometry.flowInputPoint.y - graph.flowInput.position.y - input.border}
        border={input.border}
        port={dimensions.port}
        look={content.port}
      />
    </article>
  );
}

function SurfaceFinish({
  graph,
  geometry,
  dimensions,
  content,
  pendingEnding,
}: {
  graph: CanvasGraph;
  geometry: Geometry;
  dimensions: Dimensions;
  content: CanvasFinishContent;
  pendingEnding: string | null;
}) {
  const rows = dimensions.block;
  const { endings } = graph.finish;
  const { state } = content;
  const identity = finishIdentity(state, endings.length, content.trailing);
  const box = geometry.finishBox;
  return (
    <article
      aria-label="Finish block"
      data-finish
      className={cn("absolute flex flex-col rounded-lg bg-card", content.className)}
      style={{ left: box.x, top: box.y, width: rows.width, borderWidth: rows.border }}
    >
      {content.press(
        <IdentityRows
          rows={{ header: rows.header, title: dimensions.finish.title }}
          header={identity.header}
          title={identity.title}
        />,
      )}
      {finishShowsRows(state, endings.length) && (
        <FinishEndingList
          endings={endings}
          state={state}
          rows={rows}
          ariaLabel="Endings"
          renderPort={(ending) => (
            <SurfacePort
              side="left"
              center={rows.exitRow / 2}
              border={rows.border}
              port={dimensions.port}
              look={content.endingPort(ending, ending.id === pendingEnding)}
            />
          )}
        />
      )}
    </article>
  );
}

function SurfaceBlock({
  block,
  geometry,
  dimensions,
  content,
  pendingInput,
}: {
  block: CanvasBlock;
  geometry: Geometry;
  dimensions: Dimensions;
  content: CanvasBlockContent;
  /** The input a connection being drawn to this block will use. */
  pendingInput: number | null;
}) {
  const rows = dimensions.block;
  const border = rows.border;
  const identity = <IdentityRows rows={rows} header={content.header} title={content.title} />;
  const body = (
    <>
      <span className="bg-border" style={{ height: rows.divider }} />
      <ul style={{ paddingTop: rows.exitPaddingTop, paddingBottom: rows.exitPaddingBottom }}>
        {block.exits.map((exit) => (
          <li
            key={exit.id}
            className="relative flex items-center gap-1.5 pr-3.5 pl-3"
            style={{ height: rows.exitRow }}
          >
            {content.exit(exit)}
            <SurfacePort
              side="right"
              center={rows.exitRow / 2}
              border={border}
              port={dimensions.port}
              look={content.exitPort(exit)}
            />
          </li>
        ))}
      </ul>
      <span aria-hidden style={{ height: geometry.incomingGrowth(block) }} />
      {content.footers.map((footer, index) => (
        <span key={index} className="flex flex-col" style={{ height: rows.footer }}>
          {footer}
        </span>
      ))}
      {content.subflowFooter}
    </>
  );
  const inputs = Math.max(1, geometry.incomingPorts(block).length);
  return (
    <article
      className={cn("absolute flex flex-col rounded-lg", content.className)}
      style={{
        left: block.position.x,
        top: block.position.y,
        width: rows.width,
        borderWidth: border,
      }}
      aria-label={`Block ${block.name || "Unnamed block"}`}
      data-block-id={block.id}
    >
      {content.press.covers === "block" ? (
        content.press.render(
          <>
            {identity}
            {body}
          </>,
        )
      ) : (
        <>
          {content.press.render(identity)}
          {body}
        </>
      )}
      {Array.from({ length: inputs }, (_, index) => {
        const graphY = geometry.inputPoint(block, index).y - block.position.y;
        return (
          <SurfacePort
            key={index}
            side="left"
            center={graphY - border}
            border={border}
            port={dimensions.port}
            look={content.incomingPort(index === pendingInput)}
            graphY={graphY}
          />
        );
      })}
    </article>
  );
}

/** The graph as shown while a gesture is in progress, and the connection it would add. */
function gestureGraph(graph: CanvasGraph, gesture: CanvasGesture | null) {
  if (gesture?.kind === "move") {
    const { node, position } = gesture;
    if (node.kind === "flow-input")
      return { graph: { ...graph, flowInput: { ...graph.flowInput, position } }, pending: null };
    if (node.kind === "finish")
      return { graph: { ...graph, finish: { ...graph.finish, position } }, pending: null };
    const blocks = graph.blocks.map((b) => (b.id === node.blockId ? { ...b, position } : b));
    return { graph: { ...graph, blocks }, pending: null };
  }
  if (gesture?.kind !== "connect" || !gesture.target) return { graph, pending: null };
  const pending: FlowWire = { source: gesture.source, ...gesture.target };
  return { graph: addWire(graph, pending), pending };
}

/** Where a wire from `source` starts, or null when its block is gone. */
function sourcePoint(graph: CanvasGraph, geometry: Geometry, source: WireSource) {
  if (source.kind === "flow-input") return geometry.flowInputPoint;
  const block = graph.blocks.find((b) => b.id === source.sourceBlockId);
  return block ? geometry.exitPoint(block, source.exitId) : null;
}

/** The connection being drawn: from its source port to the target's input port, or to the pointer. */
function GesturePreview({
  graph,
  geometry,
  gesture,
}: {
  graph: CanvasGraph;
  geometry: Geometry;
  gesture: CanvasGesture | null;
}) {
  if (gesture?.kind !== "connect") return null;
  const { source } = gesture;
  const from = sourcePoint(graph, geometry, source);
  if (!from) return null;
  return <ConnectionPreview from={from} to={targetPoint(graph, geometry, gesture)} />;
}

function targetPoint(
  graph: CanvasGraph,
  geometry: Geometry,
  { source, target, pointer }: Extract<CanvasGesture, { kind: "connect" }>,
) {
  if (target?.targetEndingId !== undefined) {
    const index = graph.finish.endings.findIndex((e) => e.id === target.targetEndingId);
    return index < 0 ? pointer : geometry.endingPoint(index);
  }
  const block = graph.blocks.find((b) => b.id === target?.targetBlockId);
  return block ? geometry.inputPoint(block, geometry.incomingPortIndex(block.id, source)) : pointer;
}

/**
 * The transformed layer covers every node with a margin, so empty canvas around the graph pans.
 */
function layerSize(geometries: readonly Geometry[]) {
  const boxes = geometries.flatMap((geometry) => geometry.boxes());
  return {
    width: Math.max(960, ...boxes.map((box) => box.x + box.width + 80)),
    height: Math.max(640, ...boxes.map((box) => box.y + box.height + 120)),
  };
}

/** Viewport points in canvas units under the current view. */
function canvasPoints(surface: RefObject<HTMLElement | null>, view: CanvasView): CanvasPoints {
  const at = (element: HTMLElement, x: number, y: number) =>
    clampGraphPosition(clientToGraphPoint(element, view, x, y));
  return {
    at: (x, y) => (surface.current ? at(surface.current, x, y) : { x, y }),
    grab: (point, element) => {
      const corner = element.getBoundingClientRect();
      return { x: (point.x - corner.left) / view.scale, y: (point.y - corner.top) / view.scale };
    },
    place: (x, y, grab) => {
      const element = surface.current;
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
      const position = at(element, x - grab.x * view.scale, y - grab.y * view.scale);
      return {
        position,
        left: bounds.left - element.scrollLeft + view.x + position.x * view.scale,
        top: bounds.top - element.scrollTop + view.y + position.y * view.scale,
      };
    },
  };
}

const noCollapsed = new Set<string>();
const noBlocked = new Map();

function useSurfacePreviews(
  { nested, flows, agents, dimensions, subflowPreviews }: CanvasSurfaceProps,
  source: CanvasGraph,
  arranged: ReadonlyMap<string, CanvasFlow> | undefined,
) {
  const rootId = nested?.rootId;
  const collapsed = nested?.collapsed;
  const runFlows = arranged ?? flows;
  return useMemo(
    () =>
      rootId && collapsed && runFlows
        ? computeSubflowPreviews({
            rootFlowId: rootId,
            graph: source,
            flows: runFlows,
            agents,
            dimensions,
            collapsed: noCollapsed,
            blocked: noBlocked,
            runCollapsed: collapsed,
            arranged: arranged !== undefined,
          })
        : subflowPreviews,
    [rootId, collapsed, runFlows, source, agents, dimensions, subflowPreviews, arranged],
  );
}

type NestedCanvas = {
  readonly rootId: string;
  readonly collapsed: ReadonlySet<string>;
  readonly block: (scope: string, block: CanvasBlock) => CanvasBlockContent;
  readonly header: (path: string) => ReactNode;
  readonly input: (path: string) => CanvasFlowInputContent;
  readonly finish: (path: string) => CanvasFinishContent;
  readonly reveal: { readonly path: string; readonly request: number } | null;
  readonly pause: number;
  readonly resume: () => void;
};

type CanvasSurfaceProps = {
  /** The canvas region, for callers that move focus to it. */
  ref?: RefObject<HTMLElement | null>;
  /** The canvas region's accessible name. */
  label: string;
  /** What the canvas shows, such as a Flow or a Run, once its graph is ready; a new scope fits and arranges afresh. */
  scope: string | null;
  graph: FlowGraph;
  /** The Agents the graph's block exits resolve against. */
  agents: readonly Pick<AgentDefinition, "id" | "exits">[];
  flows?: ReadonlyMap<string, CanvasFlow> | undefined;
  nested?: NestedCanvas | undefined;
  previewAgents?: readonly AgentDefinition[] | undefined;
  subflowPreviews?: ReadonlyMap<string, SubflowPreview> | undefined;
  onCollapseSubflow?: ((blockId: string) => void) | undefined;
  dimensions: Dimensions;
  /** The most status footers a block can draw; a local arrangement reserves room for them. */
  reservedFooters: number;
  flowInput: CanvasFlowInputContent;
  finish?: CanvasFinishContent;
  block: (block: CanvasBlock) => CanvasBlockContent;
  blockFooters?: (block: CanvasBlock) => number;
  wires: WirePresentation;
  /** Space floating badges cover at the top; fit frames the graph below them. */
  covered: { readonly top: number };
  /** Without blocks, fit frames this area from the Flow input instead of the input alone. */
  emptyGraphSize?: { readonly width: number; readonly height: number };
  /** Blocks the entry view frames and following tracks, in a stable order; without them nothing follows. */
  focusTargets?: readonly string[];
  /** Entry targets when the opening view differs from live following. */
  entryTargets?: readonly string[];
  /**
   * Blocks to keep in view, such as a selected Block and the next one; a change pans the least
   * distance that shows them whole.
   */
  reveal?: readonly CanvasBlockSelection[];
  /** Whether the canvas is shown rather than covered by another screen. */
  shown?: boolean;
  /** Where an explicit arrangement is committed; without it an arrangement stays local. */
  arrangement?: {
    readonly busy: boolean;
    /** Routes are restored on load only while the graph keeps these saved positions. */
    readonly saved: FlowGraph | undefined;
    readonly commit: (graph: FlowGraph) => void;
    /** Whether an explicit arrangement is in progress. */
    readonly onArranging?: (arranging: boolean) => void;
  };
  gesture?: CanvasGesture | null;
  /** Filled with conversions of viewport points to canvas positions. */
  points?: RefObject<CanvasPoints | null>;
  /** A tap on empty canvas. */
  onTap: () => void;
  /** Content in canvas coordinates, drawn behind the blocks. */
  children?: ReactNode;
  /** Top-left badges and notices; they never block panning. */
  overlay?: ReactNode;
};

function withSubflowFrames<Facts>(
  facts: Facts,
  previews: ReadonlyMap<string, SubflowPreview> | undefined,
) {
  return previews?.size ? { ...facts, blockFrame: previewBlockFrame(previews) } : facts;
}

function useLayoutGestures(
  layout: ReturnType<typeof useFlowLayoutSession>,
  gesture: CanvasGesture | null,
  onArranging: ((arranging: boolean) => void) | undefined,
) {
  const gesturing = gesture !== null;
  const { cancel, pending: arranging } = layout;
  useLayoutEffect(() => {
    if (gesturing) cancel();
  }, [gesturing, cancel]);
  useEffect(() => {
    onArranging?.(arranging);
  }, [arranging, onArranging]);
}

/**
 * The graph as the surface draws it: each block's content, the arrangement, the gesture in
 * progress and the geometry of each. Any gesture abandons an arrangement in flight.
 */
function useSurfaceGraph(props: CanvasSurfaceProps) {
  const {
    scope,
    graph: sourceGraph,
    agents,
    flows,
    subflowPreviews: studioPreviews,
    nested,
    dimensions,
    reservedFooters,
    flowInput,
    finish,
    block: blockContent,
    blockFooters,
    wires,
    emptyGraphSize,
    arrangement,
    gesture = null,
  } = props;
  const source = useMemo(
    () => canvasGraph(sourceGraph, agents, flows),
    [sourceGraph, agents, flows],
  );
  const promptKind = flowInput.prompt.kind;
  const hasFlowInputStatus = flowInput.status !== undefined;
  const hasFinish = finish !== undefined;
  const facts = useMemo(
    () => ({
      prompt: promptKind,
      flowInputStatus: hasFlowInputStatus,
      ...(blockFooters ? { footerCount: blockFooters } : {}),
      reservedFooterCount: reservedFooters,
      emptyGraphSize,
      finish: hasFinish,
    }),
    [promptKind, hasFlowInputStatus, blockFooters, reservedFooters, emptyGraphSize, hasFinish],
  );
  const layout = useFlowLayoutSession({
    scope,
    graph: sourceGraph,
    agents,
    flows,
    getDimensions: () =>
      createFlowLayoutDimensions(
        source,
        dimensions,
        withSubflowFrames(facts, studioPreviews),
        wires.kind === "curved",
      ),
    composition: nested && flows ? { flows, dimensions } : undefined,
    authoring: arrangement && {
      busy: arrangement.busy,
      savedGraph: arrangement.saved,
      change: arrangement.commit,
    },
  });
  const subflowPreviews = useSurfacePreviews(props, source, layout.arrangedFlows);
  const drawFacts = useMemo(
    () => withSubflowFrames(facts, subflowPreviews),
    [facts, subflowPreviews],
  );
  const nestedLayout = nested !== undefined;
  const arranged = useMemo(() => {
    const graph = layout.graph === sourceGraph ? source : canvasGraph(layout.graph, agents, flows);
    return nestedLayout && subflowPreviews && !layout.arrangedFlows
      ? displaceSubflowSiblings(graph, subflowPreviews, dimensions)
      : graph;
  }, [
    layout.graph,
    layout.arrangedFlows,
    sourceGraph,
    source,
    agents,
    flows,
    nestedLayout,
    subflowPreviews,
    dimensions,
  ]);
  const shown = useMemo(() => gestureGraph(arranged, gesture), [arranged, gesture]);
  const geometry = useMemo(
    () => createCanvasGeometry(arranged, dimensions, drawFacts),
    [arranged, dimensions, drawFacts],
  );
  const drawn = useMemo(
    () =>
      shown.graph === arranged
        ? geometry
        : createCanvasGeometry(shown.graph, dimensions, drawFacts),
    [shown.graph, arranged, geometry, dimensions, drawFacts],
  );
  useLayoutGestures(layout, gesture, arrangement?.onArranging);
  return {
    layout,
    subflowPreviews,
    content: blockContent,
    arranged,
    /** Fit, focus and the arrangement use the graph without the gesture. */
    geometry,
    graph: shown.graph,
    drawn,
    pending: shown.pending,
    /** Arranged routes are drawn only while no gesture changes the graph. */
    routes: gesture?.kind === "move" || shown.pending || nestedLayout ? null : layout.wireRoutes,
  };
}

type SurfaceGraph = ReturnType<typeof useSurfaceGraph>;

function useSurfaceSize(surface: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    const measure = () =>
      setSize((previous) =>
        previous?.width === element.clientWidth && previous.height === element.clientHeight
          ? previous
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [surface]);
  return size;
}

function useDrawWindow(view: CanvasView, size: { width: number; height: number } | null) {
  const [kept, setKept] = useState<Rect | null>(null);
  if (!size) return null;
  const shown = shownRect(view, size);
  if (kept && windowFits(kept, shown)) return kept;
  const next = drawWindow(shown);
  setKept(next);
  return next;
}

function blockOf(target: EventTarget | null) {
  return target instanceof Element
    ? (target.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? null)
    : null;
}

function pinnedBlockIds(gesture: CanvasGesture | null, focused: string | null) {
  const ids: string[] = [];
  if (focused !== null) ids.push(focused);
  if (gesture?.kind === "move" && gesture.node.kind === "block") ids.push(gesture.node.blockId);
  if (gesture?.kind === "connect") {
    if (gesture.source.kind === "exit") ids.push(gesture.source.sourceBlockId);
    if (gesture.target) ids.push(gesture.target.targetBlockId);
  }
  return ids;
}

const EMPTY_PREVIEW_AGENTS: readonly AgentDefinition[] = [];
const EMPTY_PREVIEW_FLOWS: ReadonlyMap<string, CanvasFlow> = new Map();

function SurfaceBlockItem({
  block,
  drawn,
  content,
  pendingInput,
  surface,
  scopePath = "",
  previews,
  area = null,
}: {
  block: CanvasBlock;
  drawn: Geometry;
  content: CanvasBlockContent;
  pendingInput: number | null;
  surface: CanvasSurfaceProps;
  scopePath?: string;
  previews?: ReadonlyMap<string, SubflowPreview> | undefined;
  area?: Rect | null;
}) {
  const { dimensions, flows, previewAgents, nested, onCollapseSubflow } = surface;
  const subflowPreview = (previews ?? surface.subflowPreviews)?.get(block.id);
  const path = placementKey(scopePath, block.id);
  if (!subflowPreview) {
    return (
      <SurfaceBlock
        block={block}
        geometry={drawn}
        dimensions={dimensions}
        content={content}
        pendingInput={pendingInput}
      />
    );
  }
  const inputs = Math.max(1, drawn.incomingPorts(block).length);
  const incomingPorts = Array.from({ length: inputs }, (_, index) => ({
    key: `in:${index}`,
    graphY: drawn.inputPoint(block, index).y - block.position.y,
  }));
  const exitPorts = block.exits.map((exit) => ({
    exit,
    y: drawn.exitPoint(block, exit.id).y - block.position.y,
  }));
  const showPort = (side: "left" | "right", y: number) =>
    !nested ||
    (area !== null &&
      reaches(
        area,
        {
          x: block.position.x + (side === "right" ? subflowPreview.width : 0),
          y: block.position.y + y,
          width: 0,
          height: 0,
        },
        16,
      ));
  return (
    <SubflowGroup
      block={block}
      preview={subflowPreview}
      geometry={drawn}
      dimensions={dimensions}
      agents={previewAgents ?? EMPTY_PREVIEW_AGENTS}
      flows={flows ?? EMPTY_PREVIEW_FLOWS}
      frameClassName={content.className}
      border={dimensions.block.border}
      headerPress={content.press.render}
      trailingBadge={content.subflowBadge}
      runHeader={
        nested && {
          visible:
            area !== null &&
            reaches(area, { ...drawn.blockBox(block), height: SUBFLOW_HEADER_HEIGHT }),
          evidence: nested.header(path),
        }
      }
      onCollapse={() => onCollapseSubflow?.(nested ? path : block.id)}
      incomingPorts={incomingPorts.filter(({ graphY }) => showPort("left", graphY))}
      exitPorts={exitPorts.filter(({ y }) => showPort("right", y))}
      renderPort={({ key, side, center, border, graphY }) => (
        <SurfacePort
          key={key}
          side={side}
          center={center}
          border={border}
          port={dimensions.port}
          look={
            side === "left"
              ? content.incomingPort(Number(key.slice(3)) === pendingInput)
              : content.exitPort(block.exits.find((candidate) => `exit:${candidate.id}` === key)!)
          }
          {...(graphY !== undefined ? { graphY } : {})}
        />
      )}
    />
  );
}

function visibleBlocks(
  blocks: readonly CanvasBlock[],
  drawn: Geometry,
  area: Rect | null,
  pinned: ReadonlySet<string>,
) {
  return blocks.filter(
    (item) => pinned.has(item.id) || (area !== null && reaches(area, drawn.blockBox(item))),
  );
}

function pendingBlockInput(pending: FlowWire | null, drawn: Geometry, blockId: string) {
  return pending?.targetEndingId === undefined && pending?.targetBlockId === blockId
    ? drawn.incomingPortIndex(blockId, pending.source)
    : null;
}

function SurfaceLayer({
  surface,
  view,
  area,
  surfaceGraph,
  startPan,
}: {
  surface: CanvasSurfaceProps;
  view: CanvasView;
  area: Rect | null;
  surfaceGraph: SurfaceGraph;
  startPan: (event: PointerEvent<HTMLElement>) => void;
}) {
  const { scope, shown = true, dimensions, wires, flowInput, finish, children } = surface;
  const gesture = surface.gesture ?? null;
  const { geometry, graph, drawn, pending, routes, content } = surfaceGraph;
  // Kept here rather than in the surface, so a preview does not recompute every block's content.
  const preview = useConnectionPreview({ enabled: wires.kind === "orthogonal", scope, shown });
  const [focused, setFocused] = useState<string | null>(null);
  const pinned = useMemo(() => new Set(pinnedBlockIds(gesture, focused)), [gesture, focused]);
  const layer = useMemo(() => layerSize([geometry, drawn]), [geometry, drawn]);
  const blocks = useMemo(
    () => visibleBlocks(graph.blocks, drawn, area, pinned),
    [graph.blocks, drawn, area, pinned],
  );
  return (
    <div
      data-canvas-pan
      className="absolute top-0 left-0 origin-top-left"
      style={{
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        ...layer,
      }}
      onPointerDown={startPan}
      onFocusCapture={(event) => setFocused(blockOf(event.target))}
      onBlurCapture={(event) => setFocused(blockOf(event.relatedTarget))}
      {...preview.handlers}
    >
      <FlowWires
        graph={graph}
        geometry={drawn}
        presentation={wires}
        routes={routes}
        pendingWire={pending}
        emphasized={preview.source}
        finish={finish !== undefined}
        area={area}
      />
      <GesturePreview graph={graph} geometry={drawn} gesture={gesture} />
      {children}
      <SurfaceFlowInput
        graph={graph}
        geometry={drawn}
        dimensions={dimensions}
        content={flowInput}
      />
      {finish && (
        <SurfaceFinish
          graph={graph}
          geometry={drawn}
          dimensions={dimensions}
          content={finish}
          pendingEnding={pending?.targetEndingId ?? null}
        />
      )}
      {blocks.map((item) => (
        <SurfaceBlockItem
          key={item.id}
          block={item}
          drawn={drawn}
          content={content(item)}
          pendingInput={pendingBlockInput(pending, drawn, item.id)}
          surface={surface}
          area={area}
        />
      ))}
      {surface.nested &&
        area &&
        surface.subflowPreviews &&
        drawNestedScopes(surface, surface.nested, graph, surface.subflowPreviews, area)}
    </div>
  );
}

function containsRect(outer: Rect, inner: Rect) {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

function drawNestedScopes(
  surface: CanvasSurfaceProps,
  nested: NestedCanvas,
  root: CanvasGraph,
  previews: ReadonlyMap<string, SubflowPreview>,
  area: Rect,
) {
  const layers: ReactNode[] = [];
  function visit(
    graph: CanvasGraph,
    groups: ReadonlyMap<string, SubflowPreview>,
    scope: string,
    x: number,
    y: number,
  ) {
    if (!groups.size) return;
    for (const block of graph.blocks) {
      const group = groups.get(block.id);
      if (!group) continue;
      const left = x + block.position.x;
      const top = y + block.position.y;
      if (!reaches(area, { x: left, y: top, width: group.width, height: group.height })) continue;
      const path = placementKey(scope, block.id);
      const offsetX = left + group.offsetX;
      const offsetY = top + group.offsetY;
      const local = { ...area, x: area.x - offsetX, y: area.y - offsetY };
      const { innerGraph, innerGeometry, innerPreviews } = group;
      const blocks = innerGraph.blocks.filter((item) => {
        const box = innerGeometry.blockBox(item);
        if (!reaches(local, box)) return false;
        return !innerPreviews.has(item.id) || !containsRect(box, local);
      });
      const input = reaches(local, innerGeometry.flowInputBox);
      const finish = reaches(local, innerGeometry.finishBox);
      const wire = nestedWiresReach(innerGraph, innerGeometry, local);
      const entry = group.incomingEntry;
      const innerEntry = { x: entry.x - group.offsetX, y: entry.y - group.offsetY };
      const entryBridge = reaches(local, {
        x: -group.offsetX,
        y: innerEntry.y,
        width: entry.x,
        height: 0,
      });
      const exitBridges = group.endingRoutes.filter(({ from, to }) =>
        reaches(local, {
          x: from.x - group.offsetX,
          y: from.y - group.offsetY,
          width: to.x - from.x,
          height: 0,
        }),
      );
      if (input || finish || wire || blocks.length || entryBridge || exitBridges.length)
        layers.push(
          <div
            key={path}
            className="pointer-events-none absolute [&>article]:pointer-events-auto"
            style={{ left: offsetX, top: offsetY, width: 1, height: 1 }}
          >
            {(entryBridge || exitBridges.length > 0) && (
              <svg
                aria-hidden
                className="pointer-events-none absolute overflow-visible fill-none stroke-muted-foreground/70 stroke-[1.5]"
              >
                {entryBridge && <path d={`M${-group.offsetX},${innerEntry.y} H${innerEntry.x}`} />}
                {exitBridges.map(({ endingId, from, to }) => (
                  <path
                    key={endingId}
                    d={`M${from.x - group.offsetX},${from.y - group.offsetY} H${to.x - group.offsetX}`}
                  />
                ))}
              </svg>
            )}
            {wire && (
              <FlowWires
                graph={innerGraph}
                geometry={innerGeometry}
                presentation={surface.wires}
                routes={null}
                pendingWire={null}
                emphasized={null}
                finish
                area={local}
                nested
              />
            )}
            {input && (
              <SurfaceFlowInput
                graph={innerGraph}
                geometry={innerGeometry}
                dimensions={surface.dimensions}
                content={nested.input(path)}
              />
            )}
            {finish && (
              <SurfaceFinish
                graph={innerGraph}
                geometry={innerGeometry}
                dimensions={surface.dimensions}
                content={nested.finish(path)}
                pendingEnding={null}
              />
            )}
            {blocks.map((item) => (
              <SurfaceBlockItem
                key={item.id}
                block={item}
                drawn={innerGeometry}
                content={nested.block(path, item)}
                pendingInput={null}
                surface={surface}
                scopePath={path}
                previews={innerPreviews}
                area={local}
              />
            ))}
          </div>,
        );
      visit(innerGraph, innerPreviews, path, offsetX, offsetY);
    }
  }
  visit(root, previews, "", 0, 0);
  return layers;
}

function nestedBlockBounds(
  graph: CanvasGraph,
  geometry: Geometry,
  groups: ReadonlyMap<string, SubflowPreview>,
) {
  const boxes = new Map<string, Rect>();
  function collect(
    current: CanvasGraph,
    geo: Geometry,
    previews: ReadonlyMap<string, SubflowPreview>,
    scope: string,
    x: number,
    y: number,
  ) {
    for (const block of current.blocks) {
      const path = placementKey(scope, block.id);
      const box = geo.blockBox(block);
      const group = previews.get(block.id);
      boxes.set(path, {
        ...box,
        x: x + box.x,
        y: y + box.y,
        ...(group && { height: SUBFLOW_HEADER_HEIGHT, width: Math.min(box.width, 520) }),
      });
      if (group)
        collect(
          group.innerGraph,
          group.innerGeometry,
          group.innerPreviews,
          path,
          x + box.x + group.offsetX,
          y + box.y + group.offsetY,
        );
    }
  }
  collect(graph, geometry, groups, "", 0, 0);
  return boxes;
}

/** Zoom, fit, Follow active where there are focus targets, and Auto-arrange. */
function SurfaceControls({
  viewport,
  layout,
  focusTargets,
  busy,
  resume,
}: {
  viewport: ReturnType<typeof useCanvasViewport>;
  layout: SurfaceGraph["layout"];
  focusTargets: readonly string[] | undefined;
  busy: boolean;
  resume?: (() => void) | undefined;
}) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col items-start gap-2">
      <CanvasZoomControls
        scale={viewport.view.scale}
        onZoom={viewport.zoom}
        onFit={viewport.fitFlow}
        follow={
          focusTargets && {
            available: focusTargets.length > 0,
            changed: viewport.focusChanged,
            onFollow: () => {
              resume?.();
              viewport.followActive();
            },
          }
        }
        arrange={
          <AutoArrangeButton
            pending={layout.pending}
            disabled={busy}
            onClick={() => void layout.autoArrange()}
          />
        }
      />
      <AutoArrangeStatus error={layout.error} onDismiss={layout.dismissError} />
    </div>
  );
}

/**
 * What a canvas with focus targets opens on: the targets; without any, the whole graph while it
 * fits at 100 %, otherwise the Flow input.
 */
function entryTarget(
  geometry: ReturnType<typeof useSurfaceGraph>["geometry"],
  targets: readonly string[],
  width: number,
  height: number,
) {
  if (targets.length) return geometry.focusBounds(targets);
  const graph = geometry.bounds();
  return graph.width <= width && graph.height <= height
    ? graph
    : mergeGraphBounds(geometry.flowInputBox, []);
}

function useSurfaceFocus(
  props: CanvasSurfaceProps,
  { geometry, arranged, subflowPreviews }: SurfaceGraph,
  padding: { readonly x: number; readonly top: number; readonly bottom: number },
) {
  const { focusTargets } = props;
  const nested = props.nested !== undefined;
  const nestedBoxes = useMemo(
    () =>
      nested && subflowPreviews ? nestedBlockBounds(arranged, geometry, subflowPreviews) : null,
    [nested, subflowPreviews, arranged, geometry],
  );
  const focusBounds = (ids: readonly string[]) => {
    if (!nestedBoxes) return geometry.focusBounds(ids);
    const [first, ...rest] = ids.flatMap((id) => {
      const box = nestedBoxes.get(id);
      return box ? [box] : [];
    });
    return first ? mergeGraphBounds(first, rest) : geometry.bounds();
  };
  const getEntryView = (width: number, height: number) =>
    focusTargets
      ? entryView(
          nestedBoxes && (props.entryTargets ?? focusTargets).length
            ? focusBounds(props.entryTargets ?? focusTargets)
            : entryTarget(geometry, props.entryTargets ?? focusTargets, width, height),
          geometry.boxes(),
          { width, height },
          padding,
        )
      : authoringEntryView(
          geometry.flowInputBox,
          geometry.bounds(),
          geometry.boxes(),
          { width, height },
          padding,
        );
  return { nestedBoxes, focusBounds, getEntryView };
}

function useRevealBounds({
  nestedReveal,
  nestedBoxes,
  revealTargets,
  geometry,
  reveal,
  top,
}: {
  nestedReveal: NestedCanvas["reveal"] | undefined;
  nestedBoxes: ReadonlyMap<string, Rect> | null;
  revealTargets: readonly CanvasBlockSelection[] | undefined;
  geometry: Geometry;
  reveal: ReturnType<typeof useCanvasViewport>["reveal"];
  top: number;
}) {
  const revealBox = nestedReveal ? nestedBoxes?.get(nestedReveal.path) : undefined;
  const revealBounds = revealBox
    ? mergeGraphBounds(revealBox, [])
    : revealTargets?.length
      ? geometry.focusBounds(revealTargets)
      : null;
  const revealKey = revealBounds && JSON.stringify(revealBounds);
  const revealRequest = nestedReveal?.request;
  useLayoutEffect(() => {
    if (!revealKey) return;
    const bounds = JSON.parse(revealKey) as GraphBounds;
    // Keeps a margin, and the covered top, around the revealed Blocks.
    reveal({
      minX: bounds.minX - REVEAL_MARGIN,
      minY: bounds.minY - top,
      width: bounds.width + REVEAL_MARGIN * 2,
      height: bounds.height + top + REVEAL_MARGIN,
    });
  }, [revealKey, revealRequest, reveal, top]);
}

/**
 * The transformed canvas a Flow graph is drawn on. It owns block geometry, the drawn frames,
 * wires, the viewport with following, the arrangement and the zoom controls; the adapter
 * supplies the graph, its block dimensions, what each block shows and its policies.
 * Pan, zoom, fit and following never call the adapter's editing callbacks; positions leave
 * the surface only through `arrangement.commit`.
 */
export function CanvasSurface(props: CanvasSurfaceProps) {
  const { ref, label, focusTargets, shown = true, covered } = props;
  const own = useRef<HTMLElement>(null);
  const surface = ref ?? own;
  const surfaceGraph = useSurfaceGraph(props);
  const { geometry, layout, subflowPreviews } = surfaceGraph;
  const padding = { ...FIT_MARGIN, top: covered.top };
  const { nestedBoxes, focusBounds, getEntryView } = useSurfaceFocus(props, surfaceGraph, padding);
  const viewport = useCanvasViewport({
    surface,
    scope: props.scope,
    shown,
    getBounds: geometry.bounds,
    getFocusView:
      focusTargets &&
      ((width, height) => fitGraphView(focusBounds(focusTargets), width, height, padding)),
    getEntryView,
    focusTargets,
    onFollow: props.nested?.resume,
    padding,
    fitRevision: layout.arranged,
    onTap: props.onTap,
  });
  const { view, reveal, stopFollowing } = viewport;
  const pause = props.nested?.pause;
  useLayoutEffect(() => {
    if (pause) stopFollowing();
  }, [pause, stopFollowing]);
  const nestedReveal = props.nested?.reveal;
  const area = useDrawWindow(view, useSurfaceSize(surface));
  useImperativeHandle(props.points, () => canvasPoints(surface, view), [surface, view]);
  useRevealBounds({
    nestedReveal,
    nestedBoxes,
    revealTargets: props.reveal,
    geometry,
    reveal,
    top: covered.top,
  });
  return (
    <section
      ref={surface}
      aria-label={label}
      data-zoom={view.scale.toFixed(3)}
      data-following={focusTargets ? viewport.following : undefined}
      tabIndex={0}
      onKeyDown={viewport.onKeyDown}
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-background bg-[radial-gradient(var(--border)_1px,transparent_1px)] bg-size-[22px_22px] outline-none focus-ring focus-visible:ring-inset"
    >
      <div data-canvas-pan className="absolute inset-0" onPointerDown={viewport.startPan} />
      <SurfaceLayer
        surface={{ ...props, subflowPreviews }}
        view={view}
        area={area}
        surfaceGraph={surfaceGraph}
        startPan={viewport.startPan}
      />
      {props.overlay && (
        <div className="pointer-events-none absolute top-4 left-4 flex max-w-[calc(100%-2rem)] flex-col items-start gap-2 *:pointer-events-auto">
          {props.overlay}
        </div>
      )}
      <SurfaceControls
        viewport={viewport}
        layout={layout}
        focusTargets={focusTargets}
        busy={props.arrangement?.busy === true}
        resume={props.nested?.resume}
      />
    </section>
  );
}
