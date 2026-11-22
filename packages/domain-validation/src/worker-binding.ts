import type { FlowBlockInput, FlowGraphInput } from "@t3-factory/contracts";

type Binding = "bound" | "unbound";
type PlacedFlows = ReadonlyMap<string, { readonly graph: FlowGraphInput }>;
interface Arrivals {
  readonly blocks: ReadonlyMap<string, ReadonlySet<Binding>>;
  readonly endings: ReadonlyMap<string, ReadonlySet<Binding>>;
}

function emitted(
  block: FlowBlockInput,
  arrived: Binding,
  exitId: string,
  endingBindings: (flowId: string, endingId: string) => ReadonlySet<Binding>,
): Iterable<Binding> {
  switch (block.kind) {
    case "agent":
    case "continuation":
      return ["bound"];
    case "join":
      return ["unbound"];
    case "subflow":
      return block.flowId === null ? [] : endingBindings(block.flowId, exitId);
    case "human":
    case "wait":
    case "condition":
      return [arrived];
  }
}

function record(into: Map<string, Set<Binding>>, key: string, binding: Binding) {
  const known = into.get(key) ?? new Set<Binding>();
  into.set(key, known);
  if (known.has(binding)) return false;
  known.add(binding);
  return true;
}

function followGraph(
  graph: FlowGraphInput,
  endingBindings: (flowId: string, endingId: string) => ReadonlySet<Binding>,
): Arrivals {
  const blocks = new Map(graph.blocks.map((block) => [block.id, block]));
  const outgoing = new Map<string, FlowGraphInput["connections"][number][]>();
  for (const edge of graph.connections) {
    const edges = outgoing.get(edge.sourceBlockId);
    if (edges) edges.push(edge);
    else outgoing.set(edge.sourceBlockId, [edge]);
  }
  const arrivals = new Map<string, Set<Binding>>();
  const endings = new Map<string, Set<Binding>>();
  const pending: [string, Binding][] = [];
  const arrive = (blockId: string, binding: Binding) => {
    if (blocks.has(blockId) && record(arrivals, blockId, binding)) pending.push([blockId, binding]);
  };
  const deliver = (edge: FlowGraphInput["connections"][number], binding: Binding) => {
    if (edge.targetEndingId === undefined) arrive(edge.targetBlockId, binding);
    else record(endings, edge.targetEndingId, binding);
  };
  for (const target of graph.flowInput.targetBlockIds) arrive(target, "bound");
  for (const [blockId, binding] of pending) {
    const block = blocks.get(blockId)!;
    for (const edge of outgoing.get(blockId) ?? [])
      for (const out of emitted(block, binding, edge.exitId, endingBindings)) deliver(edge, out);
  }
  return { blocks: arrivals, endings };
}

export function continuationsWithoutWorker(
  graph: FlowGraphInput,
  flows: PlacedFlows,
): ReadonlySet<string> {
  const memo = new Map<string, Arrivals>();
  const visiting = new Set<string>();
  const endingBindings = (flowId: string, endingId: string): ReadonlySet<Binding> => {
    const child = flows.get(flowId);
    if (!child || visiting.has(flowId)) return new Set();
    if (!memo.has(flowId)) {
      visiting.add(flowId);
      memo.set(flowId, followGraph(child.graph, endingBindings));
      visiting.delete(flowId);
    }
    return memo.get(flowId)!.endings.get(endingId) ?? new Set();
  };
  const { blocks } = followGraph(graph, endingBindings);
  return new Set(
    graph.blocks.flatMap((block) =>
      block.kind === "continuation" && blocks.get(block.id)?.has("unbound") ? [block.id] : [],
    ),
  );
}
