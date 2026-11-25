import type { ReactNode } from "react";
import type { FlowGraph } from "@agent-easel/contracts";
import { joinSlots } from "@agent-easel/domain-validation";

export type JoinSource = {
  readonly sourceBlockId: string;
  readonly name: string;
  readonly exits: number;
};

export function joinSources(
  graph: Pick<FlowGraph, "blocks" | "connections">,
  joinBlockId: string,
): JoinSource[] {
  const names = new Map(graph.blocks.map((block) => [block.id, block.name]));
  return joinSlots(graph, joinBlockId).map((slot) => ({
    sourceBlockId: slot.sourceBlockId,
    name: names.get(slot.sourceBlockId) || "Unnamed block",
    exits: slot.exitIds.length,
  }));
}

export function joinSummary(sources: number) {
  return `Join · ${sources === 1 ? "1 source" : `${sources} sources`}`;
}

export function joinExitCount(source: JoinSource) {
  return source.exits === 1 ? "1 exit" : `${source.exits} exits`;
}

export function JoinSourceList({
  sources,
  detail,
  rows,
  renderPort,
}: {
  sources: readonly JoinSource[];
  detail: (source: JoinSource, slot: number) => string;
  rows: {
    readonly divider: number;
    readonly exitPaddingTop: number;
    readonly exitPaddingBottom: number;
    readonly exitRow: number;
  };
  renderPort?: (index: number) => ReactNode;
}) {
  return (
    <>
      <span className="bg-border" style={{ height: rows.divider }} />
      <ul
        aria-label="Sources"
        style={{ paddingTop: rows.exitPaddingTop, paddingBottom: rows.exitPaddingBottom }}
      >
        {sources.length === 0 && (
          <li className="relative flex items-center px-3" style={{ height: rows.exitRow }}>
            <span className="truncate text-xs font-medium text-muted-foreground">
              Connect the blocks to wait for
            </span>
            {renderPort?.(0)}
          </li>
        )}
        {sources.map((source, index) => (
          <li
            key={source.sourceBlockId}
            className="relative flex items-center gap-1.5 pr-3.5 pl-3"
            style={{ height: rows.exitRow }}
          >
            <span className="truncate text-xs font-medium text-foreground">{source.name}</span>
            <span className="flex-1" />
            <span className="shrink-0 text-2xs tracking-label text-muted-foreground">
              {detail(source, index)}
            </span>
            {renderPort?.(index)}
          </li>
        ))}
      </ul>
    </>
  );
}
