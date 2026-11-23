import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { FlowConnection } from "@t3-factory/contracts";
import { wireRouteKey } from "@t3-factory/flow-layout";
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
import { wireReaches, type Rect } from "../canvas-culling.ts";

/** Selecting and deleting a wire. */
type WireSelection = {
  readonly selected: FlowWire | null;
  readonly onSelect: (wire: FlowWire) => void;
  readonly onDelete: (wire: FlowWire) => void;
};

/**
 * How a canvas presents its wires: curved and selectable, or orthogonal. Neither draws labels;
 * `label` names the wires for assistive technology.
 */
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
    const from = geometry.exitPoint(source, connection.exitId);
    const fromBottom = source.position.y + geometry.blockHeight(source);
    return [
      {
        key,
        wire,
        path: routed ?? routedPath(kind, from, fromBottom, target),
        exit:
          source.kind === "continuation"
            ? null
            : geometry.exit(source, connection.exitId)?.name || "exit",
        source: source.name || "Unnamed block",
        target: target.name,
      },
    ];
  });
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
        "fill-none stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]",
        selected
          ? "stroke-primary"
          : "stroke-foreground motion-safe:transition-[stroke,stroke-width] motion-safe:duration-75 motion-safe:starting:stroke-[1.4] motion-safe:starting:stroke-subtle-foreground",
      )}
    />
  );
}

function WireStrokes({
  wires,
  selection,
  selected,
  emphasized,
  marker,
}: {
  wires: readonly Wire[];
  selection: WireSelection | null;
  selected: Wire | undefined | null;
  emphasized: CanvasNode | null;
  marker: string;
}) {
  const outgoing = new Set(
    emphasized ? wires.filter((wire) => leavesNode(wire.wire, emphasized)) : [],
  );
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
        : wires
            .filter((wire) => !outgoing.has(wire))
            .map((wire) => (
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
    </>
  );
}

export function FlowWires({
  graph,
  geometry,
  presentation,
  routes,
  pendingWire,
  emphasized,
  finish,
  area,
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
  area: Rect | null;
  nested?: boolean;
}) {
  const selection = presentation.kind === "curved" ? presentation : null;
  const marker = selection ? "arrow" : "execution-arrow";
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
          marker={marker}
        />
      </svg>
      {selected?.path.label && (
        <DeleteConnection
          at={selected.path.label}
          onDelete={() => selection?.onDelete(selected.wire)}
        />
      )}
    </>
  );
}

/**
 * One selectable wire: a focusable button whose wide transparent stroke takes the pointer,
 * drawn over the visible wire and its focus ring.
 */
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
          "fill-none stroke-muted-foreground stroke-[1.5] transition-colors group-hover/wire:stroke-foreground",
          selected && "stroke-primary stroke-[2.5] group-hover/wire:stroke-primary",
        )}
      />
      <path
        d={wire.path.d}
        className="fill-none stroke-transparent stroke-[12] [pointer-events:stroke]"
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
          style={{ left: at.x, top: at.y - 14 }}
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
