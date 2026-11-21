import {
  CONDITION_ARRIVAL_MAX,
  CONDITION_OTHERWISE_ID,
  FINISH_BLOCK_ID,
  type CreateFlowInput,
  type DuplicateFlowInput,
  type EndingOutput,
  type FlowDuplicateAgentChoice,
  type FlowConnection,
  type FlowGraphInput,
  type FlowWorkspace,
  type PreviewFlowDuplicateInput,
  type Result,
  type UpdateFlowInput,
  type ValidationIssue,
  type WaitUnit,
} from "@t3-factory/contracts";
import {
  CONTINUATION_EXIT,
  checkExits,
  HUMAN_EXITS,
  WAIT_OUTPUT,
  isId,
  isRecord,
  type IssueReporter,
} from "./block-exits.ts";
import {
  parseDuplicateCommitTarget,
  parseExpectedOwner,
  parseOwningProject,
  parseTargetOwner,
} from "./placement.ts";

/** Structural save validation is deliberately separate from execution readiness. */
function validateFlowName(input: unknown): Result<Pick<CreateFlowInput, "name">> {
  const name =
    typeof input === "object" && input !== null && "name" in input ? input.name : undefined;
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 200) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "Enter a Flow name between 1 and 200 characters.",
        issues: [
          {
            code: "invalid_name",
            path: "name",
            message: "Enter a Flow name between 1 and 200 characters.",
          },
        ],
      },
    };
  }
  return { ok: true, value: { name: name.trim() } };
}

export const CANVAS_COORD_MIN = -10000;
export const CANVAS_COORD_MAX = 10000;
export const CANVAS_COORD_MESSAGE = `Use finite canvas coordinates from ${CANVAS_COORD_MIN} to ${CANVAS_COORD_MAX}.`;

export const isCanvasPosition = (v: unknown): v is { x: number; y: number } =>
  isRecord(v) &&
  [v.x, v.y].every(
    (c) =>
      typeof c === "number" && Number.isFinite(c) && c >= CANVAS_COORD_MIN && c <= CANVAS_COORD_MAX,
  );
/** Hide entries name inherited exit IDs; whether the Agent still has them is not a save rule. */
function checkHiddenExits(hidden: unknown, path: string, issue: IssueReporter) {
  if (
    !Array.isArray(hidden) ||
    hidden.length > 100 ||
    !hidden.every(isId) ||
    new Set(hidden).size !== hidden.length
  )
    issue("invalid_hidden_exits", path, "Hide up to 100 distinct inherited exit IDs.");
}

/** The fields each block kind may carry beside its id, name, kind and position; an Agent block's
 * Revisit instruction has its own rule, which reports it on any other kind at its field path. A
 * Map, so an untrusted kind such as "toString" never resolves to an Object.prototype member. */
const KIND_FIELDS: ReadonlyMap<unknown, readonly string[]> = new Map([
  ["agent", ["agentId", "hiddenExitIds", "localExits"]],
  ["human", []],
  ["wait", ["duration"]],
  ["continuation", ["prompt"]],
  ["condition", ["rules", "otherwise"]],
]);

/** An Agent reference, a Wait duration, a Continuation prompt or a Condition's rules and
 * Otherwise, the fields only one kind has. */
function checkKindFields(block: Record<string, unknown>, path: string, issue: IssueReporter) {
  if (block.kind === "agent" && block.agentId !== null && !isId(block.agentId))
    issue(
      "invalid_agent_reference",
      `${path}.agentId`,
      "Choose a saved Agent or leave the reference empty.",
    );
  if (
    block.kind === "continuation" &&
    (typeof block.prompt !== "string" || block.prompt.trim().length > CONTINUATION_PROMPT_LIMIT)
  )
    issue(
      "invalid_prompt",
      `${path}.prompt`,
      "Enter a Continuation prompt up to 120,000 characters.",
    );
  if (block.kind === "wait") checkWaitDuration(block.duration, `${path}.duration`, issue);
  if (block.kind === "condition") checkCondition(block, path, issue);
  checkRevisitInstruction(block, `${path}.revisitInstruction`, issue);
  checkRevisitContext(block, `${path}.revisitContext`, issue);
}

/** Only an Agent block has a Revisit instruction, reported at its own path on any other kind;
 * an omitted one saves empty. */
function checkRevisitInstruction(
  block: Record<string, unknown>,
  path: string,
  issue: IssueReporter,
) {
  const instruction = block.revisitInstruction;
  if (instruction === undefined) return;
  if (block.kind !== "agent")
    issue("invalid_revisit_instruction", path, "Only an Agent block has a Revisit instruction.");
  else if (typeof instruction !== "string" || instruction.trim().length > REVISIT_INSTRUCTION_LIMIT)
    issue(
      "invalid_revisit_instruction",
      path,
      "Enter a Revisit instruction up to 120,000 characters.",
    );
}

function checkRevisitContext(block: Record<string, unknown>, path: string, issue: IssueReporter) {
  const revisitContext = block.revisitContext;
  if (revisitContext === undefined) return;
  if (block.kind !== "agent")
    issue("invalid_revisit_context", path, "Only an Agent block has a revisit context setting.");
  else if (revisitContext !== "keep" && revisitContext !== "fresh")
    issue("invalid_revisit_context", path, 'Use "keep" or "fresh" for revisitContext.');
}

function checkBlockFields(
  block: Record<string, unknown>,
  path: string,
  blockIds: Set<string>,
  issue: IssueReporter,
) {
  const kindFields = KIND_FIELDS.get(block.kind);
  const allowed = ["id", "name", "kind", "position", ...(kindFields ?? [])];
  if (
    Object.keys(block).some(
      (key) => key !== "revisitInstruction" && key !== "revisitContext" && !allowed.includes(key),
    )
  )
    issue(
      "block_overrides_forbidden",
      path,
      "Blocks reference saved Agents; local settings and extra fields are not allowed.",
    );
  if (!isId(block.id) || blockIds.has(block.id))
    issue("invalid_block_id", `${path}.id`, "Block IDs must be non-empty and unique.");
  else blockIds.add(block.id);
  if (!kindFields)
    issue(
      "invalid_block_kind",
      `${path}.kind`,
      "Use an Agent, Human, Wait, Continuation or Condition block.",
    );
  if (typeof block.name !== "string" || block.name.length > 200)
    issue("invalid_block_name", `${path}.name`, "Use a block name up to 200 characters.");
  checkKindFields(block, path, issue);
  if (block.position !== undefined && !isCanvasPosition(block.position))
    issue("invalid_position", `${path}.position`, CANVAS_COORD_MESSAGE);
}

const CONDITION_RULE_FIELDS = ["id", "name", "fromArrival"];

/** A threshold is null or a whole arrival number SQLite and JSON both hold exactly; it is never
 * rounded or coerced. Its order and the reachability of each output are readiness rules. */
const isConditionThreshold = (value: unknown) =>
  value === null ||
  (typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= CONDITION_ARRIVAL_MAX);

/** A Condition's rules and its fixed Otherwise. Rule ids share one scope with the Otherwise id
 * because wires leave by them; names stay free text, bounded only by the save budget. */
export function checkCondition(block: Record<string, unknown>, path: string, issue: IssueReporter) {
  const otherwise = block.otherwise;
  if (
    !isRecord(otherwise) ||
    Object.keys(otherwise).length !== 1 ||
    otherwise.id !== CONDITION_OTHERWISE_ID
  )
    issue(
      "invalid_condition_otherwise",
      `${path}.otherwise`,
      `A Condition ends with the fixed Otherwise output, {"id": "${CONDITION_OTHERWISE_ID}"}.`,
    );
  if (!Array.isArray(block.rules)) {
    issue("invalid_condition_rules", `${path}.rules`, "Supply the Condition's rules in order.");
    return;
  }
  const ids = new Set([CONDITION_OTHERWISE_ID]);
  block.rules.forEach((rule: unknown, i) => {
    const rulePath = `${path}.rules.${i}`;
    if (!isRecord(rule)) {
      issue("invalid_condition_rule", rulePath, "Supply a rule with an ID, name and arrival.");
      return;
    }
    if (Object.keys(rule).some((key) => !CONDITION_RULE_FIELDS.includes(key)))
      issue(
        "condition_rule_fields_forbidden",
        rulePath,
        "A Condition rule has only an ID, a name and the arrival it applies from.",
      );
    if (!isId(rule.id) || ids.has(rule.id))
      issue(
        "invalid_condition_rule_id",
        `${rulePath}.id`,
        `Rule IDs must be unique within the Condition and differ from "${CONDITION_OTHERWISE_ID}".`,
      );
    else ids.add(rule.id);
    if (typeof rule.name !== "string")
      issue("invalid_condition_rule_name", `${rulePath}.name`, "Name the rule's output as text.");
    if (!isConditionThreshold(rule.fromArrival))
      issue(
        "invalid_condition_threshold",
        `${rulePath}.fromArrival`,
        `Enter a whole arrival number from 1 to ${CONDITION_ARRIVAL_MAX}, or leave it empty.`,
      );
  });
}

const WAIT_UNITS: readonly string[] = ["minutes", "hours", "days"] satisfies WaitUnit[];

/** A Wait's duration is null or a finite amount in a known unit; its range is a readiness rule
 * on the normalized duration, so a zero, negative or out-of-range draft still saves. */
function checkWaitDuration(duration: unknown, path: string, issue: IssueReporter) {
  if (duration === null) return;
  if (
    !isRecord(duration) ||
    Object.keys(duration).some((key) => key !== "amount" && key !== "unit") ||
    typeof duration.amount !== "number" ||
    !Number.isFinite(duration.amount) ||
    typeof duration.unit !== "string" ||
    !WAIT_UNITS.includes(duration.unit)
  )
    issue(
      "invalid_wait_duration",
      path,
      "Enter a number of minutes, hours or days, or leave the duration empty.",
    );
}

/**
 * The exit IDs a connection may leave each block by: a Human block's, Wait's or Continuation's fixed
 * exits, a Condition's rule and Otherwise outputs, or `inherited` for an Agent block, whose wires
 * may also name Agent exits that readiness resolves.
 */
type ConnectableExits = Map<string, ReadonlySet<string> | "inherited">;
const FIXED_EXIT_IDS: ReadonlyMap<unknown, ReadonlySet<string>> = new Map([
  ["human", new Set(HUMAN_EXITS.map((exit) => exit.id))],
  ["wait", new Set([WAIT_OUTPUT.id])],
  ["continuation", new Set([CONTINUATION_EXIT.id])],
]);
const CONTINUATION_PROMPT_LIMIT = 120_000;
const REVISIT_INSTRUCTION_LIMIT = CONTINUATION_PROMPT_LIMIT;

function checkBlock(
  block: unknown,
  path: string,
  blockIds: Set<string>,
  exits: ConnectableExits,
  issue: IssueReporter,
) {
  if (!isRecord(block)) {
    issue("invalid_block", path, "Supply an Agent, Human, Wait, Continuation or Condition block.");
    return;
  }
  checkBlockFields(block, path, blockIds, issue);
  if (block.kind === "agent") {
    checkHiddenExits(block.hiddenExitIds, `${path}.hiddenExitIds`, issue);
    checkExits(block.localExits, `${path}.localExits`, false, issue);
  }
  if (typeof block.id === "string") exits.set(block.id, connectableExits(block));
}

function connectableExits(block: Record<string, unknown>): ReadonlySet<string> | "inherited" {
  if (block.kind === "condition") return conditionExitIds(block.rules);
  return FIXED_EXIT_IDS.get(block.kind) ?? "inherited";
}

const conditionExitIds = (rules: unknown): ReadonlySet<string> =>
  new Set([
    ...(Array.isArray(rules) ? rules : []).flatMap((rule: unknown) =>
      isRecord(rule) && isId(rule.id) ? [rule.id] : [],
    ),
    CONDITION_OTHERWISE_ID,
  ]);

const GRAPH_FIELDS = ["blocks", "connections", "flowInput", "finish"];
const FLOW_INPUT_FIELDS = ["position", "targetBlockIds"];
const FINISH_FIELDS = ["position", "endings"];
const ENDING_FIELDS = ["id", "name", "description", "output", "outputDescription"];
const ENDING_OUTPUTS: readonly unknown[] = [
  "none",
  "optional",
  "required",
] satisfies EndingOutput[];
const ENDING_LIMIT = 100;
const ENDING_TEXT_LIMIT = 4000;

function checkEnding(ending: unknown, path: string, ids: Set<string>, issue: IssueReporter) {
  if (!isRecord(ending)) {
    issue("invalid_ending", path, "Supply an ending with an ID, name and output setting.");
    return;
  }
  if (Object.keys(ending).some((key) => !ENDING_FIELDS.includes(key)))
    issue(
      "ending_fields_forbidden",
      path,
      "An ending has only an ID, name, description, output and output description.",
    );
  if (!isId(ending.id) || ids.has(ending.id))
    issue("invalid_ending_id", `${path}.id`, "Ending IDs must be non-empty and unique.");
  else ids.add(ending.id);
  if (typeof ending.name !== "string" || ending.name.trim().length > 200)
    issue("invalid_ending_name", `${path}.name`, "Use an ending name up to 200 characters.");
  for (const field of ["description", "outputDescription"])
    if (typeof ending[field] !== "string" || ending[field].length > ENDING_TEXT_LIMIT)
      issue(
        "invalid_ending_description",
        `${path}.${field}`,
        `Use a description up to ${ENDING_TEXT_LIMIT} characters.`,
      );
  if (!ENDING_OUTPUTS.includes(ending.output))
    issue("invalid_ending_output", `${path}.output`, "Choose none, optional or required output.");
}

function checkFinish(finish: unknown, issue: IssueReporter): ReadonlySet<string> {
  const ids = new Set<string>();
  if (finish === undefined) return ids;
  const path = "graph.finish";
  if (!isRecord(finish) || !Array.isArray(finish.endings) || finish.endings.length > ENDING_LIMIT) {
    issue("invalid_finish", path, `Supply the Finish block with up to ${ENDING_LIMIT} endings.`);
    return ids;
  }
  if (Object.keys(finish).some((key) => !FINISH_FIELDS.includes(key)))
    issue("finish_fields_forbidden", path, "The Finish block has only a position and endings.");
  if (finish.position !== undefined && !isCanvasPosition(finish.position))
    issue("invalid_position", `${path}.position`, CANVAS_COORD_MESSAGE);
  finish.endings.forEach((ending, i) => checkEnding(ending, `${path}.endings.${i}`, ids, issue));
  return ids;
}

/** The Flow input may target only existing Agent or Wait blocks, each at most once; a Wait target
 * is a readiness gap, not a save error. */
function checkFlowInput(
  flowInput: unknown,
  blockIds: ReadonlySet<string>,
  targetableBlockIds: ReadonlySet<string>,
  issue: IssueReporter,
) {
  const path = "graph.flowInput";
  if (!isRecord(flowInput) || !Array.isArray(flowInput.targetBlockIds)) {
    issue("invalid_flow_input", path, "Supply the Flow input block with its connected Agents.");
    return;
  }
  if (Object.keys(flowInput).some((key) => !FLOW_INPUT_FIELDS.includes(key)))
    issue(
      "flow_input_fields_forbidden",
      path,
      "The Flow input block has only a position and targets.",
    );
  if (flowInput.position !== undefined && !isCanvasPosition(flowInput.position))
    issue("invalid_position", `${path}.position`, CANVAS_COORD_MESSAGE);
  const targets = new Set<string>();
  flowInput.targetBlockIds.forEach((target, i) => {
    if (target === FINISH_BLOCK_ID && !blockIds.has(target))
      issue(
        "flow_input_finish",
        `${path}.targetBlockIds.${i}`,
        "The Flow input cannot connect to Finish: a Run cannot end before any work happens.",
      );
    else if (!isId(target) || targets.has(target) || !targetableBlockIds.has(target))
      issue(
        "invalid_flow_input_target",
        `${path}.targetBlockIds.${i}`,
        "Connect the Flow input only to Agent blocks in this Flow, each once.",
      );
    else targets.add(target);
  });
}

const connectable = (exits: ConnectableExits, source: unknown, exitId: unknown) => {
  const allowed = typeof source === "string" ? exits.get(source) : undefined;
  if (allowed === undefined) return false;
  return allowed === "inherited" ? isId(exitId) : typeof exitId === "string" && allowed.has(exitId);
};

export function connectionKey(
  connection: Omit<FlowConnection, "targetEndingId"> & {
    readonly targetEndingId?: string | undefined;
  },
): string {
  return JSON.stringify([
    connection.sourceBlockId,
    connection.exitId,
    connection.targetBlockId,
    connection.targetEndingId ?? null,
  ]);
}

const validTarget = (
  edge: Record<string, unknown>,
  blockIds: ReadonlySet<string>,
  endingIds: ReadonlySet<string>,
) =>
  edge.targetEndingId === undefined
    ? typeof edge.targetBlockId === "string" && blockIds.has(edge.targetBlockId)
    : edge.targetBlockId === FINISH_BLOCK_ID &&
      typeof edge.targetEndingId === "string" &&
      endingIds.has(edge.targetEndingId);

function checkConnections(
  connections: readonly unknown[],
  blockIds: ReadonlySet<string>,
  endingIds: ReadonlySet<string>,
  exits: ConnectableExits,
  issue: IssueReporter,
) {
  const edges = new Set<string>();
  connections.forEach((edge, i) => {
    const path = `graph.connections.${i}`;
    if (
      !isRecord(edge) ||
      !connectable(exits, edge.sourceBlockId, edge.exitId) ||
      !validTarget(edge, blockIds, endingIds)
    ) {
      issue(
        "invalid_connection",
        path,
        `Connect an existing source exit to an existing block, or to an existing ending with targetBlockId "${FINISH_BLOCK_ID}" and its targetEndingId.`,
      );
      return;
    }
    const key = connectionKey(edge as unknown as FlowConnection);
    if (edges.has(key))
      issue("duplicate_connection", path, "This exit is already connected to that target.");
    edges.add(key);
  });
}

const MAX_ORDINARY_BLOCKS = 500;
const ORDINARY_BLOCK_LIMIT_WITH_FINISH = MAX_ORDINARY_BLOCKS - 1;
type BlockLimit = number | "authored" | "portable";

function authoredBlockLimit(finish: unknown) {
  return finish === undefined ? MAX_ORDINARY_BLOCKS : ORDINARY_BLOCK_LIMIT_WITH_FINISH;
}

function portableBlockLimit(finish: unknown) {
  const empty =
    finish === undefined ||
    (isRecord(finish) && Array.isArray(finish.endings) && !finish.endings.length);
  return empty ? MAX_ORDINARY_BLOCKS : ORDINARY_BLOCK_LIMIT_WITH_FINISH;
}

function graphSizeIssue(
  blocks: number,
  connections: number,
  blockLimit: number,
  counted: "ordinary" | "including Finish" = blockLimit === MAX_ORDINARY_BLOCKS
    ? "ordinary"
    : "including Finish",
): ValidationIssue | undefined {
  if (blocks <= blockLimit && connections <= 5000) return;
  return {
    code: "graph_too_large",
    path: "graph",
    message:
      counted === "ordinary"
        ? "Use at most 500 ordinary blocks and 5000 connections."
        : "Use at most 500 blocks, including Finish, and 5000 connections.",
  };
}

export function portableFlowSizeIssue(
  graph: Pick<FlowGraphInput, "blocks" | "connections" | "finish">,
) {
  return graphSizeIssue(
    graph.blocks.length,
    graph.connections.length,
    portableBlockLimit(graph.finish),
  );
}

const authoredBlockCount = (graph: Pick<FlowGraphInput, "blocks" | "finish">) =>
  graph.blocks.length + (graph.finish === undefined ? 0 : 1);

export function flowEditSizeRefusal(
  graph: FlowGraphInput,
  saved: FlowGraphInput,
): Result<never> | undefined {
  const issue = graphSizeIssue(
    authoredBlockCount(graph),
    graph.connections.length,
    Math.max(MAX_ORDINARY_BLOCKS, authoredBlockCount(saved)),
    "including Finish",
  );
  if (issue)
    return { ok: false, error: { code: "validation", message: issue.message, issues: [issue] } };
  return undefined;
}

function checkGraph(graph: unknown, blockLimit: BlockLimit, issue: IssueReporter) {
  if (!isRecord(graph) || !Array.isArray(graph.blocks) || !Array.isArray(graph.connections)) {
    issue("invalid_graph", "graph", "Supply blocks, connections and the Flow input block.");
    return;
  }
  if (Object.keys(graph).some((key) => !GRAPH_FIELDS.includes(key)))
    issue(
      "graph_fields_forbidden",
      "graph",
      "A Flow graph has only blocks, connections, the Flow input block and the Finish block.",
    );
  const blockIds = new Set<string>();
  const exits: ConnectableExits = new Map();
  const sizeIssue = graphSizeIssue(
    graph.blocks.length,
    graph.connections.length,
    blockLimit === "portable"
      ? portableBlockLimit(graph.finish)
      : blockLimit === "authored"
        ? authoredBlockLimit(graph.finish)
        : blockLimit,
  );
  if (sizeIssue) issue(sizeIssue.code, sizeIssue.path, sizeIssue.message);
  graph.blocks.forEach((block, i) =>
    checkBlock(block, `graph.blocks.${i}`, blockIds, exits, issue),
  );
  const targetableBlockIds = new Set(
    graph.blocks.flatMap((block) =>
      isRecord(block) && (block.kind === "agent" || block.kind === "wait") && isId(block.id)
        ? [block.id]
        : [],
    ),
  );
  checkFlowInput(graph.flowInput, blockIds, targetableBlockIds, issue);
  checkConnections(graph.connections, blockIds, checkFinish(graph.finish, issue), exits, issue);
}

const WORKSPACE_REF_LIMIT = 255;

/** A Git ref Factory passes as one argument: never an option, whitespace or control text. */
function workspaceRef(value: unknown): string | undefined {
  const ref = typeof value === "string" ? value.trim() : "";
  if (!ref || ref.length > WORKSPACE_REF_LIMIT || ref.startsWith("-") || /[\s\p{Cc}]/u.test(ref))
    return undefined;
  return ref;
}

function checkWorkspace(raw: unknown, issue: IssueReporter): FlowWorkspace | undefined {
  if (!isRecord(raw) || (raw.mode !== "checkout" && raw.mode !== "worktree")) {
    issue("invalid_workspace", "workspace.mode", "Choose the project checkout or a new worktree.");
    return undefined;
  }
  if (raw.mode === "checkout") return { mode: "checkout" };
  const base = raw.base;
  if (isRecord(base) && base.kind === "default")
    return { mode: "worktree", base: { kind: "default" } };
  if (!isRecord(base) || base.kind !== "ref") {
    issue("invalid_workspace_base", "workspace.base", "Choose the default branch or a custom ref.");
    return undefined;
  }
  const ref = workspaceRef(base.ref);
  if (ref) return { mode: "worktree", base: { kind: "ref", ref } };
  issue(
    "invalid_workspace_ref",
    "workspace.base.ref",
    `Enter a Git ref up to ${WORKSPACE_REF_LIMIT} characters without spaces or a leading "-".`,
  );
  return undefined;
}

/** Checks a create or save body in one pass, so a reply lists every defect at once. */
function checkFlowBody(input: unknown, required: boolean, blockLimit: BlockLimit) {
  const name = validateFlowName(input);
  if (!name.ok) return name;
  const raw = input as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const issue: IssueReporter = (code, path, message) => issues.push({ code, path, message });
  if (
    required &&
    (!Number.isSafeInteger(raw.expectedRevision) || (raw.expectedRevision as number) < 1)
  )
    issue("invalid_revision", "expectedRevision", "Include the revision you opened.");
  if (raw.graph !== undefined) checkGraph(raw.graph, blockLimit, issue);
  else if (required)
    issue("invalid_graph", "graph", "Supply blocks, connections and the Flow input block.");
  const workspace = raw.workspace === undefined ? undefined : checkWorkspace(raw.workspace, issue);
  if (issues.length)
    return {
      ok: false as const,
      error: { code: "validation" as const, message: issues[0]!.message, issues },
    };
  return {
    ok: true as const,
    value: {
      ...name.value,
      ...(raw.graph !== undefined ? { graph: trimGraphText(raw.graph as FlowGraphInput) } : {}),
      ...(workspace ? { workspace } : {}),
    },
    expectedRevision: raw.expectedRevision as number,
  };
}
export function validateCreateFlow(
  input: unknown,
  source: "authoring" | "portable" = "authoring",
): Result<CreateFlowInput> {
  const checked = checkFlowBody(input, false, source === "portable" ? "portable" : "authored");
  if (!checked.ok) return checked;
  const projectId = parseOwningProject(input);
  if (!projectId.ok) return projectId;
  return { ok: true, value: { ...checked.value, projectId: projectId.value } };
}
export function validateUpdateFlow(input: unknown): Result<UpdateFlowInput> {
  const checked = checkFlowBody(input, true, MAX_ORDINARY_BLOCKS);
  if (!checked.ok) return checked;
  const expectedProjectId = parseExpectedOwner(input);
  if (!expectedProjectId.ok) return expectedProjectId;
  const { graph, ...rest } = checked.value;
  return {
    ok: true,
    value: {
      ...rest,
      expectedRevision: checked.expectedRevision,
      expectedProjectId: expectedProjectId.value,
      graph: graph!,
    },
  };
}

export function validatePreviewFlowDuplicate(input: unknown): Result<PreviewFlowDuplicateInput> {
  const projectId = parseTargetOwner(input);
  if (!projectId.ok) return projectId;
  return { ok: true, value: projectId.value === undefined ? {} : { projectId: projectId.value } };
}

const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1;

/** A planned Agent as the plan listed it; fields the plan adds for display are ignored. */
function checkDuplicateChoice(
  value: unknown,
  path: string,
  issue: IssueReporter,
): FlowDuplicateAgentChoice | undefined {
  const fields = isRecord(value) ? value : {};
  const { agentId, revision, choice } = fields;
  const projectId = parseTargetOwner(fields);
  if (
    typeof agentId !== "string" ||
    agentId.length === 0 ||
    agentId.length > 256 ||
    !isRevision(revision) ||
    !projectId.ok ||
    projectId.value === undefined ||
    (choice !== "keep" && choice !== "copy")
  ) {
    issue(
      "invalid_duplicate_agent",
      path,
      "Send each planned Agent's agentId, revision and projectId as the plan listed them, with choice keep or copy.",
    );
    return undefined;
  }
  return { agentId, revision, projectId: projectId.value, choice };
}

/**
 * A Flow Duplicate commit: the previewed plan's resolved target, its source revision and every
 * planned Agent's choice.
 */
export function validateDuplicateFlow(input: unknown): Result<DuplicateFlowInput> {
  const fields = isRecord(input) ? input : {};
  const name = fields.name === undefined ? undefined : validateFlowName(fields);
  if (name && !name.ok) return name;
  const projectId = parseDuplicateCommitTarget(fields);
  if (!projectId.ok) return projectId;
  const issues: ValidationIssue[] = [];
  const issue: IssueReporter = (code, path, message) => issues.push({ code, path, message });
  if (!isRevision(fields.expectedRevision))
    issue("invalid_revision", "expectedRevision", "Include the source revision the plan copies.");
  const agents = Array.isArray(fields.agents) && fields.agents.length <= 500 ? fields.agents : [];
  if (agents !== fields.agents)
    issue("invalid_duplicate_agents", "agents", "Send the plan's Agents, at most 500.");
  const choices = agents.flatMap(
    (agent, index) => checkDuplicateChoice(agent, `agents.${index}`, issue) ?? [],
  );
  if (issues.length)
    return { ok: false, error: { code: "validation", message: issues[0]!.message, issues } };
  return {
    ok: true,
    value: {
      ...name?.value,
      projectId: projectId.value,
      expectedRevision: fields.expectedRevision as number,
      agents: choices,
    },
  };
}

function trimGraphText(graph: FlowGraphInput): FlowGraphInput {
  return {
    ...graph,
    ...(graph.finish && {
      finish: {
        ...graph.finish,
        endings: graph.finish.endings.map((ending) => ({ ...ending, name: ending.name.trim() })),
      },
    }),
    blocks: graph.blocks.map((block) => {
      if (block.kind === "agent")
        return {
          ...block,
          localExits: block.localExits.map((exit) => ({ ...exit, name: exit.name.trim() })),
          ...(block.revisitInstruction === undefined
            ? {}
            : { revisitInstruction: block.revisitInstruction.trim() }),
        };
      if (block.kind === "continuation") return { ...block, prompt: block.prompt.trim() };
      if (block.kind === "condition")
        return {
          ...block,
          rules: block.rules.map((rule) => ({ ...rule, name: rule.name.trim() })),
        };
      return block;
    }),
  };
}
