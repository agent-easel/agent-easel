import {
  READINESS_FINDINGS_PER_CODE,
  SUBFLOW_CAPTURE_BYTES_LIMIT,
  SUBFLOW_EXPANDED_BLOCKS_LIMIT,
  SUBFLOW_EXPANDED_CONNECTIONS_LIMIT,
  type AgentRevisionContent,
  type FlowBlockInput,
  type FlowClosure,
  type FlowClosureDefinition,
  type FlowGraphInput,
  type FlowReadiness,
  type PlacementSegment,
  type ReadinessIssue,
  type SubflowBudgetClass,
  type SubflowBudgetContributor,
  type SubflowBudgetEvidence,
  type SubflowBudgetSubtotals,
} from "@agent-easel/contracts";
import {
  blockLabel,
  flowReadiness,
  type ReadinessAgent,
  type ReadinessFlow,
  type ReadinessFlows,
} from "./readiness.ts";

export interface CompositionDefinitions {
  readonly agents: readonly ReadinessAgent[];
  readonly flows: ReadinessFlows;
  readonly agentBytes: (agentId: string) => number;
}

export interface CompositionReadiness {
  readonly readiness: FlowReadiness;
  readonly omitted: readonly ReadinessIssue[];
  readonly binding: string;
}

const FIRST_CODES: ReadonlySet<string> = new Set(["subflow_flow_missing", "subflow_cycle"]);
const CONTRIBUTOR_LIMIT = 10;
const PATH_TEXT_LIMIT_BYTES = 1024;

const placesSubflow = (graph: FlowGraphInput) =>
  graph.blocks.some((block) => block.kind === "subflow");

function reconstructCyclePath(
  previous: ReadonlyMap<string, string>,
  currentId: string,
  rootFlowId: string,
): readonly string[] {
  const path = [rootFlowId];
  let step: string | undefined = currentId;
  while (step !== undefined) {
    path.unshift(step);
    step = previous.get(step);
  }
  return path;
}

function subflowTargets(
  flows: ReadonlyMap<string, { readonly graph: Pick<FlowGraphInput, "blocks"> }>,
  flowId: string,
): readonly string[] {
  const current = flows.get(flowId);
  if (!current) return [];
  return current.graph.blocks.flatMap((block) =>
    block.kind === "subflow" && block.flowId !== null ? [block.flowId] : [],
  );
}

export function subflowCyclePath(
  rootFlowId: string,
  candidateFlowId: string,
  flows: ReadonlyMap<string, { readonly graph: Pick<FlowGraphInput, "blocks"> }>,
): readonly string[] | null {
  if (candidateFlowId === rootFlowId) return [rootFlowId];
  const previous = new Map<string, string>();
  const queue = [candidateFlowId];
  const visited = new Set<string>([candidateFlowId]);
  for (let at = 0; at < queue.length; at++) {
    const currentId = queue[at]!;
    for (const targetId of subflowTargets(flows, currentId)) {
      if (targetId === rootFlowId) return reconstructCyclePath(previous, currentId, rootFlowId);
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      previous.set(targetId, currentId);
      queue.push(targetId);
    }
  }
  return null;
}

export function compositionReadiness(
  root: ReadinessFlow,
  definitions: CompositionDefinitions,
): CompositionReadiness {
  const own = flowReadiness(root.graph, definitions.agents, root.projectId, definitions.flows);
  if (!placesSubflow(root.graph)) return { readiness: own, omitted: [], binding: "" };
  const closure = traverse(root, definitions.flows);
  const nested = closure.order
    .slice(1)
    .flatMap((flow) =>
      flowReadiness(flow.graph, definitions.agents, flow.projectId, definitions.flows).issues.map(
        (issue) => nestedIssue(closure, flow, issue),
      ),
    );
  const cycles = closure.cycles.map((cycle) => cycleIssue(closure, cycle));
  const found = [...own.issues, ...cycles, ...nested];
  const first = found.filter((issue) => FIRST_CODES.has(issue.code));
  const stamped = closureOf(closure, definitions);
  const budgets = first.length || stamped.missing.length ? [] : budgetIssues(closure, definitions);
  const findings = [...first, ...found.filter((issue) => !FIRST_CODES.has(issue.code)), ...budgets];
  const binding = `${stamped.stamp}.${fingerprint(canonicalJson(flowBody(root)))}`;
  const { shown, omitted } = boundedFindings(findings);
  return {
    readiness: {
      ready: findings.length === 0,
      issues: shown,
      closure: stamped,
      ...(omitted.length
        ? { omitted: omittedCounts(omitted), cursor: findingsCursor(binding, 0) }
        : {}),
    },
    omitted,
    binding,
  };
}

export function findingsPage(
  composition: CompositionReadiness,
  cursor: string,
  size: number,
): { readonly issues: readonly ReadinessIssue[]; readonly cursor?: string } | undefined {
  const match = /^v1\.([^.]+\.[^.]+)\.(\d+)$/.exec(cursor);
  if (!match || match[1] !== composition.binding || !composition.binding) return undefined;
  const after = Number(match[2]);
  const issues = composition.omitted.slice(after, after + size);
  const next = after + issues.length;
  return {
    issues,
    ...(next < composition.omitted.length
      ? { cursor: findingsCursor(composition.binding, next) }
      : {}),
  };
}

const findingsCursor = (binding: string, after: number) => `v1.${binding}.${after}`;

function boundedFindings(findings: readonly ReadinessIssue[]) {
  const seen = new Map<string, number>();
  const shown: ReadinessIssue[] = [];
  const omitted: ReadinessIssue[] = [];
  for (const finding of findings) {
    const count = (seen.get(finding.code) ?? 0) + 1;
    seen.set(finding.code, count);
    (count <= READINESS_FINDINGS_PER_CODE ? shown : omitted).push(finding);
  }
  return { shown, omitted };
}

function omittedCounts(omitted: readonly ReadinessIssue[]) {
  const counts = new Map<string, number>();
  for (const finding of omitted) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
  return [...counts].map(([code, count]) => ({ code, count }));
}

interface Cycle {
  readonly flow: ReadinessFlow;
  readonly blockIndex: number;
  readonly loop: readonly ReadinessFlow[];
}

interface Closure {
  readonly root: ReadinessFlow;
  readonly order: readonly ReadinessFlow[];
  readonly resolve: (flowId: string | null) => ReadinessFlow | undefined;
  readonly cycles: readonly Cycle[];
  readonly paths: ReadonlyMap<string, readonly PlacementSegment[]>;
}

const subflowBlocks = (flow: ReadinessFlow) =>
  flow.graph.blocks.flatMap((block, index) =>
    block.kind === "subflow" && block.flowId !== null
      ? [{ block, index, flowId: block.flowId }]
      : [],
  );

function traverse(root: ReadinessFlow, flows: ReadinessFlows): Closure {
  const resolve = (flowId: string | null) =>
    flowId === null ? undefined : flowId === root.id ? root : flows.get(flowId);
  const order: ReadinessFlow[] = [root];
  const cycles: Cycle[] = [];
  const state = new Map<string, "active" | "done">([[root.id, "active"]]);
  const stack = [{ flow: root, next: subflowBlocks(root), at: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    const placement = top.next[top.at++];
    if (!placement) {
      state.set(top.flow.id, "done");
      stack.pop();
      continue;
    }
    const child = resolve(placement.flowId);
    if (!child) continue;
    const seen = state.get(child.id);
    if (seen === "active") {
      const from = stack.findIndex((entry) => entry.flow.id === child.id);
      const loop = stack.slice(from).map((entry) => entry.flow);
      cycles.push({ flow: top.flow, blockIndex: placement.index, loop });
    } else if (seen === undefined) {
      state.set(child.id, "active");
      order.push(child);
      stack.push({ flow: child, next: subflowBlocks(child), at: 0 });
    }
  }
  return { root, order, resolve, cycles, paths: shortestPaths(root, resolve) };
}

function comparePaths(a: readonly PlacementSegment[], b: readonly PlacementSegment[]) {
  if (a.length !== b.length) return a.length - b.length;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.blockId !== right.blockId) return left.blockId < right.blockId ? -1 : 1;
    if (left.flowId !== right.flowId) return left.flowId < right.flowId ? -1 : 1;
  }
  return 0;
}

function expandFrontier(
  frontier: readonly ReadinessFlow[],
  paths: ReadonlyMap<string, readonly PlacementSegment[]>,
  resolve: (flowId: string | null) => ReadinessFlow | undefined,
) {
  const candidates = new Map<string, { flow: ReadinessFlow; path: PlacementSegment[] }>();
  for (const flow of frontier)
    for (const { block, flowId } of subflowBlocks(flow)) {
      const child = resolve(flowId);
      if (!child || paths.has(child.id)) continue;
      const path = [...paths.get(flow.id)!, { flowId: flow.id, blockId: block.id }];
      const known = candidates.get(child.id);
      if (!known || comparePaths(path, known.path) < 0)
        candidates.set(child.id, { flow: child, path });
    }
  return candidates;
}

function shortestPaths(
  root: ReadinessFlow,
  resolve: (flowId: string | null) => ReadinessFlow | undefined,
): Map<string, readonly PlacementSegment[]> {
  const paths = new Map<string, readonly PlacementSegment[]>([[root.id, []]]);
  let frontier: readonly ReadinessFlow[] = [root];
  while (frontier.length) {
    const candidates = expandFrontier(frontier, paths, resolve);
    for (const [id, { path }] of candidates) paths.set(id, path);
    frontier = [...candidates.values()].map((candidate) => candidate.flow);
  }
  return paths;
}

function pathText(closure: Closure, path: readonly PlacementSegment[]): string {
  const names = path.map((segment) => {
    const block = closure
      .resolve(segment.flowId)
      ?.graph.blocks.find((b) => b.id === segment.blockId);
    return block ? blockLabel(block) : segment.blockId;
  });
  const shown = names.length > 4 ? [...names.slice(0, 2), "…", ...names.slice(-2)] : names;
  return withinBytes(shown.join(" › "), PATH_TEXT_LIMIT_BYTES);
}

function withinBytes(text: string, limit: number): string {
  if (utf8Length(text) <= limit) return text;
  let kept = "";
  for (const character of text) {
    if (utf8Length(kept + character) > limit - 3) break;
    kept += character;
  }
  return `${kept}…`;
}

function nestedIssue(
  closure: Closure,
  flow: ReadinessFlow,
  issue: { readonly code: string; readonly path: string; readonly message: string },
): ReadinessIssue {
  const placements = closure.paths.get(flow.id)!;
  return {
    code: issue.code,
    path: rootBlockPath(closure, placements),
    message: `${pathText(closure, placements)}: ${issue.message}`,
    nested: { placements, flowId: flow.id, revision: flow.revision, path: issue.path },
  };
}

function rootBlockPath(closure: Closure, placements: readonly PlacementSegment[]) {
  const first = placements[0]!;
  return `graph.blocks.${closure.root.graph.blocks.findIndex((block) => block.id === first.blockId)}`;
}

function cycleIssue(closure: Closure, cycle: Cycle): ReadinessIssue {
  const block = cycle.flow.graph.blocks[cycle.blockIndex]!;
  const path = `graph.blocks.${cycle.blockIndex}.flowId`;
  const loop = [...cycle.loop, cycle.loop[0]!].map((flow) => flow.name).join(" → ");
  const message = `${blockLabel(block)} places ${cycle.loop[0]!.name}, which already contains it (${loop}). Remove the reference to break the loop.`;
  if (cycle.flow.id === closure.root.id) return { code: "subflow_cycle", path, message };
  return nestedIssue(closure, cycle.flow, { code: "subflow_cycle", path, message });
}

function closureOf(closure: Closure, definitions: CompositionDefinitions): FlowClosure {
  const agents = new Map(definitions.agents.map((agent) => [agent.id, agent]));
  const entries = new Map<string, FlowClosureDefinition>();
  const missing = new Map<string, { kind: "flow" | "agent"; id: string }>();
  for (const flow of closure.order) {
    entries.set(`flow:${flow.id}`, {
      kind: "flow",
      id: flow.id,
      revision: flow.revision,
      projectId: flow.projectId,
    });
    for (const block of flow.graph.blocks) {
      if (block.kind === "subflow" && block.flowId !== null && !closure.resolve(block.flowId))
        missing.set(`flow:${block.flowId}`, { kind: "flow", id: block.flowId });
      if (block.kind !== "agent" || block.agentId === null) continue;
      const agent = agents.get(block.agentId);
      if (agent)
        entries.set(`agent:${agent.id}`, {
          kind: "agent",
          id: agent.id,
          revision: agent.revision,
          projectId: agent.projectId,
        });
      else missing.set(`agent:${block.agentId}`, { kind: "agent", id: block.agentId });
    }
  }
  const sorted = <A>(map: ReadonlyMap<string, A>) =>
    [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, value]) => value);
  const stamped = { definitions: sorted(entries), missing: sorted(missing) };
  return { stamp: fingerprint(JSON.stringify(stamped)), ...stamped };
}

function fingerprint(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const ORIGIN = { x: 0, y: 0 };

function flowBody(flow: ReadinessFlow) {
  const graph = flow.graph;
  return {
    name: flow.name,
    workspace: flow.workspace,
    graph: {
      flowInput: {
        position: graph.flowInput.position ?? ORIGIN,
        targetBlockIds: graph.flowInput.targetBlockIds,
      },
      blocks: graph.blocks.map(savedBlock),
      connections: graph.connections,
      ...(graph.finish && {
        finish: { position: graph.finish.position ?? ORIGIN, endings: graph.finish.endings },
      }),
    },
  };
}

function savedBlock(block: FlowBlockInput) {
  const position = block.position ?? ORIGIN;
  if (block.kind !== "agent") return { ...block, position };
  return {
    ...block,
    position,
    revisitInstruction: block.revisitInstruction ?? "",
    revisitContext: block.revisitContext ?? "keep",
  };
}

export function agentCaptureBytes(agent: AgentRevisionContent): number {
  return utf8Length(
    canonicalJson({
      name: agent.name,
      prompt: agent.prompt,
      execution: agent.execution,
      exits: agent.exits,
      projectOverrides: agent.projectOverrides,
    }),
  );
}

type Depth = keyof SubflowBudgetSubtotals;
const depthOf = (segments: number): Depth =>
  segments === 0 ? "root" : segments === 1 ? "direct" : "deeper";

interface Counted {
  readonly kind: SubflowBudgetClass;
  readonly id: string;
  readonly revision: number;
  readonly name: string;
  readonly amount: bigint;
  readonly multiplicity: bigint;
  readonly path: readonly PlacementSegment[];
  readonly depth: Depth;
}

function incomingCounts(closure: Closure): Map<string, number> {
  const incoming = new Map<string, number>(closure.order.map((flow) => [flow.id, 0]));
  for (const flow of closure.order)
    for (const { flowId } of subflowBlocks(flow)) {
      const child = closure.resolve(flowId);
      if (child) incoming.set(child.id, incoming.get(child.id)! + 1);
    }
  return incoming;
}

function multiplicities(closure: Closure): Map<string, bigint> {
  const incoming = incomingCounts(closure);
  const paths = new Map<string, bigint>([[closure.root.id, 1n]]);
  const ready = [closure.root];
  while (ready.length) {
    const flow = ready.pop()!;
    for (const { flowId } of subflowBlocks(flow)) {
      const child = closure.resolve(flowId);
      if (!child) continue;
      paths.set(child.id, (paths.get(child.id) ?? 0n) + paths.get(flow.id)!);
      const left = incoming.get(child.id)! - 1;
      incoming.set(child.id, left);
      if (left === 0) ready.push(child);
    }
  }
  return paths;
}

function budgetIssues(closure: Closure, definitions: CompositionDefinitions): ReadinessIssue[] {
  const paths = multiplicities(closure);
  const flowCounted = (amount: (flow: ReadinessFlow) => bigint, perPath: boolean) =>
    closure.order.map((flow): Counted => {
      const path = closure.paths.get(flow.id)!;
      const multiplicity = paths.get(flow.id)!;
      return {
        kind: "flow",
        id: flow.id,
        revision: flow.revision,
        name: flow.name,
        amount: perPath ? amount(flow) * multiplicity : amount(flow),
        multiplicity,
        path,
        depth: depthOf(path.length),
      };
    });
  const agentRows = agentCounted(closure, definitions, paths);
  const unique = { flows: closure.order.length, agents: agentRows.length };
  const ownBlocks = (flow: ReadinessFlow) =>
    BigInt(flow.graph.blocks.length + (flow.graph.finish === undefined ? 0 : 1));
  const ownConnections = (flow: ReadinessFlow) => BigInt(flow.graph.connections.length);
  const bytes = [
    ...flowCounted((flow) => BigInt(utf8Length(canonicalJson(flowBody(flow)))), false),
    ...agentRows,
  ];
  return [
    budgetIssue(
      closure,
      "captureBytes",
      bytes,
      SUBFLOW_CAPTURE_BYTES_LIMIT,
      unique,
      closureByDepth,
    ),
    budgetIssue(
      closure,
      "expandedBlocks",
      flowCounted(ownBlocks, true),
      SUBFLOW_EXPANDED_BLOCKS_LIMIT,
      unique,
      occurrenceDepth(closure, ownBlocks),
    ),
    budgetIssue(
      closure,
      "expandedConnections",
      flowCounted(ownConnections, true),
      SUBFLOW_EXPANDED_CONNECTIONS_LIMIT,
      unique,
      occurrenceDepth(closure, ownConnections),
    ),
  ].flatMap((issue) => (issue ? [issue] : []));
}

function agentCounted(
  closure: Closure,
  definitions: CompositionDefinitions,
  paths: ReadonlyMap<string, bigint>,
): Counted[] {
  const agents = new Map(definitions.agents.map((agent) => [agent.id, agent]));
  const placed = new Map<string, { multiplicity: bigint; path: PlacementSegment[] }>();
  for (const flow of closure.order)
    for (const block of flow.graph.blocks) {
      if (block.kind !== "agent" || block.agentId === null || !agents.has(block.agentId)) continue;
      const path = [...closure.paths.get(flow.id)!, { flowId: flow.id, blockId: block.id }];
      const known = placed.get(block.agentId);
      const multiplicity = (known?.multiplicity ?? 0n) + paths.get(flow.id)!;
      placed.set(block.agentId, {
        multiplicity,
        path: known && comparePaths(known.path, path) <= 0 ? known.path : path,
      });
    }
  return [...placed].map(([id, { multiplicity, path }]): Counted => {
    const agent = agents.get(id)!;
    return {
      kind: "agent",
      id,
      revision: agent.revision,
      name: agent.name,
      amount: BigInt(definitions.agentBytes(id)),
      multiplicity,
      path,
      depth: depthOf(path.length - 1),
    };
  });
}

type Subtotals = (counted: readonly Counted[]) => SubflowBudgetEvidence["subtotals"];

const closureByDepth: Subtotals = (counted) => {
  const totals: Partial<Record<SubflowBudgetClass, Record<Depth, bigint>>> = {};
  for (const row of counted) {
    const byDepth = (totals[row.kind] ??= { root: 0n, direct: 0n, deeper: 0n });
    byDepth[row.depth] += row.amount;
  }
  return Object.fromEntries(
    Object.entries(totals).map(([kind, byDepth]) => [kind, decimalSubtotals(byDepth)]),
  );
};

const occurrenceDepth =
  (closure: Closure, amount: (flow: ReadinessFlow) => bigint): Subtotals =>
  (counted) => {
    const total = counted.reduce((sum, row) => sum + row.amount, 0n);
    const root = amount(closure.root);
    const direct = subflowBlocks(closure.root).reduce((sum, { flowId }) => {
      const child = closure.resolve(flowId);
      return child ? sum + amount(child) : sum;
    }, 0n);
    return { flow: decimalSubtotals({ root, direct, deeper: total - root - direct }) };
  };

const decimalSubtotals = (byDepth: Record<Depth, bigint>): SubflowBudgetSubtotals => ({
  root: byDepth.root.toString(),
  direct: byDepth.direct.toString(),
  deeper: byDepth.deeper.toString(),
});

const MEASURE_TEXT: Record<SubflowBudgetEvidence["measure"], [string, string]> = {
  captureBytes: ["captures", "bytes of saved revisions"],
  expandedBlocks: ["expands to", "blocks"],
  expandedConnections: ["expands to", "connections"],
};
const CODES: Record<SubflowBudgetEvidence["measure"], string> = {
  captureBytes: "subflow_capture_bytes_exceeded",
  expandedBlocks: "subflow_expanded_blocks_exceeded",
  expandedConnections: "subflow_expanded_connections_exceeded",
};

const grouped = (value: bigint | number) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function budgetIssue(
  closure: Closure,
  measure: SubflowBudgetEvidence["measure"],
  counted: readonly Counted[],
  limit: number,
  unique: SubflowBudgetEvidence["unique"],
  subtotals: Subtotals,
): ReadinessIssue | undefined {
  const total = counted.reduce((sum, row) => sum + row.amount, 0n);
  if (total <= BigInt(limit)) return undefined;
  const classes = [...new Set(counted.map((row) => row.kind))];
  const contributors = classes.map((kind) => {
    const rows = counted
      .filter((row) => row.kind === kind && row.amount > 0n)
      .sort(
        (a, b) =>
          (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1) ||
          comparePaths(a.path, b.path) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    return {
      kind,
      ranked: rows.slice(0, CONTRIBUTOR_LIMIT).map((row) => contributor(closure, row)),
      omitted: Math.max(0, rows.length - CONTRIBUTOR_LIMIT),
    };
  });
  const largest = contributors
    .flatMap((group) => group.ranked)
    .sort((a, b) =>
      BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0,
    )[0];
  const [verb, unit] = MEASURE_TEXT[measure];
  return {
    code: CODES[measure],
    path: "graph",
    message: `This composition ${verb} ${grouped(total)} ${unit}, over the limit of ${grouped(limit)}.${largest ? ` Largest: ${largest.name}${largest.pathText ? ` (${largest.pathText})` : ""}, ${grouped(BigInt(largest.amount))}.` : ""}`,
    budget: {
      measure,
      total: total.toString(),
      limit: limit.toString(),
      unique,
      subtotals: subtotals(counted),
      contributors,
    },
  };
}

const contributor = (closure: Closure, row: Counted): SubflowBudgetContributor => ({
  kind: row.kind,
  id: row.id,
  revision: row.revision,
  name: row.name,
  amount: row.amount.toString(),
  multiplicity: row.multiplicity.toString(),
  path: row.path,
  pathText: pathText(closure, row.path),
});
