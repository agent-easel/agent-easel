import type { FlowGraphInput } from "@agent-easel/contracts";

export interface JoinSlot {
  readonly sourceBlockId: string;
  readonly label: string;
  readonly exitIds: readonly string[];
}

export function joinSlots(
  graph: Pick<FlowGraphInput, "blocks" | "connections">,
  joinBlockId: string,
): JoinSlot[] {
  const exitsBySource = new Map<string, string[]>();
  for (const edge of graph.connections) {
    if (edge.targetEndingId !== undefined || edge.targetBlockId !== joinBlockId) continue;
    const exits = exitsBySource.get(edge.sourceBlockId) ?? [];
    if (!exits.includes(edge.exitId)) exits.push(edge.exitId);
    exitsBySource.set(edge.sourceBlockId, exits);
  }
  return graph.blocks.flatMap((block) => {
    const exitIds = exitsBySource.get(block.id);
    return exitIds ? [{ sourceBlockId: block.id, label: block.name || block.id, exitIds }] : [];
  });
}
