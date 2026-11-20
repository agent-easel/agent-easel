import {
  FINISH_BLOCK_ID,
  type AgentCapabilities,
  type AgentDefinition,
  type AgentExecutionSettings,
  type FlowAgentRevisions,
  type FlowBlockInput,
  type FlowGraphInput,
  type FlowReadiness,
  type ProjectIcon,
  type ProjectIconColor,
  type StartTitleProvenance,
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
import { mayPlaceAgent, type OwningProject } from "./placement.ts";

export const TASK_TITLE_LIMIT = 500;

/** The automatic Run title: the prompt text's first non-empty line, trimmed and bounded. */
export function promptTitle(text: string): string | undefined {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, TASK_TITLE_LIMIT);
}

const START_TITLE_PROVENANCES: readonly unknown[] = [
  "automatic",
  "manual",
  "legacy",
] satisfies StartTitleProvenance[];

export function isStartTitleProvenance(value: unknown): value is StartTitleProvenance {
  return START_TITLE_PROVENANCES.includes(value);
}

/** Run navigation compares creation times as text, so only `Date.toISOString()` output is valid. */
export function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

const PROJECT_ICON_COLORS = new Set<ProjectIconColor>([
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);

const projectIconColor = (value: unknown): ProjectIconColor | undefined =>
  typeof value === "string" && PROJECT_ICON_COLORS.has(value as ProjectIconColor)
    ? (value as ProjectIconColor)
    : undefined;

const boundedText = (value: unknown, min: number, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) return undefined;
  return trimmed;
};

const unsafeRenderableText = (value: string): boolean =>
  value.includes("<") || /^https?:\/\//i.test(value);

const optionalMonogram = (value: unknown): string | null | undefined => {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const text = boundedText(value, 1, 4);
  if (!text || unsafeRenderableText(text)) return undefined;
  return text;
};

function lucideProjectIcon(
  record: Record<string, unknown>,
  color: ProjectIconColor | undefined,
): ProjectIcon | null {
  const name = boundedText(record.name, 1, 128);
  if (!name || unsafeRenderableText(name) || !color) return null;
  const monogram = optionalMonogram(record.monogram);
  const monogramText = optionalMonogram(record.monogramText);
  return {
    kind: "lucide",
    name,
    color,
    ...(monogram !== undefined ? { monogram } : {}),
    ...(monogramText !== undefined ? { monogramText } : {}),
  };
}

const FAVICON_PATH_LIMIT = 512;

/** Bounds untrusted T3 faviconPath metadata; unknown or unsafe values become null. */
export function parseProjectFaviconPath(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return null;
  if (input.includes("\0")) return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > FAVICON_PATH_LIMIT) return null;
  if (trimmed.startsWith("/") || trimmed.includes("\\") || /^[a-z]:/i.test(trimmed)) return null;
  if (trimmed.split("/").includes("..")) return null;
  return trimmed;
}

/** Bounds untrusted T3 projectIcon metadata; unknown or malformed values become null. */
export function parseProjectIcon(input: unknown): ProjectIcon | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const color = projectIconColor(record.color);
  if (record.kind === "emoji") {
    const emoji = boundedText(record.emoji, 1, 32);
    if (!emoji || unsafeRenderableText(emoji)) return null;
    return { kind: "emoji", emoji };
  }
  if (record.kind === "monogram") {
    const text = boundedText(record.text, 1, 4);
    if (!text || unsafeRenderableText(text) || !color) return null;
    return { kind: "monogram", text, color };
  }
  if (record.kind === "lucide") {
    return lucideProjectIcon(record, color);
  }
  return null;
}

/** Whether any Agent block in the graph references the saved Agent definition. */
export function flowGraphReferencesAgent(graph: FlowGraphInput, agentId: string): boolean {
  return graph.blocks.some((block) => block.kind === "agent" && block.agentId === agentId);
}

/**
 * A saved Agent as Flow readiness sees it: its name, its current exits, its owning Project,
 * whether it has execution settings (never their live availability) and, for naming a wire whose
 * exit the Agent has since removed, the last name of each exit its earlier revisions had.
 */
export interface ReadinessAgent extends Pick<AgentDefinition, "id" | "name" | "exits"> {
  readonly projectId: OwningProject;
  readonly hasExecution: boolean;
  readonly formerExitNames: ReadonlyMap<string, string>;
}

/** A saved Agent as Flow readiness sees it. */
export const readinessAgent = (
  agent: AgentDefinition,
  formerExitNames: ReadonlyMap<string, string>,
): ReadinessAgent => ({
  id: agent.id,
  name: agent.name,
  exits: agent.exits,
  projectId: agent.projectId,
  hasExecution: agent.execution !== null,
  formerExitNames,
});

const blockLabel = (block: FlowBlockInput) => block.name || block.id;

const MINUTE_MS = 60_000;
const WAIT_UNIT_MS: Record<WaitUnit, number> = {
  minutes: MINUTE_MS,
  hours: 60 * MINUTE_MS,
  days: 24 * 60 * MINUTE_MS,
};
/** The supported Wait range, inclusive: 1 minute through 7 days. */
export const WAIT_MIN_MS = MINUTE_MS;
export const WAIT_MAX_MS = 7 * WAIT_UNIT_MS.days;

/** A Wait duration as elapsed milliseconds; readiness compares this normalized value. */
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

/**
 * A Condition is ready when every rule has a distinct, non-blank name and a threshold, and every
 * output, Otherwise included, is selected for some arrival number: thresholds strictly descend and
 * are at least 2. Each finding names its rule row.
 */
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

/**
 * Whether a captured Condition still has a shape Start accepts: well-formed rules and the fixed
 * Otherwise, every output selectable, and every wire leaving it on one of its outputs. A captured
 * revision is immutable, so only damaged storage fails this; the Runner checks it before numbering.
 */
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

/** Names, Agent references and exits of one block. */
function blockReadiness(
  block: FlowBlockInput,
  path: string,
  agents: readonly ReadinessAgent[],
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
    // Workers may finish on an exit's name or ID, so one exit's name must not be another's ID.
    else if (agentIds.has(name) || agentNames.has(exit.id))
      add(
        "exit_name_conflict",
        `${path}.localExits.${j}.name`,
        `${label}: local exit "${name}" is ambiguous: its name or ID matches the ID or name of an exit from its Agent. Rename or remove the local exit.`,
      );
  });
}

function targetLabel(
  graph: FlowGraphInput,
  blocks: ReadonlyMap<string, FlowBlockInput>,
  edge: FlowGraphInput["connections"][number],
) {
  if (edge.targetBlockId !== FINISH_BLOCK_ID) {
    const target = blocks.get(edge.targetBlockId);
    return target ? blockLabel(target) : edge.targetBlockId;
  }
  const ending = graph.finish?.endings.find((candidate) => candidate.id === edge.targetEndingId);
  return `Finish · ${ending?.name.trim() || edge.targetEndingId}`;
}

/** Wires from an Agent block must leave one of its effective exits. */
function connectionReadiness(
  graph: FlowGraphInput,
  agents: readonly ReadinessAgent[],
  add: IssueReporter,
) {
  const blocks = new Map(graph.blocks.map((block) => [block.id, block]));
  graph.connections.forEach((edge, i) => {
    const source = blocks.get(edge.sourceBlockId);
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

/**
 * A Condition cannot end a branch: every output, Otherwise included, needs a wire. Unconnected exits
 * of Agents and Human steps, and an unconnected Wait or Continuation output, still end the branch.
 */
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
      edge.targetBlockId === FINISH_BLOCK_ID && edge.targetEndingId ? [edge.targetEndingId] : [],
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

/** Every block must be reachable from a Flow input target. */
function reachabilityReadiness(graph: FlowGraphInput, add: IssueReporter) {
  const reached = new Set(graph.flowInput.targetBlockIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.connections)
      if (reached.has(edge.sourceBlockId) && !reached.has(edge.targetBlockId)) {
        reached.add(edge.targetBlockId);
        changed = true;
      }
  }
  graph.blocks.forEach((block, i) => {
    if (!reached.has(block.id))
      add(
        "unreachable_block",
        `graph.blocks.${i}`,
        `Connect a path from the Flow input to ${blockLabel(block)}.`,
      );
  });
}

/**
 * Every directed cycle through a Condition that passes only Conditions and Continuations blocks
 * Start, whichever outputs its wires leave by: a Continuation may already be used and pass messages
 * straight through, so such a loop could circle without any work, answer or wait. One issue per
 * Condition on such a cycle, naming one shortest cycle through it. Loops through an Agent, a Human
 * step or a Wait stay legal, as do cycles of Continuations alone.
 */
function conditionCycleReadiness(graph: FlowGraphInput, add: IssueReporter) {
  const passThrough = new Map(
    graph.blocks.flatMap((block) =>
      block.kind === "condition" || block.kind === "continuation" ? [[block.id, block]] : [],
    ),
  );
  const next = new Map<string, string[]>();
  for (const edge of graph.connections)
    if (passThrough.has(edge.sourceBlockId) && passThrough.has(edge.targetBlockId))
      next.set(edge.sourceBlockId, [...(next.get(edge.sourceBlockId) ?? []), edge.targetBlockId]);
  graph.blocks.forEach((block, i) => {
    if (block.kind !== "condition") return;
    const cycle = shortestCycle(block.id, next);
    if (!cycle) return;
    const names = cycle.map((id) => blockLabel(passThrough.get(id)!));
    add(
      "condition_cycle",
      `graph.blocks.${i}`,
      `${blockLabel(block)} loops back to itself through only Conditions and Continuations (${[...names, names[0]].join(" → ")}). Route the loop through an Agent, Human step or Wait.`,
    );
  });
}

/** The blocks of one shortest directed cycle from `start` back to it, in order, if any. */
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

/**
 * The Agent blocks whose worker threads a Continuation can continue: the nearest Agent on each
 * incoming path, walking back through Human steps, Waits, Conditions and Continuations, which have
 * no thread of their own. A Flow input targets only Agents, so every path a Run can take into a Continuation passes
 * one; at run time the arriving message's own worker decides.
 */
export function continuationSources(graph: FlowGraphInput, blockId: string): string[] {
  const blocks = new Map(graph.blocks.map((block) => [block.id, block]));
  const sources = new Set<string>();
  const visited = new Set<string>([blockId]);
  const pending = [blockId];
  while (pending.length) {
    const target = pending.pop()!;
    for (const edge of graph.connections) {
      if (edge.targetBlockId !== target) continue;
      const source = blocks.get(edge.sourceBlockId);
      if (source?.kind === "agent") sources.add(source.id);
      else if (source && !visited.has(source.id)) {
        visited.add(source.id);
        pending.push(source.id);
      }
    }
  }
  return graph.blocks.flatMap((block) => (sources.has(block.id) ? [block.id] : []));
}

export function handoffRecipients(
  connections: FlowGraphInput["connections"],
  sourceBlockId: string,
  exitId: string,
): string[] {
  return [
    ...new Set(
      connections.flatMap((edge) =>
        edge.sourceBlockId === sourceBlockId &&
        edge.exitId === exitId &&
        edge.targetBlockId !== FINISH_BLOCK_ID
          ? [edge.targetBlockId]
          : [],
      ),
    ),
  ];
}

export function handoffEndings(
  connections: FlowGraphInput["connections"],
  sourceBlockId: string,
  exitId: string,
): string[] {
  return [
    ...new Set(
      connections.flatMap((edge) =>
        edge.sourceBlockId === sourceBlockId &&
        edge.exitId === exitId &&
        edge.targetBlockId === FINISH_BLOCK_ID &&
        edge.targetEndingId
          ? [edge.targetEndingId]
          : [],
      ),
    ),
  ];
}

/**
 * Graph and saved-Agent readiness against the given saved Agents, placed by a Flow owned by
 * `flowProject`; live T3 settings availability, project and provisioning gates remain separate.
 * Issues block Start, never a save.
 */
export function flowReadiness(
  graph: FlowGraphInput,
  agents: readonly ReadinessAgent[],
  flowProject: OwningProject,
): FlowReadiness {
  const issues: ValidationIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (!graph.flowInput.targetBlockIds.length)
    add(
      "flow_input_required",
      "graph.flowInput.targetBlockIds",
      "Connect the Flow input to at least one Agent before running this Flow.",
    );
  const waits = new Set(graph.blocks.flatMap((block) => (block.kind === "wait" ? [block.id] : [])));
  graph.flowInput.targetBlockIds.forEach((target, i) => {
    if (waits.has(target))
      add(
        "flow_input_wait",
        `graph.flowInput.targetBlockIds.${i}`,
        "Connect the Flow input to Agents only; a Wait cannot start a Run.",
      );
  });
  graph.blocks.forEach((block, i) =>
    blockReadiness(block, `graph.blocks.${i}`, agents, flowProject, add),
  );
  connectionReadiness(graph, agents, add);
  conditionOutputReadiness(graph, add);
  conditionCycleReadiness(graph, add);
  finishReadiness(graph, add);
  if (graph.flowInput.targetBlockIds.length) reachabilityReadiness(graph, add);
  return { ready: issues.length === 0, issues };
}

/**
 * The out-of-rule placements of a Flow owned by `flowProject`, as its readiness reports them
 * (`agent_scope_mismatch`). Saving refuses a graph that has any.
 */
export function placementIssues(
  graph: FlowGraphInput,
  agents: readonly ReadinessAgent[],
  flowProject: OwningProject,
): ValidationIssue[] {
  return flowReadiness(graph, agents, flowProject).issues.filter(
    (issue) => issue.code === "agent_scope_mismatch",
  );
}

/**
 * The dependency stamp of Flow readiness: readiness depends only on the graph and the saved
 * revision and owning Project of each Agent it places, because an Agent's exits and former exit
 * names are fixed per revision while its owner changes without one. Equal stamps for the same
 * graph mean equal readiness.
 */
export function flowAgentRevisions(
  graph: FlowGraphInput,
  agents: readonly Pick<AgentDefinition, "id" | "revision" | "projectId">[],
): FlowAgentRevisions {
  const revisions: Record<string, FlowAgentRevisions[string]> = {};
  for (const block of graph.blocks)
    if (block.kind === "agent" && block.agentId) {
      const agent = agents.find((candidate) => candidate.id === block.agentId);
      revisions[block.agentId] = agent
        ? { revision: agent.revision, projectId: agent.projectId }
        : null;
    }
  return revisions;
}

/** Resolve saved execution identifiers against a capability catalog without substituting defaults. */
export function resolveAgentModel(
  execution: Pick<AgentExecutionSettings, "providerInstanceId" | "modelId">,
  capabilities: AgentCapabilities | null,
) {
  const provider = capabilities?.providers.find(
    (entry) => entry.providerInstanceId === execution.providerInstanceId,
  );
  const model = provider?.models.find((entry) => entry.id === execution.modelId);
  return { provider, model };
}

export { connectionKey } from "./flow.ts";
export {
  duplicateTreatment,
  mayPlaceAgent,
  mayStartFlow,
  type OwningProject,
  validateChangeOwner,
} from "./placement.ts";
export {
  CONDITION_OTHERWISE,
  CONTINUATION_EXIT,
  effectiveExits,
  exitsWithEndings,
  inheritedExits,
  HUMAN_EXITS,
  WAIT_OUTPUT,
  type EffectiveExit,
  type ExitSource,
  type ExitWithEndings,
} from "./block-exits.ts";
export {
  CLIENT_LABEL_LIMIT,
  FACTORY_MINIMUM_PEER_PROTOCOL,
  FACTORY_MINIMUM_SERVER_PROTOCOL,
  FACTORY_PROTOCOL,
  protocolCompatibility,
  validateClientAccessRequest,
} from "./client-access.ts";
export {
  imageSignatureMime,
  isSha256Hex,
  parseStartPrompt,
  promptText,
  RUN_IMAGE_DELETION_LIMIT,
  RUN_IMAGE_LIMIT,
  RUN_IMAGE_MAX_BYTES,
  RUN_IMAGE_MIME_TYPES,
  RUN_IMAGE_NAME_LIMIT,
  validateStartPrompt,
  type StartPrompt,
} from "./run-prompt.ts";
export { parseAppearancePresentation } from "./appearance.ts";
export { buildOptions, hintedSelection, optionAvailability, optionValue } from "./model-options.ts";
export {
  CANVAS_COORD_MAX,
  CANVAS_COORD_MESSAGE,
  CANVAS_COORD_MIN,
  isCanvasPosition,
  validateCreateFlow,
  validateDuplicateFlow,
  validatePreviewFlowDuplicate,
  validateUpdateFlow,
} from "./flow.ts";
export {
  executionForProject,
  validateCreateAgent,
  validateDuplicateAgent,
  validateExecutionSettings,
  validateUpdateAgent,
  validateUpdateRunTitleSetting,
} from "./agent.ts";
export {
  DEFINITION_REQUEST_LIMIT_BYTES,
  definitionSaveFits,
  parsePortableFile,
  saveRequestBound,
  PORTABLE_DOCUMENT_AGENT_LIMIT,
  PORTABLE_DOCUMENT_LIMIT_BYTES,
  portableDocumentText,
  validateCommitImport,
} from "./portable-document.ts";
export {
  CHAT_MODEL_BASE_URL_LIMIT,
  CHAT_MODEL_KEY_LIMIT,
  CHAT_MODEL_NAME_LIMIT,
  CHAT_MODEL_PROVIDER_KINDS,
  validateChatModelBaseUrl,
  validateCheckDiscordConnection,
  validateDiscordId,
  validateDiscordPublicKey,
  validateTestChatModel,
  validateUpdateChatModel,
  validateUpdateDiscordConnection,
  validateUpdateDiscordAccess,
  validateSetChatControlEnabled,
  validateRetryChatDelivery,
} from "./chat-control.ts";
export {
  parseTriggerQuery,
  validateTriggerLimit,
  validateTriggerSchedule,
  TRIGGER_DEFAULTS,
  validateCreateTrigger,
  validateSetTriggerEnabled,
  validateUpdateTrigger,
  type TriggerSettings,
} from "./trigger.ts";
