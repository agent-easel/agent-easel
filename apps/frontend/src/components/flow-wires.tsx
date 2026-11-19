import { Trash2 } from "lucide-react";
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
  sameWire,
  type CanvasBlock,
  type CanvasGraph,
  type FlowWire,
} from "../flow-graph.ts";
import { type WireRoute } from "../flow-layout-elk.ts";

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

/** A wire from `from` into the target's input port, as the presentation draws it. */
function routedPath(
  kind: WirePresentation["kind"],
  geometry: Geometry,
  from: { x: number; y: number },
  fromBottom: number,
  target: CanvasBlock,
  incomingIndex: number,
) {
  const input = geometry.inputPoint(target, incomingIndex);
  if (kind === "curved") return wirePath(from, input, incomingApproachLane(incomingIndex));
  const below = Math.max(fromBottom, target.position.y + geometry.blockHeight(target)) + 24;
  return {
    d: orthogonalWirePath(from, input, below, incomingApproachLane(incomingIndex)),
    label: null,
  };
}

type Wire = {
  readonly key: string;
  readonly wire: FlowWire;
  readonly path: { d: string; label: { x: number; y: number } | null };
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

/** Every connection's wire, in graph order; a wire whose source or target is missing is not drawn. */
export function exitWires(
  graph: CanvasGraph,
  kind: WirePresentation["kind"],
  geometry: Geometry,
  routes: ReadonlyMap<string, WireRoute> | undefined,
): Wire[] {
  const blocks = blocksById(graph);
  return graph.connections.flatMap((connection): Wire[] => {
    const source = blocks.get(connection.sourceBlockId);
    const target = blocks.get(connection.targetBlockId);
    if (!source || !target) return [];
    const wire = connectionWire(connection);
    const key = wireRouteKey(wire.source, connection.targetBlockId);
    const routed = routes?.get(key);
    const from = geometry.exitPoint(source, connection.exitId);
    const fromBottom = source.position.y + geometry.blockHeight(source);
    const incomingIndex = geometry.incomingPortIndex(connection.targetBlockId, wire.source);
    return [
      {
        key,
        wire,
        path: routed ?? routedPath(kind, geometry, from, fromBottom, target, incomingIndex),
        exit:
          source.kind === "continuation"
            ? null
            : geometry.exit(source, connection.exitId)?.name || "exit",
        source: source.name || "Unnamed block",
        target: target.name || "Unnamed block",
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
        path: routed ?? routedPath(kind, geometry, from, from.y, target, incomingIndex),
        exit: null,
        source: "Flow input",
        target: target.name || "Unnamed block",
      },
    ];
  });
}

/**
 * Configured connections and the Flow input's wires in one neutral style, without labels.
 * Curved wires are selectable, and the selected one offers a delete action at its midpoint.
 */
export function FlowWires({
  graph,
  geometry,
  presentation,
  routes,
  pendingWire,
}: {
  graph: CanvasGraph;
  geometry: Geometry;
  presentation: WirePresentation;
  /** ELK orthogonal paths keyed like `flow-input:<id>` or `<source>:<exit>:<target>`. */
  routes: ReadonlyMap<string, WireRoute> | null;
  /** Rendered separately by the drag preview, but reserves its incoming port. */
  pendingWire: FlowWire | null;
}) {
  const routed = routes ?? undefined;
  const { kind } = presentation;
  const visible = (item: { wire: FlowWire }) => !pendingWire || !sameWire(item.wire, pendingWire);
  const connections = exitWires(graph, kind, geometry, routed).filter(visible);
  const inputs = flowInputWires(graph, kind, geometry, routed).filter(visible);
  const wires = [...inputs, ...connections];
  const selection = presentation.kind === "curved" ? presentation : null;
  const marker = selection ? "arrow" : "execution-arrow";
  const current = selection?.selected;
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
      >
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
          )}
        </defs>
        {wires.map((wire) =>
          selection ? (
            <SelectableWire
              key={wire.key}
              wire={wire}
              marker={marker}
              selected={wire === selected}
              onSelect={() => selection.onSelect(wire.wire)}
            />
          ) : (
            <path
              key={wire.key}
              d={wire.path.d}
              markerEnd={`url(#${marker})`}
              className="fill-none stroke-subtle-foreground stroke-[1.4] [stroke-linecap:round] [stroke-linejoin:round]"
            />
          ),
        )}
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
