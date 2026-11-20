import type {
  Result,
  RunTriggerInput,
  SetTriggerEnabledInput,
  TriggerKind,
  TriggerSchedule,
  UpdateTriggerInput,
} from "@t3-factory/contracts";
import { invalid } from "./agent.ts";

const TRIGGER_KINDS: readonly TriggerKind[] = ["github_issues"];
const TRIGGER_NAME_LIMIT = 200;
const TRIGGER_QUERY_LIMIT = 1000;
const TRIGGER_INTERVAL_MIN_MINUTES = 1;
const TRIGGER_INTERVAL_MAX_MINUTES = 24 * 60;
const TRIGGER_MAX_ACTIVE_RUNS_LIMIT = 10;
/** What a new Trigger starts with; the create form shows the same values. */
export const TRIGGER_DEFAULTS = {
  query: "label:factory:ready author:@me",
  schedule: { enabled: true, intervalMinutes: 5 },
  maxActiveRuns: 1,
} as const;

/** A query that passed the rule, with what Factory derives from it. */
interface TriggerQuery {
  readonly query: string;
  /** The single positive `label:` qualifier's value. */
  readonly readyLabel: string;
  /** Whether a positive `author:` qualifier limits whose issues match. */
  readonly authorFilter: boolean;
}

/** Validated GitHub Issues settings: the confirmed repository and the derived query facts. */
export interface TriggerSettings extends Omit<UpdateTriggerInput, "expectedRevision" | "github"> {
  readonly github: TriggerQuery & { readonly repositoryNodeId: string };
}

const QUERY_PATH = "github.query";

const queryRefusal = (code: string, message: string) => invalid(code, QUERY_PATH, message);

/** Qualifiers that would widen or contradict the bound repository, issue type or open state. */
const SCOPE_QUALIFIERS = ["repo", "org", "user", "is", "state", "type", "project"];

interface QueryTerm {
  readonly text: string;
  /** Parentheses the term sits inside. */
  readonly depth: number;
}

/** Whitespace-separated terms; quotes keep spaces and parentheses, which are terms themselves. */
function queryTerms(query: string): QueryTerm[] {
  const terms: QueryTerm[] = [];
  let current = "";
  let quoted = false;
  let depth = 0;
  const flush = () => {
    if (current) terms.push({ text: current, depth });
    current = "";
  };
  for (const character of query) {
    if (character === '"') quoted = !quoted;
    if (quoted || character === '"') current += character;
    else if (/\s/.test(character)) flush();
    else if (character === "(" || character === ")") {
      flush();
      terms.push({ text: character, depth });
      depth += character === "(" ? 1 : -1;
    } else current += character;
  }
  flush();
  return terms;
}

interface Qualifier {
  readonly name: string;
  /** The value without surrounding quotes. */
  readonly value: string;
  readonly negated: boolean;
  readonly depth: number;
}

function qualifier(term: QueryTerm, previous: QueryTerm | undefined): Qualifier | undefined {
  const match = /^(-?)([a-zA-Z_-]+):(.*)$/s.exec(term.text);
  if (!match) return undefined;
  const raw = match[3]!;
  return {
    name: match[2]!.toLowerCase(),
    value: raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw,
    negated: match[1] === "-" || previous?.text === "NOT",
    depth: term.depth,
  };
}

function queryQualifiers(terms: readonly QueryTerm[]): Qualifier[] {
  return terms.flatMap((term, index) => qualifier(term, terms[index - 1]) ?? []);
}

/** Refuses scope qualifiers and `no:label`, which no ready label can coexist with. */
function forbiddenQualifier(qualifiers: readonly Qualifier[]): Result<never> | undefined {
  const scope = qualifiers.find((entry) => SCOPE_QUALIFIERS.includes(entry.name));
  if (scope)
    return queryRefusal(
      "trigger_query_scope",
      `Remove "${scope.name}:". Factory always reads open issues in the Project's repository, so a query cannot choose the repository, owner, type, state or project.`,
    );
  if (qualifiers.some((entry) => entry.name === "no" && entry.value.toLowerCase() === "label"))
    return queryRefusal(
      "trigger_query_no_label",
      'Remove "no:label". It matches issues without labels, so no label can mark an issue as ready. Use one label: qualifier, such as label:factory:ready.',
    );
  return undefined;
}

/** The single positive `label:` that is the ready label, or why the query has none. */
function readyLabel(terms: readonly QueryTerm[], qualifiers: readonly Qualifier[]): Result<string> {
  const labels = qualifiers.filter((entry) => entry.name === "label");
  const positive = labels.filter((entry) => !entry.negated);
  if (positive.length === 0)
    return labels.length > 0
      ? queryRefusal(
          "trigger_query_label_negated",
          "A negated label excludes issues, so it cannot mark them as ready. Add one positive label: qualifier, such as label:factory:ready.",
        )
      : queryRefusal(
          "trigger_query_label_missing",
          "Add one label: qualifier, such as label:factory:ready. Its label marks an issue as ready to start.",
        );
  if (positive.length > 1)
    return queryRefusal(
      "trigger_query_label_multiple",
      "Use exactly one positive label: qualifier. Its label marks an issue as ready; exclude other labels with -label:.",
    );
  const [label] = positive as [Qualifier];
  if (label.value.includes(","))
    return queryRefusal(
      "trigger_query_label_or",
      `Name one label in label:${label.value}. A comma matches any of several labels, so no single label would mark an issue as ready.`,
    );
  if (label.value.trim() === "")
    return queryRefusal("trigger_query_label_missing", "Name the ready label after label:.");
  if (label.depth > 0)
    return queryRefusal(
      "trigger_query_parentheses",
      "Move label: out of the parentheses. Every matching issue must carry the ready label.",
    );
  if (terms.some((term) => term.depth === 0 && term.text === "OR"))
    return queryRefusal(
      "trigger_query_or",
      "Put OR alternatives in parentheses. An OR beside label: would match issues without the ready label.",
    );
  if (labels.some((entry) => entry.negated && entry.value === label.value))
    return queryRefusal(
      "trigger_query_label_negated",
      `The query both requires and excludes ${label.value}, so it can never match.`,
    );
  return { ok: true, value: label.value };
}

/**
 * The GitHub issue query rule: exactly one positive `label:` names the ready label, outside any
 * OR or parentheses, and nothing may choose the repository, issue type or open state.
 */
export function parseTriggerQuery(input: unknown): Result<TriggerQuery> {
  const query = typeof input === "string" ? input.trim() : "";
  if (!query || query.length > TRIGGER_QUERY_LIMIT)
    return queryRefusal(
      "trigger_query",
      `Enter a GitHub issue query up to ${TRIGGER_QUERY_LIMIT} characters.`,
    );
  const terms = queryTerms(query);
  const qualifiers = queryQualifiers(terms);
  const forbidden = forbiddenQualifier(qualifiers);
  if (forbidden) return forbidden;
  const label = readyLabel(terms, qualifiers);
  if (!label.ok) return label;
  return {
    ok: true,
    value: {
      query,
      readyLabel: label.value,
      authorFilter: qualifiers.some((entry) => entry.name === "author" && !entry.negated),
    },
  };
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Trigger input carries typed settings only; a command, flag, path or environment never fits. */
function unknownField(
  fields: Record<string, unknown>,
  allowed: readonly string[],
  prefix = "",
): Result<never> | undefined {
  const extra = Object.keys(fields).find((key) => !allowed.includes(key));
  return extra === undefined
    ? undefined
    : invalid(
        "trigger_unknown_field",
        `${prefix}${extra}`,
        `"${prefix}${extra}" is not a Trigger setting. Triggers accept only their typed settings, never commands, flags, paths or environment values.`,
      );
}

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const text = (value: unknown, path: string, max: number, message: string): Result<string> => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed.length <= max
    ? { ok: true, value: trimmed }
    : invalid(`trigger_${path.replaceAll(".", "_").toLowerCase()}`, path, message);
};

export function validateTriggerSchedule(value: unknown): Result<TriggerSchedule> {
  const fields = record(value);
  if (!fields)
    return invalid("trigger_schedule", "schedule", "Say whether the schedule is on and how often.");
  const extra = unknownField(fields, ["enabled", "intervalMinutes"], "schedule.");
  if (extra) return extra;
  if (typeof fields.enabled !== "boolean")
    return invalid("trigger_schedule", "schedule.enabled", "Say whether the schedule is on.");
  if (
    !isIntegerIn(fields.intervalMinutes, TRIGGER_INTERVAL_MIN_MINUTES, TRIGGER_INTERVAL_MAX_MINUTES)
  )
    return invalid(
      "trigger_interval",
      "schedule.intervalMinutes",
      "Check every 1 minute to 24 hours, in whole minutes.",
    );
  return { ok: true, value: { enabled: fields.enabled, intervalMinutes: fields.intervalMinutes } };
}

export function validateTriggerLimit(value: unknown): Result<number> {
  return isIntegerIn(value, 1, TRIGGER_MAX_ACTIVE_RUNS_LIMIT)
    ? { ok: true, value }
    : invalid(
        "trigger_max_active_runs",
        "maxActiveRuns",
        `Allow 1 to ${TRIGGER_MAX_ACTIVE_RUNS_LIMIT} active Runs.`,
      );
}

function parseGitHub(value: unknown, defaults: boolean): Result<TriggerSettings["github"]> {
  const fields = record(value);
  if (!fields)
    return invalid(
      "trigger_repository",
      "github.repositoryNodeId",
      "Confirm the Project's repository.",
    );
  const extra = unknownField(fields, ["repositoryNodeId", "query"], "github.");
  if (extra) return extra;
  const repositoryNodeId = text(
    fields.repositoryNodeId,
    "github.repositoryNodeId",
    256,
    "Confirm the Project's repository.",
  );
  if (!repositoryNodeId.ok) return repositoryNodeId;
  const query = parseTriggerQuery(
    defaults && fields.query === undefined ? TRIGGER_DEFAULTS.query : fields.query,
  );
  if (!query.ok) return query;
  return { ok: true, value: { ...query.value, repositoryNodeId: repositoryNodeId.value } };
}

const SETTING_KEYS = ["kind", "name", "projectId", "flowId", "schedule", "maxActiveRuns", "github"];

/** Shared by create and update; `defaults` fills the settings a create may leave out. */
function parseSettings(
  fields: Record<string, unknown>,
  defaults: boolean,
): Result<TriggerSettings> {
  if (!TRIGGER_KINDS.includes(fields.kind as TriggerKind))
    return invalid("trigger_kind", "kind", "Choose a Trigger type: GitHub Issues (github_issues).");
  const name = text(
    fields.name,
    "name",
    TRIGGER_NAME_LIMIT,
    `Enter a Trigger name between 1 and ${TRIGGER_NAME_LIMIT} characters.`,
  );
  if (!name.ok) return name;
  const projectId = text(fields.projectId, "projectId", 256, "Choose a Project.");
  if (!projectId.ok) return projectId;
  const flowId = text(fields.flowId, "flowId", 256, "Choose a Flow.");
  if (!flowId.ok) return flowId;
  const schedule = validateTriggerSchedule(
    defaults && fields.schedule === undefined ? TRIGGER_DEFAULTS.schedule : fields.schedule,
  );
  if (!schedule.ok) return schedule;
  const maxActiveRuns = validateTriggerLimit(
    defaults && fields.maxActiveRuns === undefined
      ? TRIGGER_DEFAULTS.maxActiveRuns
      : fields.maxActiveRuns,
  );
  if (!maxActiveRuns.ok) return maxActiveRuns;
  const github = parseGitHub(fields.github, defaults);
  if (!github.ok) return github;
  return {
    ok: true,
    value: {
      kind: fields.kind as TriggerKind,
      name: name.value,
      projectId: projectId.value,
      flowId: flowId.value,
      schedule: schedule.value,
      maxActiveRuns: maxActiveRuns.value,
      github: github.value,
    },
  };
}

/** A new Trigger; schedule, Max active Runs and query take their defaults when left out. */
export function validateCreateTrigger(input: unknown): Result<TriggerSettings> {
  const fields = record(input) ?? {};
  return unknownField(fields, SETTING_KEYS) ?? parseSettings(fields, true);
}

/** A complete replacement of a saved Trigger's settings, from the revision the edit started at. */
export function validateUpdateTrigger(
  input: unknown,
): Result<TriggerSettings & Pick<UpdateTriggerInput, "expectedRevision">> {
  const fields = record(input) ?? {};
  const extra = unknownField(fields, [...SETTING_KEYS, "expectedRevision"]);
  if (extra) return extra;
  if (!isIntegerIn(fields.expectedRevision, 1, Number.MAX_SAFE_INTEGER))
    return invalid(
      "trigger_revision",
      "expectedRevision",
      "Name the saved revision these edits start from.",
    );
  const settings = parseSettings(fields, false);
  if (!settings.ok) return settings;
  return { ok: true, value: { ...settings.value, expectedRevision: fields.expectedRevision } };
}

/** A manual check: the revision it is bound to is optional, and nothing else is accepted. */
export function validateRunTrigger(input: unknown): Result<RunTriggerInput> {
  const fields = record(input) ?? {};
  const extra = unknownField(fields, ["expectedRevision"]);
  if (extra) return extra;
  if (fields.expectedRevision === undefined) return { ok: true, value: {} };
  if (!isIntegerIn(fields.expectedRevision, 1, Number.MAX_SAFE_INTEGER))
    return invalid(
      "trigger_revision",
      "expectedRevision",
      "Name the saved revision to check, a positive whole number.",
    );
  return { ok: true, value: { expectedRevision: fields.expectedRevision } };
}

export function validateSetTriggerEnabled(input: unknown): Result<SetTriggerEnabledInput> {
  const fields = record(input) ?? {};
  if (fields.enabled === false)
    return unknownField(fields, ["enabled"]) ?? { ok: true, value: { enabled: false } };
  if (fields.enabled !== true)
    return invalid("trigger_enabled", "enabled", "Say whether the Trigger is enabled.");
  const extra = unknownField(fields, ["enabled", "reviewedRevision"]);
  if (extra) return extra;
  if (!isIntegerIn(fields.reviewedRevision, 1, Number.MAX_SAFE_INTEGER))
    return invalid(
      "trigger_revision",
      "reviewedRevision",
      "Name the saved revision whose preview was reviewed before enabling.",
    );
  return { ok: true, value: { enabled: true, reviewedRevision: fields.reviewedRevision } };
}
