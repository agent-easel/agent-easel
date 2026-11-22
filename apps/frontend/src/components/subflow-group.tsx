import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Workflow } from "lucide-react";
import type { AgentDefinition, FlowBlock, FlowDraft } from "@t3-factory/contracts";
import type { CanvasBlock, CanvasDimensions } from "@t3-factory/flow-layout";
import { cn } from "@/lib/utils";
import { TextLink } from "@/components/ui/text-link";
import { JoinSourceList, joinExitCount, joinSources } from "./join-block.tsx";
import { blockReference, type ReferenceTone } from "../block-kind.ts";
import { incomingApproachLane, wirePath, type createCanvasGeometry } from "../flow-geometry.ts";
import {
  SUBFLOW_HEADER_HEIGHT,
  type SubflowCollapseReason,
  type SubflowPreview,
  type CanvasFlow,
} from "../subflow-preview.ts";
import { StudioLink } from "./app-link.tsx";
import { FinishEndingList, finishIdentity, finishShowsRows } from "./finish-block.tsx";
import {
  blockIdentity,
  conditionRoutes,
  exitDisplayName,
  flowInputIdentity,
  IdentityRows,
} from "./flow-block.tsx";
import { StatusBadge } from "./status-badge.tsx";

type Geometry = ReturnType<typeof createCanvasGeometry>;

const REFERENCE_TONES: Record<ReferenceTone, string> = {
  plain: "text-emphasis-foreground",
  continued: "text-brand-cyan",
  absent: "text-muted-foreground",
};

const emptyUnconnected = new Set<string>();

function PreviewFlowInputCard({
  preview,
  dimensions,
}: {
  preview: SubflowPreview;
  dimensions: CanvasDimensions;
}) {
  const { innerGeometry, offsetX, offsetY } = preview;
  const input = dimensions.flowInput;
  const box = innerGeometry.flowInputBox;
  const identity = flowInputIdentity(null, "Incoming message");
  return (
    <div
      data-preview-flow-input
      className="absolute flex flex-col rounded-lg border-brand-soft-border bg-card"
      style={{
        left: offsetX + box.x,
        top: offsetY + box.y,
        width: input.width,
        borderWidth: input.border,
      }}
    >
      <IdentityRows rows={input} header={identity.header} title={identity.title} />
    </div>
  );
}

function PreviewFinishCard({
  preview,
  dimensions,
}: {
  preview: SubflowPreview;
  dimensions: CanvasDimensions;
}) {
  const { innerGraph, innerGeometry, offsetX, offsetY } = preview;
  const rows = dimensions.block;
  const box = innerGeometry.finishBox;
  if (!box || !innerGraph.finish) return null;
  const { endings } = innerGraph.finish;
  const state = { kind: "authoring" as const, unconnected: emptyUnconnected };
  const identity = finishIdentity(state, endings.length);
  return (
    <div
      data-preview-finish
      className="absolute flex flex-col rounded-lg border bg-card"
      style={{
        left: offsetX + box.x,
        top: offsetY + box.y,
        width: rows.width,
        borderWidth: rows.border,
      }}
    >
      <IdentityRows
        rows={{ header: rows.header, title: dimensions.finish.title }}
        header={identity.header}
        title={identity.title}
      />
      {finishShowsRows(state, endings.length) && (
        <FinishEndingList endings={endings} state={state} rows={rows} />
      )}
    </div>
  );
}

function PreviewBlockCard({
  block,
  preview,
  dimensions,
  agents,
  flows,
}: {
  block: CanvasBlock;
  preview: SubflowPreview;
  dimensions: CanvasDimensions;
  agents: readonly AgentDefinition[];
  flows: ReadonlyMap<string, CanvasFlow>;
}) {
  const nested = preview.innerPreviews.get(block.id);
  if (nested) {
    return (
      <div
        data-preview-subflow={block.id}
        className="absolute overflow-hidden rounded-lg border border-border-strong bg-muted/60"
        style={{
          left: preview.offsetX + block.position.x,
          top: preview.offsetY + block.position.y,
          width: nested.width,
          height: nested.height,
        }}
      >
        <div
          className="flex items-center gap-1.5 border-b border-border/60 px-3"
          style={{ height: SUBFLOW_HEADER_HEIGHT }}
        >
          <Workflow aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-2xs font-semibold tracking-section text-muted-foreground">
            SUBFLOW
          </span>
          <span className="truncate text-sm font-semibold text-foreground">
            {block.name || nested.childFlow.name}
          </span>
        </div>
        <SubflowPreviewBody
          preview={nested}
          dimensions={dimensions}
          agents={agents}
          flows={flows}
        />
      </div>
    );
  }
  const rows = dimensions.block;
  const reference = blockReference(block, {
    graph: preview.childFlow.graph,
    agents,
    flows,
  }).card;
  const route = conditionRoutes(block);
  const identity = blockIdentity({
    kind: block.kind,
    name: block.name || "Unnamed block",
    label: reference.label,
    value: reference.value,
    valueClassName: REFERENCE_TONES[reference.tone],
  });
  return (
    <div
      data-preview-block={block.id}
      className="absolute flex flex-col rounded-lg border bg-card"
      style={{
        left: preview.offsetX + block.position.x,
        top: preview.offsetY + block.position.y,
        width: rows.width,
        borderWidth: rows.border,
      }}
    >
      <IdentityRows rows={rows} header={identity.header} title={identity.title} />
      {block.kind === "join" && (
        <JoinSourceList
          sources={joinSources(preview.innerGraph, block.id)}
          detail={joinExitCount}
          rows={rows}
        />
      )}
      <span className="bg-border" style={{ height: rows.divider }} />
      <ul style={{ paddingTop: rows.exitPaddingTop, paddingBottom: rows.exitPaddingBottom }}>
        {block.exits.map((exit) => (
          <li
            key={exit.id}
            className="flex items-center gap-1.5 pr-3.5 pl-3"
            style={{ height: rows.exitRow }}
          >
            {exit.source === "condition" && (
              <span className="truncate text-2xs tracking-label text-muted-foreground">
                {route(exit.id)}
              </span>
            )}
            <span className="flex-1" />
            <span className="truncate text-xs text-muted-foreground">
              {exit.source === "wait"
                ? "after the wait"
                : exit.source === "continuation"
                  ? "response"
                  : exitDisplayName(exit, "output")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewWires({ preview }: { preview: SubflowPreview }) {
  const { innerGraph, innerGeometry, offsetX, offsetY, incomingEntry, inputY, endingRoutes } =
    preview;
  const blocks = new Map(innerGraph.blocks.map((block) => [block.id, block]));
  const endings = new Map(innerGraph.finish?.endings.map((ending, index) => [ending.id, index]));
  const shift = (point: { x: number; y: number }) => ({
    x: offsetX + point.x,
    y: offsetY + point.y,
  });
  const inputPaths = innerGraph.flowInput.targetBlockIds.flatMap((targetId) => {
    const target = blocks.get(targetId);
    if (!target) return [];
    const index = innerGeometry.incomingPortIndex(targetId, { kind: "flow-input" });
    return [
      {
        key: `in:${targetId}`,
        d: wirePath(
          shift(innerGeometry.flowInputPoint),
          shift(innerGeometry.inputPoint(target, index)),
          incomingApproachLane(index),
        ).d,
      },
    ];
  });
  const connectionPaths = innerGraph.connections.flatMap((connection, idx) => {
    const source = blocks.get(connection.sourceBlockId);
    if (!source) return [];
    const from = shift(innerGeometry.exitPoint(source, connection.exitId));
    if (connection.targetEndingId !== undefined) {
      const endingIndex = endings.get(connection.targetEndingId);
      if (endingIndex === undefined) return [];
      return [
        {
          key: `c:${idx}`,
          d: wirePath(from, shift(innerGeometry.endingPoint(endingIndex)), 0).d,
        },
      ];
    }
    const target = blocks.get(connection.targetBlockId);
    if (!target) return [];
    const index = innerGeometry.incomingPortIndex(target.id, {
      kind: "exit",
      sourceBlockId: connection.sourceBlockId,
      exitId: connection.exitId,
    });
    return [
      {
        key: `c:${idx}`,
        d: wirePath(
          from,
          shift(innerGeometry.inputPoint(target, index)),
          incomingApproachLane(index),
        ).d,
      },
    ];
  });
  const entryPath = `M0,${inputY} L${incomingEntry.x},${incomingEntry.y}`;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <path d={entryPath} className="fill-none stroke-muted-foreground/70 stroke-[1.5]" />
      {inputPaths.map((wire) => (
        <path
          key={wire.key}
          d={wire.d}
          className="fill-none stroke-muted-foreground/70 stroke-[1.5]"
        />
      ))}
      {connectionPaths.map((wire) => (
        <path
          key={wire.key}
          d={wire.d}
          className="fill-none stroke-muted-foreground/70 stroke-[1.5]"
        />
      ))}
      {endingRoutes.map((route) => (
        <path
          key={route.endingId}
          d={`M${route.from.x},${route.from.y} L${route.to.x},${route.to.y}`}
          className="fill-none stroke-primary/65 stroke-[1.5]"
        />
      ))}
    </svg>
  );
}

function SubflowPreviewBody({
  preview,
  dimensions,
  agents,
  flows,
}: {
  preview: SubflowPreview;
  dimensions: CanvasDimensions;
  agents: readonly AgentDefinition[];
  flows: ReadonlyMap<string, CanvasFlow>;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <PreviewWires preview={preview} />
      <PreviewFlowInputCard preview={preview} dimensions={dimensions} />
      <PreviewFinishCard preview={preview} dimensions={dimensions} />
      {preview.innerGraph.blocks.map((innerBlock) => (
        <PreviewBlockCard
          key={innerBlock.id}
          block={innerBlock}
          preview={preview}
          dimensions={dimensions}
          agents={agents}
          flows={flows}
        />
      ))}
    </div>
  );
}

function GroupHeader({
  name,
  label,
  press,
  badge,
  runHeader,
  onCollapse,
}: {
  name: string;
  label: string;
  press: (content: ReactNode) => ReactNode;
  badge: ReactNode;
  runHeader: { readonly visible: boolean; readonly evidence: ReactNode } | undefined;
  onCollapse: () => void;
}) {
  if (runHeader && !runHeader.visible) return null;
  return (
    <div
      className="relative z-[1] flex items-center gap-2 border-b border-border/60 pr-2"
      style={{ height: SUBFLOW_HEADER_HEIGHT }}
    >
      <div className={cn("min-w-0", runHeader ? "max-w-80" : "flex-1")}>
        {press(
          <span className="flex h-full items-center gap-1.5 pl-3">
            <Workflow aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="text-2xs font-semibold tracking-section text-muted-foreground">
              SUBFLOW
            </span>
            <span className="truncate text-sm font-semibold text-foreground">{label}</span>
            {badge}
          </span>,
        )}
      </div>
      {runHeader?.evidence}
      <button
        type="button"
        aria-label={`Collapse ${name}`}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-ring"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onCollapse();
        }}
      >
        Collapse
        <ChevronUp aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

export function SubflowGroup({
  block,
  preview,
  geometry,
  dimensions,
  agents,
  flows,
  frameClassName,
  border,
  headerPress,
  trailingBadge,
  runHeader,
  onCollapse,
  renderPort,
  incomingPorts,
  exitPorts,
}: {
  block: CanvasBlock;
  preview: SubflowPreview;
  geometry: Geometry;
  dimensions: CanvasDimensions;
  agents: readonly AgentDefinition[];
  flows: ReadonlyMap<string, CanvasFlow>;
  frameClassName: string;
  border: number;
  headerPress: (content: ReactNode) => ReactNode;
  trailingBadge?: ReactNode;
  runHeader?: { readonly visible: boolean; readonly evidence: ReactNode } | undefined;
  onCollapse: () => void;
  renderPort: (props: {
    key: string;
    side: "left" | "right";
    center: number;
    border: number;
    graphY?: number;
  }) => ReactNode;
  incomingPorts: readonly { readonly key: string; readonly graphY: number }[];
  exitPorts: readonly {
    readonly exit: CanvasBlock["exits"][number];
    readonly y: number;
  }[];
}) {
  const name = block.name || preview.childFlow.name;
  const headerLabel =
    block.name && block.name !== preview.childFlow.name
      ? `${block.name} · ${preview.childFlow.name}`
      : preview.childFlow.name;
  return (
    <article
      aria-label={`Subflow ${name}`}
      data-block-id={block.id}
      data-subflow-group="expanded"
      className={cn("absolute rounded-lg border-border-strong bg-muted/50", frameClassName)}
      style={{
        left: block.position.x,
        top: block.position.y,
        width: preview.width,
        height: geometry.blockHeight(block),
        borderWidth: border,
      }}
    >
      <GroupHeader
        name={name}
        label={headerLabel}
        press={headerPress}
        badge={trailingBadge}
        runHeader={runHeader}
        onCollapse={onCollapse}
      />
      {!runHeader && (
        <SubflowPreviewBody
          preview={preview}
          dimensions={dimensions}
          agents={agents}
          flows={flows}
        />
      )}
      {exitPorts.map(({ exit, y }) => (
        <div
          key={`broken-${exit.id}`}
          className="pointer-events-none absolute right-2.5 flex items-center"
          style={{ top: y - 10, height: 20 } satisfies CSSProperties}
        >
          {exit.unavailable && (
            <span className="rounded bg-card/90 px-1 text-2xs text-attention line-through">
              {exitDisplayName(exit)}
            </span>
          )}
        </div>
      ))}
      {incomingPorts.map(({ key, graphY }) =>
        renderPort({
          key,
          side: "left",
          center: graphY - border,
          border,
          graphY,
        }),
      )}
      {exitPorts.map(({ exit, y }) =>
        renderPort({
          key: `exit:${exit.id}`,
          side: "right",
          center: y - border,
          border,
        }),
      )}
      <span className="sr-only">
        {geometry.incomingPorts(block).length} incoming, {block.exits.length} exits
      </span>
    </article>
  );
}

const COLLAPSE_BADGES: Record<SubflowCollapseReason, string> = {
  cycle: "Loop",
  budget: "Over limit",
  missing: "Missing Flow",
  unset: "No Flow",
};

export function SubflowCollapsedFooter({
  block,
  childFlow,
  reason,
  onExpand,
}: {
  block: Extract<FlowBlock, { kind: "subflow" }>;
  childFlow: FlowDraft | undefined;
  reason: SubflowCollapseReason | undefined;
  onExpand?: (() => void) | undefined;
}) {
  const name = block.name || childFlow?.name || "Subflow";
  const badge = reason ? COLLAPSE_BADGES[reason] : null;
  return (
    <div
      className="flex items-center gap-2 border-t px-3 py-1.5 text-xs"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {badge ? (
        <StatusBadge kind="error" className="max-w-full truncate">
          {badge}
        </StatusBadge>
      ) : (
        onExpand && (
          <button
            type="button"
            aria-label={`Expand ${name}`}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-ring"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
          >
            Expand
            <ChevronDown aria-hidden className="size-3.5" />
          </button>
        )
      )}
      {childFlow && (
        <TextLink asChild trailingIcon={ExternalLink} className="ml-auto shrink-0 text-xs">
          <StudioLink selection={{ tab: "flows", flowId: childFlow.id }}>Open Flow</StudioLink>
        </TextLink>
      )}
    </div>
  );
}
