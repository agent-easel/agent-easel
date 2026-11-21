import {
  PORTABLE_DOCUMENT_FORMAT,
  PORTABLE_DOCUMENT_VERSION,
  type AgentExecutionSettings,
  type CommitImportInput,
  type FlowBlockInput,
  type FlowFinishBlock,
  type FlowInputBlock,
  type FlowWorkspace,
  type ImportedDocument,
  type OperationError,
  type PortableAgent,
  type PortableDocument,
  type PortableFlow,
  type PortableFlowBlock,
  type PortableFormatVersion,
  type PortableModelHint,
  type Result,
  type ValidationIssue,
} from "@t3-factory/contracts";
import { validateCreateAgent, validateExecutionSettings, validateModelReference } from "./agent.ts";
import { isRecord } from "./block-exits.ts";
import { validateCreateFlow } from "./flow.ts";
import { OWNING_PROJECT_ID_LIMIT, parseOwningProject } from "./placement.ts";

/** The largest create or save request for one Agent or Flow definition. */
export const DEFINITION_REQUEST_LIMIT_BYTES = 2_000_000;

/** The largest portable document an import accepts (16 MiB). */
export const PORTABLE_DOCUMENT_LIMIT_BYTES = 16_777_216;

/** The most Agents one portable document may bundle. */
export const PORTABLE_DOCUMENT_AGENT_LIMIT = 500;

/** The exact file text of a portable document; export measures this text against the import limit. */
export function portableDocumentText(document: PortableDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

const jsonByteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * Whether a definition's later save request fits the definition limit: its create body plus the
 * `expectedRevision` and `expectedProjectId` every save sends, measured at the largest revision and
 * longest owner a save may name so the definition stays savable at any revision and owner it reaches.
 */
export function definitionSaveFits(body: object): boolean {
  return jsonByteLength(saveRequestBound(body)) <= DEFINITION_REQUEST_LIMIT_BYTES;
}

/** A save request at the largest revision and longest owner it may name. */
export function saveRequestBound(body: object) {
  return {
    ...body,
    expectedRevision: Number.MAX_SAFE_INTEGER,
    expectedProjectId: "0".repeat(OWNING_PROJECT_ID_LIMIT),
  };
}

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Shown issue lists stay short however broken a file is. */
const ISSUE_LIMIT = 20;
const ENVELOPE_FIELDS = [
  "format",
  "formatVersion",
  "kind",
  "factoryVersion",
  "exportedAt",
  "agents",
];
const FLOW_ENVELOPE_FIELDS = [...ENVELOPE_FIELDS, "flow"];
const AGENT_FIELDS = ["key", "name", "prompt", "model", "exits"];
const HINT_FIELDS = ["providerInstanceId", "modelId", "modelOptions"];
const OPTION_FIELDS = ["id", "value"];
const EXIT_FIELDS = ["id", "name", "description", "messageRequired"];
const FLOW_FIELDS = ["name", "graph", "workspace"];
const GRAPH_FIELDS = ["blocks", "connections", "flowInput"];
const FINISH_FIELDS = ["position", "endings"];
const ENDING_FIELDS = ["id", "name", "description", "output", "outputDescription"];
const FLOW_INPUT_FIELDS = ["position", "targetBlockIds"];
const CONNECTION_FIELDS = ["sourceBlockId", "exitId", "targetBlockId"];
const POSITION_FIELDS = ["x", "y"];
const DURATION_FIELDS = ["amount", "unit"];
const BLOCK_FIELDS = ["id", "name", "kind", "position"];
const CONDITION_RULE_FIELDS = ["id", "name", "fromArrival"];
const CONDITION_OTHERWISE_FIELDS = ["id"];

/**
 * One strict reader per readable format version: the block kinds its files hold, each with its own
 * fields, and how a rejection names them. Kind maps are Maps, so an untrusted kind never resolves
 * to a prototype member. Every reader decodes into the current definition model.
 */
interface FormatReader {
  readonly version: PortableFormatVersion;
  readonly finish: boolean;
  readonly kindFields: ReadonlyMap<unknown, readonly string[]>;
  readonly kindChoice: string;
}

const VERSION_1_KIND_FIELDS: ReadonlyMap<unknown, readonly string[]> = new Map([
  ["agent", ["agentKey", "hiddenExitIds", "localExits", "revisitInstruction"]],
  ["human", []],
  ["wait", ["duration"]],
  ["continuation", ["prompt"]],
]);

/** Version 1 holds no Condition block, so its definitions already are the current model. */
const VERSION_1: FormatReader = {
  version: 1,
  finish: false,
  kindFields: VERSION_1_KIND_FIELDS,
  kindChoice: "an Agent, Human, Wait or Continuation block",
};

/** Version 2 is version 1 plus the Condition block. */
const VERSION_2: FormatReader = {
  version: 2,
  finish: false,
  kindFields: new Map([...VERSION_1_KIND_FIELDS, ["condition", ["rules", "otherwise"]]]),
  kindChoice: "an Agent, Human, Wait, Continuation or Condition block",
};

const VERSION_3: FormatReader = { ...VERSION_2, version: PORTABLE_DOCUMENT_VERSION, finish: true };

const READERS: ReadonlyMap<unknown, FormatReader> = new Map(
  [VERSION_1, VERSION_2, VERSION_3].map((reader) => [reader.version, reader]),
);

type Issues = ValidationIssue[];

function rejected(code: OperationError["code"], issues: Issues): Result<never> {
  const shown = issues.slice(0, ISSUE_LIMIT);
  return { ok: false, error: { code, message: shown[0]!.message, issues: shown } };
}

const issue = (code: string, path: string, message: string): ValidationIssue => ({
  code,
  path,
  message,
});

const NOT_JSON_MESSAGE = "This file is not valid JSON. Choose a file exported by Factory.";

const documentTooLarge = () =>
  rejected("too_large", [
    issue(
      "document_too_large",
      "document",
      "This file is larger than the 16 MiB an import accepts.",
    ),
  ]);

/** The chosen file's bytes as a document: the size limit, UTF-8 JSON, then the format checks. */
export function parsePortableFile(data: Uint8Array): Result<ImportedDocument> {
  if (data.byteLength > PORTABLE_DOCUMENT_LIMIT_BYTES) return documentTooLarge();
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    return rejected("validation", [issue("not_json", "document", NOT_JSON_MESSAGE)]);
  }
  return decodePortableDocument(value);
}

/**
 * Strict decoding by the file's version reader, in order: the marker and version, the Agent count,
 * unknown or missing fields at every level, closed key references, then the Agent and Flow domain
 * validators and each definition's save size. Messages name Agents, blocks and fields, never
 * prompt text.
 */
function decodePortableDocument(value: unknown): Result<ImportedDocument> {
  const envelope = checkEnvelope(value);
  if (!envelope.ok) return envelope;
  const { fields, reader } = envelope.value;
  const agents = fields.agents;
  if (Array.isArray(agents) && agents.length > PORTABLE_DOCUMENT_AGENT_LIMIT)
    return rejected("too_large", [
      issue(
        "too_many_agents",
        "agents",
        `This file bundles ${agents.length} Agents; an import accepts at most ${PORTABLE_DOCUMENT_AGENT_LIMIT}.`,
      ),
    ]);
  const shape = shapeIssues(fields, reader);
  if (shape.length > 0) return rejected("validation", shape);
  const entries = agents as readonly Record<string, unknown>[];
  const references = referenceIssues(fields, entries);
  if (references.length > 0) return rejected("validation", references);
  return fields.kind === "flow"
    ? flowDocument(fields, reader, entries)
    : agentDocument(fields, reader, entries);
}

function checkEnvelope(
  value: unknown,
): Result<{ fields: Record<string, unknown>; reader: FormatReader }> {
  if (!isRecord(value) || value.format !== PORTABLE_DOCUMENT_FORMAT)
    return rejected("validation", [
      issue(
        "not_factory_export",
        "format",
        "This file is not a Factory export. Choose a file exported from an Agent or a Flow.",
      ),
    ]);
  const version = value.formatVersion;
  if (!Number.isSafeInteger(version))
    return rejected("validation", [
      issue("invalid_format_version", "formatVersion", "This file has no valid format version."),
    ]);
  const reader = READERS.get(version);
  if (!reader)
    return rejected("validation", [
      issue(
        "unsupported_format_version",
        "formatVersion",
        (version as number) > PORTABLE_DOCUMENT_VERSION
          ? `This file uses format version ${version as number}, which this Factory cannot read. Update Factory to import it.`
          : `This file uses format version ${version as number}, which Factory cannot read.`,
      ),
    ]);
  if (value.kind !== "agent" && value.kind !== "flow")
    return rejected("validation", [
      issue("invalid_kind", "kind", "A Factory export is an Agent file or a Flow file."),
    ]);
  return { ok: true, value: { fields: value, reader } };
}

/** How messages name an Agent: its name when the file gives a usable one, else its position. */
function agentLabel(agent: unknown, index: number): string {
  const name = isRecord(agent) ? agent.name : undefined;
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 200
    ? `Agent "${name.trim()}"`
    : `Agent ${index + 1}`;
}

/** How messages name a block: its name when the file gives a usable one, else its position. */
function blockLabel(block: unknown, index: number): string {
  const name = isRecord(block) ? block.name : undefined;
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 200
    ? `Block "${name.trim()}"`
    : `Block ${index + 1}`;
}

/** A field name safe to repeat in a path; anything else is reported at its parent. */
const shownField = (path: string, field: string) =>
  KEY_PATTERN.test(field) ? `${path}.${field}` : path;

function checkFields(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  subject: string,
  issues: Issues,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    issues.push(issue("invalid_field", path, `${subject}: expected an object at ${path}.`));
    return undefined;
  }
  for (const field of Object.keys(value))
    if (!required.includes(field) && !optional.includes(field))
      issues.push(
        issue(
          "unknown_field",
          shownField(path, field),
          `${subject} has a field that a Factory export does not have.`,
        ),
      );
  for (const field of required)
    if (!(field in value))
      issues.push(issue("missing_field", `${path}.${field}`, `${subject} is missing ${field}.`));
  return value;
}

function checkList(
  value: unknown,
  path: string,
  subject: string,
  issues: Issues,
): readonly unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  issues.push(issue("invalid_field", path, `${subject}: expected a list at ${path}.`));
  return [];
}

function shapeIssues(fields: Record<string, unknown>, reader: FormatReader): Issues {
  const issues: Issues = [];
  const flow = fields.kind === "flow";
  const envelope = flow ? FLOW_ENVELOPE_FIELDS : ENVELOPE_FIELDS;
  const document = checkFields(fields, "document", envelope, [], "The file", issues);
  for (const field of ["factoryVersion", "exportedAt"])
    if (field in fields && typeof fields[field] !== "string")
      issues.push(issue("invalid_field", field, `The file's ${field} must be text.`));
  const agents = checkList(document?.agents, "agents", "The file", issues);
  agents.forEach((agent, index) =>
    checkAgentShape(agent, `agents.${index}`, agentLabel(agent, index), issues),
  );
  if (flow && document && "flow" in document) checkFlowShape(document.flow, reader, issues);
  // The document's own unknown fields are addressed at the top level, not under "document".
  return issues.map((entry) => ({ ...entry, path: entry.path.replace(/^document\.?/, "") }));
}

function checkAgentShape(agent: unknown, path: string, subject: string, issues: Issues) {
  const fields = checkFields(agent, path, AGENT_FIELDS, [], subject, issues);
  if (!fields) return;
  if (fields.model !== null && fields.model !== undefined) {
    const hint = checkFields(
      fields.model,
      `${path}.model`,
      HINT_FIELDS,
      ["driverKind"],
      subject,
      issues,
    );
    checkList(hint?.modelOptions, `${path}.model.modelOptions`, subject, issues).forEach(
      (option, index) =>
        checkFields(
          option,
          `${path}.model.modelOptions.${index}`,
          OPTION_FIELDS,
          [],
          subject,
          issues,
        ),
    );
  }
  checkList(fields.exits, `${path}.exits`, subject, issues).forEach((exit, index) =>
    checkFields(exit, `${path}.exits.${index}`, EXIT_FIELDS, [], subject, issues),
  );
}

function checkFlowShape(flow: unknown, reader: FormatReader, issues: Issues) {
  const subject = "The Flow";
  const fields = checkFields(flow, "flow", FLOW_FIELDS, [], subject, issues);
  if (!fields) return;
  if ("graph" in fields) {
    const graphFields = reader.finish ? [...GRAPH_FIELDS, "finish"] : GRAPH_FIELDS;
    const graph = checkFields(fields.graph, "flow.graph", graphFields, [], subject, issues);
    checkList(graph?.blocks, "flow.graph.blocks", subject, issues).forEach((block, index) =>
      checkBlockShape(
        block,
        `flow.graph.blocks.${index}`,
        blockLabel(block, index),
        reader,
        issues,
      ),
    );
    checkList(graph?.connections, "flow.graph.connections", subject, issues).forEach(
      (connection, index) =>
        checkFields(
          connection,
          `flow.graph.connections.${index}`,
          CONNECTION_FIELDS,
          reader.finish ? ["targetEndingId"] : [],
          subject,
          issues,
        ),
    );
    if (graph && "finish" in graph) checkFinishShape(graph.finish, issues);
    if (graph && "flowInput" in graph) {
      const path = "flow.graph.flowInput";
      const input = checkFields(graph.flowInput, path, FLOW_INPUT_FIELDS, [], subject, issues);
      if (input && "position" in input)
        checkFields(input.position, `${path}.position`, POSITION_FIELDS, [], subject, issues);
    }
  }
  if ("workspace" in fields) checkWorkspaceShape(fields.workspace, issues);
}

function checkFinishShape(finish: unknown, issues: Issues) {
  const path = "flow.graph.finish";
  const subject = "The Flow's Finish block";
  const fields = checkFields(finish, path, FINISH_FIELDS, [], subject, issues);
  if (!fields) return;
  if ("position" in fields)
    checkFields(fields.position, `${path}.position`, POSITION_FIELDS, [], subject, issues);
  checkList(fields.endings, `${path}.endings`, subject, issues).forEach((ending, index) =>
    checkFields(ending, `${path}.endings.${index}`, ENDING_FIELDS, [], subject, issues),
  );
}

function checkBlockShape(
  block: unknown,
  path: string,
  subject: string,
  reader: FormatReader,
  issues: Issues,
) {
  const kindFields = isRecord(block) ? reader.kindFields.get(block.kind) : [];
  if (!kindFields) {
    issues.push(
      issue("invalid_block_kind", `${path}.kind`, `${subject}: use ${reader.kindChoice}.`),
    );
    return;
  }
  const fields = checkFields(block, path, [...BLOCK_FIELDS, ...kindFields], [], subject, issues);
  if (!fields) return;
  if ("position" in fields)
    checkFields(fields.position, `${path}.position`, POSITION_FIELDS, [], subject, issues);
  if (fields.kind === "agent")
    checkList(fields.localExits, `${path}.localExits`, subject, issues).forEach((exit, index) =>
      checkFields(exit, `${path}.localExits.${index}`, EXIT_FIELDS, [], subject, issues),
    );
  if (fields.kind === "wait" && fields.duration !== null && fields.duration !== undefined)
    checkFields(fields.duration, `${path}.duration`, DURATION_FIELDS, [], subject, issues);
  if (fields.kind === "condition") {
    checkList(fields.rules, `${path}.rules`, subject, issues).forEach((rule, index) =>
      checkFields(rule, `${path}.rules.${index}`, CONDITION_RULE_FIELDS, [], subject, issues),
    );
    if ("otherwise" in fields)
      checkFields(
        fields.otherwise,
        `${path}.otherwise`,
        CONDITION_OTHERWISE_FIELDS,
        [],
        subject,
        issues,
      );
  }
}

function checkWorkspaceShape(workspace: unknown, issues: Issues) {
  const subject = "The Flow's workspace";
  const worktree = isRecord(workspace) && workspace.mode === "worktree";
  const required = worktree ? ["mode", "base"] : ["mode"];
  const fields = checkFields(workspace, "flow.workspace", required, [], subject, issues);
  // Any other mode or base is the workspace validator's to report.
  if (!worktree || !isRecord(fields?.base)) return;
  const base = fields.base;
  checkFields(
    base,
    "flow.workspace.base",
    base.kind === "ref" ? ["kind", "ref"] : ["kind"],
    [],
    subject,
    issues,
  );
}

/**
 * Keys are well-formed and unique. An Agent file holds exactly one Agent; in a Flow file every
 * Agent block's key resolves or is null, and every bundled Agent is referenced.
 */
function referenceIssues(
  fields: Record<string, unknown>,
  agents: readonly Record<string, unknown>[],
): Issues {
  const issues: Issues = [];
  const flow = fields.kind === "flow";
  if (!flow && agents.length !== 1)
    issues.push(issue("invalid_agent_count", "agents", "An Agent file holds exactly one Agent."));
  const seen = new Set<unknown>();
  agents.forEach((agent, index) => {
    const path = `agents.${index}.key`;
    if (typeof agent.key !== "string" || !KEY_PATTERN.test(agent.key))
      issues.push(
        issue(
          "invalid_key",
          path,
          `${agentLabel(agent, index)} needs a key of up to 64 letters, digits, "-" or "_", starting with a letter.`,
        ),
      );
    else if (seen.has(agent.key))
      issues.push(issue("duplicate_key", path, `${agentLabel(agent, index)} repeats another key.`));
    seen.add(agent.key);
  });
  if (flow) issues.push(...agentKeyIssues(fields.flow as Record<string, unknown>, agents, seen));
  return issues;
}

/** The checked shape guarantees a Flow's graph of block objects. */
const flowBlocks = (flow: Record<string, unknown>) =>
  (flow.graph as { blocks: readonly Record<string, unknown>[] }).blocks;

function agentKeyIssues(
  flow: Record<string, unknown>,
  agents: readonly Record<string, unknown>[],
  keys: ReadonlySet<unknown>,
): Issues {
  const issues: Issues = [];
  const referenced = new Set<unknown>();
  flowBlocks(flow).forEach((block, index) => {
    if (block.kind !== "agent" || block.agentKey === null) return;
    if (typeof block.agentKey === "string" && keys.has(block.agentKey))
      referenced.add(block.agentKey);
    else
      issues.push(
        issue(
          "unknown_agent_key",
          `flow.graph.blocks.${index}.agentKey`,
          `${blockLabel(block, index)} names no Agent in this file; its agentKey must be a bundled Agent's key or null.`,
        ),
      );
  });
  agents.forEach((agent, index) => {
    if (!referenced.has(agent.key))
      issues.push(
        issue(
          "unreferenced_agent",
          `agents.${index}`,
          `${agentLabel(agent, index)} is bundled but no block of the Flow uses it.`,
        ),
      );
  });
  return issues;
}

/** Each issue of one Agent, addressed under `agents.N` and naming the Agent. */
function agentIssues(result: Result<unknown>, prefix: string, subject: string): Issues {
  if (result.ok) return [];
  return result.error.issues.map((entry) =>
    issue(entry.code, `${prefix}.${entry.path}`, `${subject}: ${entry.message}`),
  );
}

function decodeHint(
  model: unknown,
  path: string,
  subject: string,
): Result<PortableModelHint | null> {
  if (model === null) return { ok: true, value: null };
  const hint = model as Record<string, unknown>;
  const { driverKind } = hint;
  if (
    driverKind !== undefined &&
    (typeof driverKind !== "string" || driverKind.trim().length === 0 || driverKind.length > 512)
  )
    return rejected("validation", [
      issue(
        "invalid_driver_kind",
        `${path}.driverKind`,
        `${subject}: the driver kind is not valid.`,
      ),
    ]);
  const reference = validateModelReference(hint, path);
  if (!reference.ok)
    return rejected(
      "validation",
      reference.error.issues.map((entry) => ({
        ...entry,
        message: `${subject}: ${entry.message}`,
      })),
    );
  return {
    ok: true,
    value: {
      ...(driverKind === undefined ? {} : { driverKind: driverKind.trim() }),
      ...reference.value,
    },
  };
}

/** The issue when an imported Agent's later save request would exceed the definition limit. */
function definitionSizeIssue(
  agent: PortableAgent,
  path: string,
  execution: unknown,
): ValidationIssue | undefined {
  const { name, prompt, exits } = agent;
  return !definitionSaveFits({ name, prompt, execution, exits })
    ? issue(
        "definition_too_large",
        path,
        `Agent "${agent.name}" is larger than the 2 MB a definition may be.`,
      )
    : undefined;
}

function decodeAgent(entry: Record<string, unknown>, index: number): Result<PortableAgent> {
  const prefix = `agents.${index}`;
  const subject = agentLabel(entry, index);
  const validated = validateCreateAgent({ ...entry, execution: null });
  const hint = decodeHint(entry.model, `${prefix}.model`, subject);
  const issues = [
    ...agentIssues(validated, prefix, subject),
    ...(hint.ok ? [] : hint.error.issues),
  ];
  if (!validated.ok || !hint.ok) return rejected("validation", issues);
  const { name, prompt, exits } = validated.value;
  return { ok: true, value: { key: entry.key as string, name, prompt, model: hint.value, exits } };
}

function decodeAgents(entries: readonly Record<string, unknown>[]): Result<PortableAgent[]> {
  const decoded = entries.map(decodeAgent);
  const invalid = decoded.flatMap((result) => (result.ok ? [] : result.error.issues));
  if (invalid.length > 0) return rejected("validation", invalid);
  const agents = decoded.map((result) => (result as { value: PortableAgent }).value);
  const oversized = agents.flatMap(
    (agent, index) => definitionSizeIssue(agent, `agents.${index}`, agent.model) ?? [],
  );
  if (oversized.length > 0) return rejected("too_large", oversized);
  return { ok: true, value: agents };
}

/**
 * The envelope in a fixed field order under the file's own version, which the import receipt's
 * fingerprint relies on: a version-1 commit retried after an upgrade still matches its receipt.
 */
const envelopeOf = <Kind extends PortableDocument["kind"]>(
  fields: Record<string, unknown>,
  reader: FormatReader,
  kind: Kind,
) => ({
  format: PORTABLE_DOCUMENT_FORMAT as typeof PORTABLE_DOCUMENT_FORMAT,
  formatVersion: reader.version,
  kind,
  factoryVersion: fields.factoryVersion as string,
  exportedAt: fields.exportedAt as string,
});

function agentDocument(
  fields: Record<string, unknown>,
  reader: FormatReader,
  entries: readonly Record<string, unknown>[],
): Result<ImportedDocument> {
  const agents = decodeAgents(entries);
  if (!agents.ok) return agents;
  return {
    ok: true,
    value: { ...envelopeOf(fields, reader, "agent"), agents: [agents.value[0]!] },
  };
}

function flowDocument(
  fields: Record<string, unknown>,
  reader: FormatReader,
  entries: readonly Record<string, unknown>[],
): Result<ImportedDocument> {
  const agents = decodeAgents(entries);
  if (!agents.ok) return agents;
  const flow = decodeFlow(fields.flow as Record<string, unknown>, reader);
  if (!flow.ok) return flow;
  return {
    ok: true,
    value: { ...envelopeOf(fields, reader, "flow"), flow: flow.value, agents: agents.value },
  };
}

/** A Flow issue addressed under `flow`, naming its block when it has one. */
function flowIssue(entry: ValidationIssue, blocks: readonly unknown[]): ValidationIssue {
  const block = /^graph\.blocks\.(\d+)/.exec(entry.path);
  const index = Number(block?.[1]);
  const subject = block ? blockLabel(blocks[index], index) : "The Flow";
  const path = entry.path.replace(/^(graph\.blocks\.\d+)\.agentId$/, "$1.agentKey");
  return issue(entry.code, `flow.${path}`, `${subject}: ${entry.message}`);
}

/** The Flow domain validator over the file's Flow, with each Agent block's key in its id's place. */
function decodeFlow(flow: Record<string, unknown>, reader: FormatReader): Result<PortableFlow> {
  const blocks = flowBlocks(flow);
  const validated = validateCreateFlow(
    {
      ...flow,
      graph: {
        ...(flow.graph as Record<string, unknown>),
        blocks: blocks.map(({ agentKey, ...block }) =>
          block.kind === "agent" ? { ...block, agentId: agentKey } : block,
        ),
      },
    },
    "portable",
  );
  if (!validated.ok)
    return rejected(
      "validation",
      validated.error.issues.map((entry) => flowIssue(entry, blocks)),
    );
  const { name, graph, workspace } = validated.value;
  // The checked shape required every position, Revisit instruction and the workspace.
  const decoded: PortableFlow = {
    name,
    workspace: workspace as FlowWorkspace,
    graph: {
      flowInput: graph!.flowInput as FlowInputBlock,
      connections: graph!.connections,
      blocks: graph!.blocks.map(portableBlock),
      ...(reader.finish ? { finish: graph!.finish as FlowFinishBlock } : {}),
    },
  };
  const oversized = flowSizeIssue(decoded);
  return oversized ? rejected("too_large", [oversized]) : { ok: true, value: decoded };
}

function portableBlock(block: FlowBlockInput): PortableFlowBlock {
  if (block.kind !== "agent") return block as PortableFlowBlock;
  const { agentId, ...rest } = block;
  return { ...rest, agentKey: agentId } as PortableFlowBlock;
}

/** A created Agent's id has this length, so the Flow's save request is measured exactly. */
const CREATED_AGENT_ID = "00000000-0000-4000-8000-000000000000";

/** The issue when the imported Flow's later save request would exceed the definition limit. */
function flowSizeIssue(flow: PortableFlow): ValidationIssue | undefined {
  const blocks = flow.graph.blocks.map((block) => {
    if (block.kind !== "agent") return block;
    const { agentKey, ...rest } = block;
    return { ...rest, agentId: agentKey === null ? null : CREATED_AGENT_ID };
  });
  const request = { name: flow.name, graph: { ...flow.graph, blocks }, workspace: flow.workspace };
  return !definitionSaveFits(request)
    ? issue(
        "definition_too_large",
        "flow",
        `Flow "${flow.name}" is larger than the 2 MB a definition may be.`,
      )
    : undefined;
}

function decodeSelection(
  agent: PortableAgent,
  value: unknown,
): Result<AgentExecutionSettings | null> {
  const path = `selections.${agent.key}`;
  if (value === undefined)
    return rejected("validation", [
      issue("selection_required", path, `Agent "${agent.name}": choose a model or Needs a model.`),
    ]);
  if (value === null) return { ok: true, value: null };
  const execution = validateExecutionSettings(value);
  if (execution.ok) return execution;
  return rejected(
    "validation",
    execution.error.issues.map((entry) =>
      issue(
        entry.code,
        entry.path.replace(/^execution/, path),
        `Agent "${agent.name}": ${entry.message}`,
      ),
    ),
  );
}

/** The reviewed choice for exactly the document's Agents, in document order. */
function decodeSelections(
  document: ImportedDocument,
  value: unknown,
): Result<Record<string, AgentExecutionSettings | null>> {
  if (!isRecord(value))
    return rejected("validation", [
      issue("invalid_selections", "selections", "Send a model choice for every imported Agent."),
    ]);
  const keys = new Set(document.agents.map((agent) => agent.key));
  const issues: Issues = Object.keys(value)
    .filter((key) => !keys.has(key))
    .map((key) =>
      issue(
        "unknown_selection",
        shownField("selections", key),
        "A model choice names an Agent the file does not have.",
      ),
    );
  const selections: Record<string, AgentExecutionSettings | null> = {};
  for (const agent of document.agents) {
    const selection = decodeSelection(
      agent,
      Object.hasOwn(value, agent.key) ? value[agent.key] : undefined,
    );
    if (selection.ok) selections[agent.key] = selection.value;
    else issues.push(...selection.error.issues);
  }
  if (issues.length > 0) return rejected("validation", issues);
  return { ok: true, value: selections };
}

/**
 * A commit: its request id, the document decoded as review decodes it, and complete selections,
 * each definition's save request within the definition limit.
 */
export function validateCommitImport(input: unknown): Result<CommitImportInput> {
  const fields = isRecord(input) ? input : {};
  const { requestId } = fields;
  if (typeof requestId !== "string" || requestId.trim().length === 0 || requestId.length > 256)
    return rejected("validation", [
      issue("invalid_request_id", "requestId", "Send a request id of up to 256 characters."),
    ]);
  if (jsonByteLength(fields.document) > PORTABLE_DOCUMENT_LIMIT_BYTES) return documentTooLarge();
  const document = decodePortableDocument(fields.document);
  if (!document.ok) return document;
  const selections = decodeSelections(document.value, fields.selections);
  if (!selections.ok) return selections;
  const oversized = document.value.agents.flatMap(
    (agent, index) =>
      definitionSizeIssue(agent, `agents.${index}`, selections.value[agent.key]) ?? [],
  );
  if (oversized.length > 0) return rejected("too_large", oversized);
  const projectId = parseOwningProject(fields);
  if (!projectId.ok) return projectId;
  return {
    ok: true,
    value: {
      requestId,
      document: document.value,
      selections: selections.value,
      projectId: projectId.value,
    },
  };
}
