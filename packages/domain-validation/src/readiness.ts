import {
  FINISH_BLOCK_ID,
  type AgentDefinition,
  type FlowBlockInput,
  type FlowGraphInput,
  type FlowReadiness,
  type FlowWorkspace,
  type ValidationIssue,
  type WaitDuration,
  type WaitUnit,
} from "@t3-factory/contracts";
import {
  CONDITION_OTHERWISE,
  effectiveExits,
  inheritedExits,
  type IssueReporter,
} from "./block-exits.ts";
import { checkCondition } from "./flow.ts";
import { joinSlots } from "./join.ts";
import { mayPlaceAgent, mayPlaceFlow, type OwningProject } from "./placement.ts";
import { continuationsWithoutWorker } from "./worker-binding.ts";

export interface ReadinessAgent extends Pick<
  AgentDefinition,
  "id" | "name" | "exits" | "revision"
> {
  readonly projectId: OwningProject;
  readonly hasExecution: boolean;
  readonly formerExitNames: ReadonlyMap<string, string>;
}

export const readinessAgent = (
  agent: AgentDefinition,
  formerExitNames: ReadonlyMap<string, string>,
): ReadinessAgent => ({
  id: agent.id,
  name: agent.name,
  exits: agent.exits,
  revision: agent.revision,
  projectId: agent.projectId,
  hasExecution: agent.execution !== null,
  formerExitNames,
});

export interface ReadinessFlow {
  readonly id: string;
  readonly revision: number;
  readonly projectId: OwningProject;
  readonly name: string;
  readonly graph: FlowGraphInput;
  readonly workspace: FlowWorkspace;
}

export type ReadinessFlows = ReadonlyMap<string, ReadinessFlow>;

export function blockLabel(block: FlowBlockInput) {
  return block.name || block.id;
}

const MINUTE_MS = 60_000;
const WAIT_UNIT_MS: Record<WaitUnit, number> = {
  minutes: MINUTE_MS,
  hours: 60 * MINUTE_MS,
  days: 24 * 60 * MINUTE_MS,
};

export const WAIT_MIN_MS = MINUTE_MS;
export const WAIT_MAX_MS = 7 * WAIT_UNIT_MS.days;

export function waitDurationMs(duration: WaitDuration): number {
  return duration.amount * WAIT_UNIT_MS[duration.unit];
}

function waitReadiness(
  block: Extract<FlowBlockInput, { kind: "wait" }>,
  path: string,
  add: IssueReporter,
) {
  const label = blockLabel(block);
  if (!block.duration)
    add("wait_duration_required", `${path}.duration`, `Enter how long ${label} waits.`);
  else if (
    waitDurationMs(block.duration) < WAIT_MIN_MS ||
    waitDurationMs(block.duration) > WAIT_MAX_MS
  )
    add("wait_duration_range", `${path}.duration`, `${label} must wait from 1 minute to 7 days.`);
}

function conditionReadiness(
  block: Extract<FlowBlockInput, { kind: "condition" }>,
  path: string,
  add: IssueReporter,
) {
  const label = blockLabel(block);
  const names = new Set([CONDITION_OTHERWISE.name]);
  let lowest = Infinity;
  block.rules.forEach((rule, j) => {
    const rulePath = `${path}.rules.${j}`;
    const name = rule.name.trim();
    const row = `${label}: rule ${j + 1}${name ? ` "${name}"` : ""}`;
    if (!name)
      add("condition_rule_name_required", `${rulePath}.name`, `${row} needs an output name.`);
    else if (names.has(name))
      add(
        "condition_rule_name_duplicate",
        `${rulePath}.name`,
        `${row} has the same name as another output of the Condition. Rename it.`,
      );
    names.add(name);
    if (rule.fromArrival === null) {
      add(
        "condition_threshold_required",
        `${rulePath}.fromArrival`,
        `${row} needs the arrival number it applies from.`,
      );
      return;
    }
    if (rule.fromArrival >= lowest)
      add(
        "condition_rule_shadowed",
        `${rulePath}.fromArrival`,
        `${row} is never selected: an earlier rule already matches from arrival ${lowest}. Order rules from the highest arrival number down.`,
      );
    else if (rule.fromArrival === 1)
      add(
        "condition_threshold_first_arrival",
        `${rulePath}.fromArrival`,
        `${row} matches every arrival from the first, so Otherwise is never selected. Use arrival 2 or later.`,
      );
    lowest = Math.min(lowest, rule.fromArrival);
  });
}

export function conditionStartReady(
  block: Extract<FlowBlockInput, { kind: "condition" }>,
  connections: FlowGraphInput["connections"],
) {
  let ready = true;
  const add: IssueReporter = () => {
    ready = false;
  };
  checkCondition({ ...block }, "", add);
  conditionReadiness(block, "", add);
  const outputs = new Set([CONDITION_OTHERWISE.id, ...block.rules.map((rule) => rule.id)]);
  return (
    ready &&
    connections.every((edge) => edge.sourceBlockId !== block.id || outputs.has(edge.exitId))
  );
}

function blockReadiness(
  block: FlowBlockInput,
  path: string,
  agents: readonly ReadinessAgent[],
  flows: ReadinessFlows,
  flowProject: OwningProject,
  add: IssueReporter,
) {
  const label = blockLabel(block);
  if (!block.name.trim()) add("block_name_required", `${path}.name`, `Name block ${block.id}.`);
  if (block.kind === "wait") waitReadiness(block, path, add);
  if (block.kind === "condition") conditionReadiness(block, path, add);
  if (block.kind === "continuation" && !block.prompt.trim())
    add(
      "continuation_prompt_required",
      `${path}.prompt`,
      `Write the prompt ${label} sends to the conversation it continues.`,
    );
  if (block.kind === "subflow") subflowReadiness(block, path, flows, flowProject, add);
  if (block.kind !== "agent") return;
  const agent = agents.find((candidate) => candidate.id === block.agentId);
  if (!agent) add("agent_required", `${path}.agentId`, `Choose a saved Agent for ${label}.`);
  else if (!mayPlaceAgent(flowProject, agent.projectId))
    add(
      "agent_scope_mismatch",
      `${path}.agentId`,
      flowProject === null
        ? `${label}: ${agent.name} is a Project Agent, so this global Flow cannot place it.`
        : `${label}: ${agent.name} is owned by another Project, so this Flow cannot place it.`,
    );
  else if (!agent.hasExecution)
    add("agent_model_required", `${path}.agentId`, `${label}: ${agent.name} needs a model.`);
  if (!effectiveExits(block, agents).length)
    add("exit_required", path, `Add an exit to ${label} or its Agent.`);
  const inherited = inheritedExits(block, agents);
  const agentNames = new Set(inherited.map((exit) => exit.name.trim()));
  const agentIds = new Set(inherited.map((exit) => exit.id));
  block.localExits.forEach((exit, j) => {
    const name = exit.name.trim();
    if (agentIds.has(exit.id))
      add(
        "exit_id_conflict",
        `${path}.localExits.${j}.id`,
        `${label}: local exit "${name || exit.id}" has the same ID as an exit from its Agent. Remove and recreate the local exit.`,
      );
    if (!name)
      add(
        "exit_name_required",
        `${path}.localExits.${j}.name`,
        `Name local exit ${exit.id} on ${label}.`,
      );
    else if (agentNames.has(name))
      add(
        "exit_name_conflict",
        `${path}.localExits.${j}.name`,
        `${label}: local exit "${name}" has the same name as an exit from its Agent. Rename or remove the local exit.`,
      );
    else if (agentIds.has(name) || agentNames.has(exit.id))
      add(
        "exit_name_conflict",
        `${path}.localExits.${j}.name`,
        `${label}: local exit "${name}" is ambiguous: its name or ID matches the ID or name of an exit from its Agent. Rename or remove the local exit.`,
      );
  });
}

function subflowReadiness(
  block: Extract<FlowBlockInput, { kind: "subflow" }>,
  path: string,
  flows: ReadinessFlows,
  flowProject: OwningProject,
  add: IssueReporter,
) {
  const label = blockLabel(block);
  if (block.flowId === null) {
    add("subflow_flow_required", `${path}.flowId`, `Choose a saved Flow for ${label}.`);
    return;
  }
  const child = flows.get(block.flowId);
  if (!child) {
    add(
      "subflow_flow_missing",
      `${path}.flowId`,
      `${label}: its Flow ${block.flowId} was removed or does not exist. Choose a saved Flow.`,
    );
    return;
  }
  if (!mayPlaceFlow(flowProject, child.projectId))
    add(
      "flow_scope_mismatch",
      `${path}.flowId`,
      flowProject === null
        ? `${label}: ${child.name} is a Project Flow, so this global Flow cannot place it.`
        : `${label}: ${child.name} is owned by another Project, so this Flow cannot place it.`,
    );
  if (!reachesEnding(child.graph))
    add(
      "subflow_ending_required",
      `${path}.flowId`,
      `${label}: ${child.name} has no Finish ending its Flow input can reach. Connect an ending in ${child.name}.`,
    );
}

function reachedBlocks(graph: FlowGraphInput): Set<string> {
  const reached = new Set(graph.flowInput.targetBlockIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.connections)
      if (
        edge.targetEndingId === undefined &&
        reached.has(edge.sourceBlockId) &&
        !reached.has(edge.targetBlockId)
      ) {
        reached.add(edge.targetBlockId);
        changed = true;
      }
  }
  return reached;
}

export function reachesEnding(graph: FlowGraphInput): boolean {
  const reached = reachedBlocks(graph);
  const endings = new Set(graph.finish?.endings.map((ending) => ending.id));
  return graph.connections.some(
    (edge) =>
      edge.targetBlockId === FINISH_BLOCK_ID &&
      edge.targetEndingId !== undefined &&
      endings.has(edge.targetEndingId) &&
      reached.has(edge.sourceBlockId),
  );
}

function targetLabel(
  graph: FlowGraphInput,
  blocks: ReadonlyMap<string, FlowBlockInput>,
  edge: FlowGraphInput["connections"][number],
) {
  if (edge.targetEndingId === undefined) {
    const target = blocks.get(edge.targetBlockId);
    return target ? blockLabel(target) : edge.targetBlockId;
  }
  const ending = graph.finish?.endings.find((candidate) => candidate.id === edge.targetEndingId);
  return `Finish · ${ending?.name.trim() || edge.targetEndingId}`;
}

function connectionReadiness(
  graph: FlowGraphInput,
  agents: readonly ReadinessAgent[],
  flows: ReadinessFlows,
  add: IssueReporter,
) {
  const blocks = new Map(graph.blocks.map((block) => [block.id, block]));
  graph.connections.forEach((edge, i) => {
    const source = blocks.get(edge.sourceBlockId);
    if (source?.kind === "subflow") {
      const child = source.flowId === null ? undefined : flows.get(source.flowId);
      if (!child || child.graph.finish?.endings.some((ending) => ending.id === edge.exitId)) return;
      const label = blockLabel(source);
      add(
        "subflow_exit_missing",
        `graph.connections.${i}`,
        `${label}: ${child.name} no longer has ending "${edge.exitId}". Wire ${label} to one of its current endings or remove its connection to ${targetLabel(graph, blocks, edge)}.`,
      );
      return;
    }
    if (source?.kind !== "agent") return;
    const agent = agents.find((candidate) => candidate.id === source.agentId);
    if (!agent || effectiveExits(source, agents).some((exit) => exit.id === edge.exitId)) return;
    const toTarget = `its connection to ${targetLabel(graph, blocks, edge)}`;
    const inherited = agent.exits.find((exit) => exit.id === edge.exitId);
    if (inherited)
      add(
        "exit_hidden",
        `graph.connections.${i}`,
        `${blockLabel(source)}: exit "${inherited.name}" is hidden in this Flow. Show the exit or remove ${toTarget}.`,
      );
    else
      add(
        "exit_missing",
        `graph.connections.${i}`,
        `${blockLabel(source)}: its Agent no longer has exit "${agent.formerExitNames.get(edge.exitId) ?? edge.exitId}". Remove ${toTarget}.`,
      );
  });
}

function conditionOutputReadiness(graph: FlowGraphInput, add: IssueReporter) {
  const wired = new Set(
    graph.connections.map((edge) => `${edge.sourceBlockId}\u0000${edge.exitId}`),
  );
  graph.blocks.forEach((block, i) => {
    if (block.kind !== "condition") return;
    const unconnected = (exitId: string) => !wired.has(`${block.id}\u0000${exitId}`);
    const label = blockLabel(block);
    block.rules.forEach((rule, j) => {
      if (unconnected(rule.id))
        add(
          "condition_output_unconnected",
          `graph.blocks.${i}.rules.${j}`,
          `${label}: connect output "${rule.name.trim() || `rule ${j + 1}`}". A Condition output cannot end a branch.`,
        );
    });
    if (unconnected(CONDITION_OTHERWISE.id))
      add(
        "condition_output_unconnected",
        `graph.blocks.${i}`,
        `${label}: connect output "${CONDITION_OTHERWISE.name}". A Condition output cannot end a branch.`,
      );
  });
}

function finishReadiness(graph: FlowGraphInput, add: IssueReporter) {
  const wired = new Set(
    graph.connections.flatMap((edge) =>
      edge.targetEndingId === undefined ? [] : [edge.targetEndingId],
    ),
  );
  const names = new Set<string>();
  graph.finish?.endings.forEach((ending, i) => {
    const path = `graph.finish.endings.${i}`;
    const name = ending.name.trim();
    const row = `Finish: ending ${i + 1}${name ? ` "${name}"` : ""}`;
    if (!name) add("ending_name_required", `${path}.name`, `${row} needs a name.`);
    else if (names.has(name))
      add(
        "ending_name_duplicate",
        `${path}.name`,
        `${row} has the same name as another ending. Rename it.`,
      );
    names.add(name);
    if (!wired.has(ending.id))
      add("ending_unconnected", path, `${row}: connect an exit or output to this ending.`);
  });
}

function reachabilityReadiness(graph: FlowGraphInput, add: IssueReporter) {
  const reached = reachedBlocks(graph);
  graph.blocks.forEach((block, i) => {
    if (!reached.has(block.id))
      add(
        "unreachable_block",
        `graph.blocks.${i}`,
        `Connect a path from the Flow input to ${blockLabel(block)}.`,
      );
  });
}

function workerlessCycleReadiness(
  graph: FlowGraphInput,
  add: IssueReporter,
  rule: {
    readonly code: string;
    readonly kinds: ReadonlySet<FlowBlockInput["kind"]>;
    readonly start: FlowBlockInput["kind"];
    readonly through: string;
  },
) {
  const passThrough = new Map(
    graph.blocks.flatMap((block) => (rule.kinds.has(block.kind) ? [[block.id, block]] : [])),
  );
  const next = new Map<string, string[]>();
  for (const edge of graph.connections)
    if (
      edge.targetEndingId === undefined &&
      passThrough.has(edge.sourceBlockId) &&
      passThrough.has(edge.targetBlockId)
    )
      next.set(edge.sourceBlockId, [...(next.get(edge.sourceBlockId) ?? []), edge.targetBlockId]);
  graph.blocks.forEach((block, i) => {
    if (block.kind !== rule.start) return;
    const cycle = shortestCycle(block.id, next);
    if (!cycle) return;
    const names = cycle.map((id) => blockLabel(passThrough.get(id)!));
    add(
      rule.code,
      `graph.blocks.${i}`,
      `${blockLabel(block)} loops back to itself through only ${rule.through} (${[...names, names[0]].join(" → ")}). Route the loop through an Agent, Human step or Wait.`,
    );
  });
}

const CONDITION_CYCLE_RULE = {
  code: "condition_cycle",
  kinds: new Set<FlowBlockInput["kind"]>(["condition", "continuation"]),
  start: "condition",
  through: "Conditions and Continuations",
} as const;

const JOIN_CYCLE_RULE = {
  code: "join_cycle",
  kinds: new Set<FlowBlockInput["kind"]>(["join", "condition", "continuation"]),
  start: "join",
  through: "Joins, Conditions and Continuations",
} as const;

function joinReadiness(graph: FlowGraphInput, add: IssueReporter) {
  const wired = new Set(graph.connections.map((edge) => edge.sourceBlockId));
  graph.blocks.forEach((block, i) => {
    if (block.kind !== "join") return;
    const label = blockLabel(block);
    if (joinSlots(graph, block.id).length < 2)
      add(
        "join_sources_required",
        `graph.blocks.${i}`,
        `${label} needs at least two different blocks wired into it. Connect another block, or remove the Join.`,
      );
    if (!wired.has(block.id))
      add(
        "join_output_unconnected",
        `graph.blocks.${i}`,
        `${label}: connect its output. A Join output cannot end a branch.`,
      );
  });
}

function continuationWorkerReadiness(
  graph: FlowGraphInput,
  flows: ReadinessFlows,
  add: IssueReporter,
) {
  const unbound = continuationsWithoutWorker(graph, flows);
  graph.blocks.forEach((block, i) => {
    if (!unbound.has(block.id)) return;
    add(
      "continuation_worker_required",
      `graph.blocks.${i}`,
      `${blockLabel(block)} can receive a message that has no worker thread, such as a Join's output. Route that path through an Agent first.`,
    );
  });
}

function shortestCycle(start: string, next: ReadonlyMap<string, readonly string[]>) {
  const previous = new Map<string, string>();
  const queue = [start];
  for (let at = 0; at < queue.length; at++) {
    const current = queue[at]!;
    for (const target of next.get(current) ?? []) {
      if (target === start) {
        const cycle = [current];
        while (cycle[0] !== start) cycle.unshift(previous.get(cycle[0]!)!);
        return cycle;
      }
      if (previous.has(target)) continue;
      previous.set(target, current);
      queue.push(target);
    }
  }
  return undefined;
}

export function continuationSources(graph: FlowGraphInput, blockId: string): string[] {
  const blocks = new Map(graph.blocks.map((block) => [block.id, block]));
  const sources = new Set<string>();
  const visited = new Set<string>([blockId]);
  const pending = [blockId];
  while (pending.length) {
    const target = pending.pop()!;
    for (const edge of graph.connections) {
      if (edge.targetEndingId !== undefined || edge.targetBlockId !== target) continue;
      const source = blocks.get(edge.sourceBlockId);
      if (source?.kind === "agent" || source?.kind === "subflow") sources.add(source.id);
      else if (source && !visited.has(source.id)) {
        visited.add(source.id);
        pending.push(source.id);
      }
    }
  }
  return graph.blocks.flatMap((block) => (sources.has(block.id) ? [block.id] : []));
}

export function flowReadiness(
  graph: FlowGraphInput,
  agents: readonly ReadinessAgent[],
  flowProject: OwningProject,
  flows: ReadinessFlows = new Map(),
): FlowReadiness {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (!graph.flowInput.targetBlockIds.length)
    add(
      "flow_input_required",
      "graph.flowInput.targetBlockIds",
      "Connect the Flow input to at least one Agent or Subflow before running this Flow.",
    );
  const waits = new Set(graph.blocks.flatMap((block) => (block.kind === "wait" ? [block.id] : [])));
  graph.flowInput.targetBlockIds.forEach((target, i) => {
    if (waits.has(target))
      add(
        "flow_input_wait",
        `graph.flowInput.targetBlockIds.${i}`,
        "Connect the Flow input to Agents and Subflows only; a Wait cannot start a Run.",
      );
  });
  graph.blocks.forEach((block, i) =>
    blockReadiness(block, `graph.blocks.${i}`, agents, flows, flowProject, add),
  );
  connectionReadiness(graph, agents, flows, add);
  conditionOutputReadiness(graph, add);
  workerlessCycleReadiness(graph, add, CONDITION_CYCLE_RULE);
  workerlessCycleReadiness(graph, add, JOIN_CYCLE_RULE);
  joinReadiness(graph, add);
  continuationWorkerReadiness(graph, flows, add);
  finishReadiness(graph, add);
  if (graph.flowInput.targetBlockIds.length) reachabilityReadiness(graph, add);
  return { ready: issues.length === 0, issues };
}

export function placementIssues(
  graph: FlowGraphInput,
  agents: readonly ReadinessAgent[],
  flows: ReadinessFlows,
  flowProject: OwningProject,
): ValidationIssue[] {
  return flowReadiness(graph, agents, flowProject, flows).issues.filter(
    (issue) => issue.code === "agent_scope_mismatch" || issue.code === "flow_scope_mismatch",
  );
}
