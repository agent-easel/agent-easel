import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { Trash2 } from "lucide-react";
import type { FlowConnection } from "@agent-easel/contracts";
import { wireRouteKey } from "@agent-easel/flow-layout";
import { fixedShortcuts, formatShortcut } from "../keyboard-shortcuts.ts";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  incomingApproachLane,
  orthogonalWirePath,
  wirePath,
  type createCanvasGeometry,
} from "../flow-geometry.ts";
import {
  connectionWire,
  leavesNode,
  sameWire,
  type CanvasBlock,
  type CanvasGraph,
  type CanvasNode,
  type FlowWire,
} from "../flow-graph.ts";
import { type WireRoute } from "../flow-layout-elk.ts";
import { reaches, wireReaches, type Rect } from "../canvas-culling.ts";
import { connectionLabel } from "../connection-label.ts";
import { WireLabelChip } from "./wire-label-chip.tsx";

/** Selecting and deleting a wire. */
type WireSelection = {
  readonly selected: FlowWire | null;
  readonly onSelect: (wire: FlowWire) => void;
  readonly onDelete: (wire: FlowWire) => void;
};

export type WirePresentation =
  | ({ readonly kind: "curved"; readonly label: string } & WireSelection)
  | { readonly kind: "orthogonal"; readonly label: string };

type Geometry = ReturnType<typeof createCanvasGeometry>;

type Point = { x: number; y: number };

type WireEnd = { readonly input: Point; readonly bottom: number; readonly lane: number };

function blockEnd(geometry: Geometry, target: CanvasBlock, incomingIndex: number): WireEnd {
  return {
    input: geometry.inputPoint(target, incomingIndex),
    bottom: target.position.y + geometry.blockHeight(target),
    lane: incomingIndex,
  };
}

function routedPath(
  kind: WirePresentation["kind"],
  from: Point,
  fromBottom: number,
  { input, bottom, lane }: WireEnd,
): WireRoute {
  if (kind === "curved") return wirePath(from, input, incomingApproachLane(lane));
  const below = Math.max(fromBottom, bottom) + 24;
  return {
    ...orthogonalWirePath(from, input, below, incomingApproachLane(lane)),
    label: null,
  };
}

type Wire = {
  readonly key: string;
  readonly wire: FlowWire;
  readonly path: WireRoute;
  /** The exit's name for its accessible name; Flow input and Continuation wires are unnamed. */
  readonly exit: string | null;
  readonly chip: ReturnType<typeof connectionLabel>;
  readonly source: string;
  readonly target: string;
};

/** The graph's blocks by id, the first block where an id repeats. */
function blocksById(graph: CanvasGraph) {
  const blocks = new Map<string, CanvasBlock>();
  for (const block of graph.blocks) if (!blocks.has(block.id)) blocks.set(block.id, block);
  return blocks;
}

function wireEnds(graph: CanvasGraph, geometry: Geometry, finish: boolean) {
  const blocks = blocksById(graph);
  const endings = new Map(graph.finish?.endings.map((ending, index) => [ending.id, index]));
  const box = geometry.finishBox;
  return (connection: FlowConnection): (WireEnd & { name: string }) | null => {
    if (connection.targetEndingId !== undefined) {
      const index = endings.get(connection.targetEndingId);
      if (!finish || !box || index === undefined) return null;
      const name = graph.finish?.endings[index]?.name || "Unnamed ending";
      return {
        input: geometry.endingPoint(index),
        bottom: box.y + box.height,
        lane: 0,
        name: `Finish · ${name}`,
      };
    }
    const target = blocks.get(connection.targetBlockId);
    if (!target) return null;
    const source = connectionWire(connection).source;
    return {
      ...blockEnd(geometry, target, geometry.incomingPortIndex(target.id, source)),
      name: target.name || "Unnamed block",
    };
  };
}

export function exitWires(
  graph: CanvasGraph,
  kind: WirePresentation["kind"],
  geometry: Geometry,
  routes: ReadonlyMap<string, WireRoute> | undefined,
  finish = false,
): Wire[] {
  const blocks = blocksById(graph);
  const end = wireEnds(graph, geometry, finish);
  return graph.connections.flatMap((connection): Wire[] => {
    const source = blocks.get(connection.sourceBlockId);
    const target = end(connection);
    if (!source || !target) return [];
    const wire = connectionWire(connection);
    const key = wireRouteKey(wire.source, connection.targetBlockId, connection.targetEndingId);
    const routed = routes?.get(key);
    const exit = geometry.exit(source, connection.exitId);
    const from = geometry.exitPoint(source, connection.exitId);
    const fromBottom = source.position.y + geometry.blockHeight(source);
    return [
      {
        key,
        wire,
        path: routed ?? routedPath(kind, from, fromBottom, target),
        exit: source.kind === "continuation" ? null : exit?.name || "exit",
        chip: connectionLabel(
          exit ?? { id: connection.exitId, name: "", source: "agent", unavailable: "removed" },
        ),
        source: source.name || "Unnamed block",
        target: target.name,
      },
    ];
  });
}

export function wireAt(graph: CanvasGraph, key: string): FlowWire | null {
  for (const targetBlockId of graph.flowInput.targetBlockIds)
    if (wireRouteKey({ kind: "flow-input" }, targetBlockId) === key)
      return { source: { kind: "flow-input" }, targetBlockId };
  for (const connection of graph.connections) {
    const wire = connectionWire(connection);
    if (wireRouteKey(wire.source, connection.targetBlockId, connection.targetEndingId) === key)
      return wire;
  }
  return null;
}

function flowInputWires(
  graph: CanvasGraph,
  kind: WirePresentation["kind"],
  geometry: Geometry,
  routes: ReadonlyMap<string, WireRoute> | undefined,
): Wire[] {
  const from = geometry.flowInputPoint;
  const blocks = blocksById(graph);
  return graph.flowInput.targetBlockIds.flatMap((targetBlockId): Wire[] => {
    const target = blocks.get(targetBlockId);
    if (!target) return [];
    const key = wireRouteKey({ kind: "flow-input" }, targetBlockId);
    const routed = routes?.get(key);
    const incomingIndex = geometry.incomingPortIndex(targetBlockId, { kind: "flow-input" });
    return [
      {
        key,
        wire: { source: { kind: "flow-input" }, targetBlockId },
        path: routed ?? routedPath(kind, from, from.y, blockEnd(geometry, target, incomingIndex)),
        exit: null,
        chip: connectionLabel(null),
        source: "Flow input",
        target: target.name || "Unnamed block",
      },
    ];
  });
}

function visibleWires(
  inputs: readonly Wire[],
  connections: readonly Wire[],
  area: Rect | null,
  current: FlowWire | null,
  focused: string | null,
) {
  const keep = (item: Wire) =>
    item.key === focused ||
    (current !== null && sameWire(item.wire, current)) ||
    (area !== null && wireReaches(area, item.path.bounds));
  const shown: Wire[] = [];
  for (const item of inputs) if (keep(item)) shown.push(item);
  for (const item of connections) if (keep(item)) shown.push(item);
  return shown;
}

const nestedWires = new WeakMap<Geometry, { allInputs: Wire[]; allConnections: Wire[] }>();

export function nestedWiresReach(graph: CanvasGraph, geometry: Geometry, area: Rect) {
  return Object.values(nestedWirePaths(graph, geometry)).some((wires) =>
    wires.some((wire) => wireReaches(area, wire.path.bounds)),
  );
}

function nestedWirePaths(graph: CanvasGraph, geometry: Geometry) {
  const existing = nestedWires.get(geometry);
  if (existing) return existing;
  const computed = {
    allInputs: flowInputWires(graph, "orthogonal", geometry, undefined),
    allConnections: exitWires(graph, "orthogonal", geometry, undefined, true),
  };
  nestedWires.set(geometry, computed);
  return computed;
}

function useVisibleWires({
  graph,
  kind,
  geometry,
  routed,
  finish,
  pendingWire,
  area,
  current,
  focused,
  nested,
}: {
  graph: CanvasGraph;
  kind: WirePresentation["kind"];
  geometry: Geometry;
  routed: ReadonlyMap<string, WireRoute> | undefined;
  finish: boolean;
  pendingWire: FlowWire | null;
  area: Rect | null;
  current: FlowWire | null;
  focused: string | null;
  nested: boolean | undefined;
}) {
  const { allInputs, allConnections } = useMemo(
    () =>
      nested
        ? nestedWirePaths(graph, geometry)
        : {
            allInputs: flowInputWires(graph, kind, geometry, routed),
            allConnections: exitWires(graph, kind, geometry, routed, finish),
          },
    [graph, kind, geometry, routed, finish, nested],
  );
  const connections = useMemo(
    () =>
      pendingWire
        ? allConnections.filter((item) => !sameWire(item.wire, pendingWire))
        : allConnections,
    [allConnections, pendingWire],
  );
  const inputs = useMemo(
    () => (pendingWire ? allInputs.filter((item) => !sameWire(item.wire, pendingWire)) : allInputs),
    [allInputs, pendingWire],
  );
  const wires = useMemo(
    () => visibleWires(inputs, connections, area, current, focused),
    [inputs, connections, area, current, focused],
  );
  return { inputs, connections, wires };
}

function wireKeyOf(target: EventTarget | null) {
  return target instanceof Element
    ? (target.closest("[data-wire-key]")?.getAttribute("data-wire-key") ?? null)
    : null;
}

function WireMarkers({ selection, marker }: { selection: boolean; marker: string }) {
  return (
    <defs>
      {selection ? (
        <>
          <marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" className="fill-muted-foreground" />
          </marker>
          <marker
            id="arrow-selected"
            markerWidth="12"
            markerHeight="10"
            refX="10"
            refY="5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L0,10 L11,5 z" className="fill-primary" />
          </marker>
        </>
      ) : (
        <>
          <marker
            id={marker}
            markerWidth="6"
            markerHeight="8"
            refX="6"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L6,4 L0,8 z" className="fill-subtle-foreground" />
          </marker>
        </>
      )}
      <marker
        id={`${marker}-emphasis`}
        markerWidth="9"
        markerHeight="11"
        refX="9"
        refY="5.5"
        orient="auto"
        markerUnits="userSpaceOnUse"
      >
        <path d="M0,0 L9,5.5 L0,11 z" className="fill-foreground" />
      </marker>
    </defs>
  );
}

function EmphasizedWire({
  wire,
  marker,
  selected,
}: {
  wire: Wire;
  marker: string;
  selected: boolean;
}) {
  const arrow = selected ? "arrow-selected" : `${marker}-emphasis`;
  return (
    <path
      d={wire.path.d}
      aria-hidden
      data-connection-emphasis
      markerEnd={`url(#${arrow})`}
      className={cn(
        "fill-none [stroke-linecap:round] [stroke-linejoin:round]",
        selected
          ? "stroke-primary stroke-[2]"
          : "stroke-foreground stroke-[2.5] motion-safe:transition-[stroke,stroke-width] motion-safe:duration-75 motion-safe:starting:stroke-[1.4] motion-safe:starting:stroke-subtle-foreground",
      )}
    />
  );
}

function useWirePress() {
  const tracking = useRef<AbortController | null>(null);
  useEffect(() => () => tracking.current?.abort(), []);

  return (event: PointerEvent<SVGPathElement>, select: () => void) => {
    if (event.button !== 0 || !event.isPrimary) return;
    tracking.current?.abort();
    const controller = new AbortController();
    tracking.current = controller;
    const options = { capture: true, signal: controller.signal };
    const { pointerId, clientX, clientY, currentTarget: path } = event;
    const { ownerDocument } = path;
    const window = ownerDocument.defaultView!;
    let dragged = false;
    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (Math.hypot(pointer.clientX - clientX, pointer.clientY - clientY) > 3) dragged = true;
    };
    const end = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      move(pointer);
      controller.abort();
      if (
        pointer.type === "pointerup" &&
        !dragged &&
        ownerDocument.elementFromPoint(pointer.clientX, pointer.clientY) === path
      )
        select();
    };
    window.addEventListener("pointermove", move, options);
    window.addEventListener("pointerup", end, options);
    window.addEventListener("pointercancel", end, options);
    window.addEventListener("blur", () => controller.abort(), { signal: controller.signal });
  };
}

function WireHitPath({
  wire,
  selection,
  press,
}: {
  wire: Wire;
  selection: WireSelection | null;
  press: ReturnType<typeof useWirePress>;
}) {
  return (
    <path
      d={wire.path.d}
      aria-hidden
      data-wire-key={wire.key}
      data-canvas-pan-through={selection ? undefined : true}
      className={cn(
        "fill-none stroke-transparent [pointer-events:stroke] [stroke-width:calc(12px/var(--canvas-scale,1))]",
        selection && "cursor-pointer",
      )}
      onPointerDown={
        selection ? (event) => press(event, () => selection.onSelect(wire.wire)) : undefined
      }
      onMouseDown={
        selection
          ? (event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.ownerSVGElement
                ?.querySelector<SVGElement>(`g[data-wire-key="${CSS.escape(wire.key)}"]`)
                ?.focus({ preventScroll: true });
            }
          : undefined
      }
    />
  );
}

function WireStrokes({
  wires,
  selection,
  selected,
  emphasized,
  previewedWire,
  marker,
}: {
  wires: readonly Wire[];
  selection: WireSelection | null;
  selected: Wire | undefined | null;
  emphasized: CanvasNode | null;
  previewedWire: string | null;
  marker: string;
}) {
  const press = useWirePress();
  const outgoing = new Set(
    wires.filter(
      (wire) =>
        wire.key === previewedWire || (emphasized !== null && leavesNode(wire.wire, emphasized)),
    ),
  );
  const resting = wires.filter((wire) => !outgoing.has(wire));
  return (
    <>
      {selection
        ? wires.map((wire) => (
            <SelectableWire
              key={wire.key}
              wire={wire}
              marker={marker}
              selected={wire === selected}
              onSelect={() => selection.onSelect(wire.wire)}
            />
          ))
        : resting.map((wire) => (
            <path
              key={wire.key}
              d={wire.path.d}
              markerEnd={`url(#${marker})`}
              className="fill-none stroke-subtle-foreground stroke-[1.4] [stroke-linecap:round] [stroke-linejoin:round]"
            />
          ))}
      {Array.from(outgoing, (wire) => (
        <EmphasizedWire key={wire.key} wire={wire} marker={marker} selected={wire === selected} />
      ))}
      {[...resting, ...outgoing].map((wire) => (
        <WireHitPath key={wire.key} wire={wire} selection={selection} press={press} />
      ))}
    </>
  );
}

const DELETE_SIZE = 28;
const DELETE_GAP = 14;

function chipObstacles(geometry: Geometry, visible: Rect, deleteAt: Point | null | undefined) {
  const margin = 6;
  const boxes = geometry.boxes().filter((box) => reaches(visible, box, margin));
  if (deleteAt) {
    boxes.push({
      x: deleteAt.x - DELETE_SIZE / 2,
      y: deleteAt.y - DELETE_GAP - DELETE_SIZE,
      width: DELETE_SIZE,
      height: DELETE_SIZE,
    });
  }
  return boxes.map(({ x, y, width, height }) => ({
    x: x - margin,
    y: y - margin,
    width: width + 2 * margin,
    height: height + 2 * margin,
  }));
}

function renderWireLabel(
  wire: Wire | null | undefined,
  geometry: Geometry,
  visible: Rect,
  scale: number,
  deleteAt: Point | null | undefined,
) {
  if (!wire?.chip) return null;
  return (
    <WireLabelChip
      key={wire.key}
      label={wire.chip}
      route={wire.path}
      scale={scale}
      visible={visible}
      obstacles={chipObstacles(geometry, visible, deleteAt)}
    />
  );
}

function WireOverlays({
  selected,
  previewedWire,
  emphasized,
  wires,
  geometry,
  visible,
  scale,
  selection,
}: {
  selected: Wire | null | undefined;
  previewedWire: string | null;
  emphasized: CanvasNode | null;
  wires: readonly Wire[];
  geometry: Geometry;
  visible: Rect;
  scale: number;
  selection: WireSelection | null;
}) {
  const previewed = wires.find((wire) => wire.key === previewedWire);
  const previewing = emphasized !== null || previewedWire !== null;
  const deleteAt = selected?.path.label;
  return (
    <>
      {renderWireLabel(previewed, geometry, visible, scale, deleteAt)}
      {!previewing && renderWireLabel(selected, geometry, visible, scale, deleteAt)}
      {selected && deleteAt && (
        <DeleteConnection at={deleteAt} onDelete={() => selection?.onDelete(selected.wire)} />
      )}
    </>
  );
}

const MARKER_BY_KIND = { curved: "arrow", orthogonal: "execution-arrow" } as const;

export function FlowWires({
  graph,
  geometry,
  presentation,
  routes,
  pendingWire,
  emphasized,
  previewedWire,
  finish,
  area,
  visible,
  scale,
  nested,
}: {
  graph: CanvasGraph;
  geometry: Geometry;
  presentation: WirePresentation;
  finish: boolean;
  /** ELK orthogonal paths keyed like `flow-input:<id>` or `<source>:<exit>:<target>`. */
  routes: ReadonlyMap<string, WireRoute> | null;
  /** Rendered separately by the drag preview, but reserves its incoming port. */
  pendingWire: FlowWire | null;
  emphasized: CanvasNode | null;
  previewedWire: string | null;
  area: Rect | null;
  visible: Rect;
  scale: number;
  nested?: boolean;
}) {
  const selection = presentation.kind === "curved" ? presentation : null;
  const marker = MARKER_BY_KIND[presentation.kind];
  const current = selection?.selected ?? null;
  const [focused, setFocused] = useState<string | null>(null);
  const { inputs, connections, wires } = useVisibleWires({
    graph,
    kind: presentation.kind,
    geometry,
    routed: routes ?? undefined,
    finish,
    pendingWire,
    area,
    current,
    focused,
    nested,
  });
  const selected = current && wires.find((wire) => sameWire(wire.wire, current));
  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        // An image's children are presentational, so selectable wires sit in a group instead.
        role={selection ? "group" : "img"}
        aria-label={presentation.label}
        data-connection-count={connections.length}
        data-flow-input-count={inputs.length}
        onFocus={(event) => setFocused(wireKeyOf(event.target))}
        onBlur={(event) => setFocused(wireKeyOf(event.relatedTarget))}
      >
        <WireMarkers selection={selection !== null} marker={marker} />
        <WireStrokes
          wires={wires}
          selection={selection}
          selected={selected}
          emphasized={emphasized}
          previewedWire={previewedWire}
          marker={marker}
        />
      </svg>
      <WireOverlays
        selected={selected}
        previewedWire={previewedWire}
        emphasized={emphasized}
        wires={wires}
        geometry={geometry}
        visible={visible}
        scale={scale}
        selection={selection}
      />
    </>
  );
}

function SelectableWire({
  wire,
  marker,
  selected,
  onSelect,
}: {
  wire: Wire;
  marker: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      data-wire-key={wire.key}
      aria-label={
        wire.exit === null
          ? `Connection from ${wire.source} to ${wire.target}`
          : `Connection ${wire.exit} from ${wire.source} to ${wire.target}`
      }
      aria-pressed={selected}
      className="group/wire cursor-pointer outline-none"
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
    >
      <path
        d={wire.path.d}
        className="fill-none stroke-ring/50 stroke-[6] opacity-0 group-focus-visible/wire:opacity-100"
      />
      <path
        d={wire.path.d}
        markerEnd={`url(#${selected ? "arrow-selected" : marker})`}
        className={cn(
          "fill-none stroke-muted-foreground stroke-[1.5]",
          selected && "stroke-primary stroke-[2]",
        )}
      />
    </g>
  );
}

/** The selected wire's delete action, floating just above its label. */
function DeleteConnection({
  at,
  onDelete,
}: {
  at: { x: number; y: number };
  onDelete: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Delete connection"
          className="absolute z-5 -translate-x-1/2 -translate-y-full text-destructive shadow-panel hover:text-destructive"
          style={{ left: at.x, top: at.y - DELETE_GAP, width: DELETE_SIZE, height: DELETE_SIZE }}
          onClick={onDelete}
        >
          <Trash2 aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent shortcut={formatShortcut(fixedShortcuts.deleteConnection)}>
        Delete connection
      </TooltipContent>
    </Tooltip>
  );
}

/** The connection being drawn from an exit port, in the same coordinate space as `FlowWires`. */
export function ConnectionPreview({
  from,
  to,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
}) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <defs>
        <marker id="connect-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L0,6 L7,3 z" className="fill-primary" />
        </marker>
      </defs>
      <path
        d={wirePath(from, to).d}
        markerEnd="url(#connect-arrow)"
        className="fill-none stroke-primary stroke-[1.5] [stroke-dasharray:5_4]"
      />
    </svg>
  );
}
