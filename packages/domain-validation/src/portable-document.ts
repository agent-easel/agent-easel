import {
  PORTABLE_DOCUMENT_FORMAT,
  PORTABLE_DOCUMENT_VERSION,
  type AgentExecutionSettings,
  type CommitImportInput,
  type OperationError,
  type PortableAgent,
  type PortableAgentDocument,
  type PortableDocument,
  type PortableModelHint,
  type Result,
  type ValidationIssue,
} from "@t3-factory/contracts";
import { validateCreateAgent, validateExecutionSettings, validateModelReference } from "./agent.ts";
import { isRecord } from "./block-exits.ts";

/** The largest create or save request for one Agent or Flow definition. */
export const DEFINITION_REQUEST_LIMIT_BYTES = 2_000_000;

/** The largest portable document an import accepts (16 MiB). */
export const PORTABLE_DOCUMENT_LIMIT_BYTES = 16_777_216;

/** The most Agents one portable document may bundle. */
export const PORTABLE_DOCUMENT_AGENT_LIMIT = 500;

/** The exact file text of a portable document; export measures this text against the import limit. */
export function portableDocumentText(document: PortableAgentDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

const jsonByteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

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
const AGENT_FIELDS = ["key", "name", "prompt", "model", "exits"];
const HINT_FIELDS = ["providerInstanceId", "modelId", "modelOptions"];
const OPTION_FIELDS = ["id", "value"];
const EXIT_FIELDS = ["id", "name", "description", "messageRequired"];

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
export function parsePortableFile(data: Uint8Array): Result<PortableDocument> {
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
 * Strict version-1 decoding, in order: the marker and version, the Agent count, unknown or missing
 * fields at every level, closed key references, then the Agent domain validators and each
 * definition's save size. Messages name Agents and fields, never prompt text.
 */
function decodePortableDocument(value: unknown): Result<PortableDocument> {
  const envelope = checkEnvelope(value);
  if (!envelope.ok) return envelope;
  const fields = envelope.value;
  const agents = fields.agents;
  if (Array.isArray(agents) && agents.length > PORTABLE_DOCUMENT_AGENT_LIMIT)
    return rejected("too_large", [
      issue(
        "too_many_agents",
        "agents",
        `This file bundles ${agents.length} Agents; an import accepts at most ${PORTABLE_DOCUMENT_AGENT_LIMIT}.`,
      ),
    ]);
  const shape = shapeIssues(fields);
  if (shape.length > 0) return rejected("validation", shape);
  const entries = agents as readonly Record<string, unknown>[];
  const references = referenceIssues(entries);
  if (references.length > 0) return rejected("validation", references);
  return agentDocument(fields, entries);
}

function checkEnvelope(value: unknown): Result<Record<string, unknown>> {
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
  if (version !== PORTABLE_DOCUMENT_VERSION)
    return rejected("validation", [
      issue(
        "unsupported_format_version",
        "formatVersion",
        (version as number) > PORTABLE_DOCUMENT_VERSION
          ? `This file uses format version ${version as number}, which this Factory cannot read. Update Factory to import it.`
          : `This file uses format version ${version as number}, which Factory cannot read.`,
      ),
    ]);
  if (value.kind === "flow")
    return rejected("validation", [
      issue("unsupported_kind", "kind", "This Factory cannot import Flow files yet."),
    ]);
  if (value.kind !== "agent")
    return rejected("validation", [
      issue("invalid_kind", "kind", "A Factory export is an Agent file or a Flow file."),
    ]);
  return { ok: true, value };
}

/** How messages name an Agent: its name when the file gives a usable one, else its position. */
function agentLabel(agent: unknown, index: number): string {
  const name = isRecord(agent) ? agent.name : undefined;
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 200
    ? `Agent "${name.trim()}"`
    : `Agent ${index + 1}`;
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

function shapeIssues(fields: Record<string, unknown>): Issues {
  const issues: Issues = [];
  const document = checkFields(fields, "document", ENVELOPE_FIELDS, [], "The file", issues);
  for (const field of ["factoryVersion", "exportedAt"])
    if (field in fields && typeof fields[field] !== "string")
      issues.push(issue("invalid_field", field, `The file's ${field} must be text.`));
  const agents = checkList(document?.agents, "agents", "The file", issues);
  agents.forEach((agent, index) =>
    checkAgentShape(agent, `agents.${index}`, agentLabel(agent, index), issues),
  );
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

/** Keys are well-formed and unique, and an Agent file holds exactly one Agent. */
function referenceIssues(agents: readonly Record<string, unknown>[]): Issues {
  const issues: Issues = [];
  if (agents.length !== 1)
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

/** The issue when an imported Agent's save request would exceed the definition limit. */
function definitionSizeIssue(
  agent: PortableAgent,
  path: string,
  execution: unknown,
): ValidationIssue | undefined {
  const { name, prompt, exits } = agent;
  return jsonByteLength({ name, prompt, execution, exits }) > DEFINITION_REQUEST_LIMIT_BYTES
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

function agentDocument(
  fields: Record<string, unknown>,
  entries: readonly Record<string, unknown>[],
): Result<PortableDocument> {
  const decoded = entries.map(decodeAgent);
  const invalid = decoded.flatMap((result) => (result.ok ? [] : result.error.issues));
  if (invalid.length > 0) return rejected("validation", invalid);
  const agents = decoded.map((result) => (result as { value: PortableAgent }).value);
  const oversized = agents.flatMap(
    (agent, index) => definitionSizeIssue(agent, `agents.${index}`, agent.model) ?? [],
  );
  if (oversized.length > 0) return rejected("too_large", oversized);
  return {
    ok: true,
    value: {
      format: PORTABLE_DOCUMENT_FORMAT,
      formatVersion: PORTABLE_DOCUMENT_VERSION,
      kind: "agent",
      factoryVersion: fields.factoryVersion as string,
      exportedAt: fields.exportedAt as string,
      agents: [agents[0]!],
    },
  };
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
  document: PortableDocument,
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
  return {
    ok: true,
    value: { requestId, document: document.value, selections: selections.value },
  };
}
