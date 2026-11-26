import type {
  DiagnosticAttempt,
  DiagnosticEntry,
  DiagnosticEnvironment,
  DiagnosticOperation,
  DiagnosticStep,
  DiagnosticStepOutcome,
  Result,
} from "@agent-easel/contracts";

export const DIAGNOSTIC_RECORDING_MS = 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_ENTRY_LIMIT = 10_000;
export const DIAGNOSTIC_ATTEMPT_PAGE_LIMIT = 100;

const VERSION = /^(?:\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.]{1,32})?|source|unrecognized)$/;
const PLACEHOLDER_PATH =
  /^(?:(?:~|<T3_STATE>|<CODEX_HOME>)(?:\/[A-Za-z0-9._-]{1,64}){0,8}|(?:~|<T3_STATE>|<CODEX_HOME>)\/<REDACTED>|<OTHER>)$/;

export function diagnosticVersion(value: unknown): string {
  return typeof value === "string" && VERSION.test(value) ? value : "unrecognized";
}

export type DiagnosticPathPlaceholder = "~" | "<T3_STATE>" | "<CODEX_HOME>";

export function diagnosticPath(
  path: string,
  roots: readonly { readonly root: string; readonly placeholder: DiagnosticPathPlaceholder }[],
): string {
  const normalized = path.replace(/\/+$/, "");
  const match = roots
    .filter(({ root }) => normalized === root || normalized.startsWith(`${root}/`))
    .toSorted((left, right) => right.root.length - left.root.length)[0];
  if (match === undefined) return "<OTHER>";
  const candidate = match.placeholder + normalized.slice(match.root.length);
  return placeholderPath(candidate) ? candidate : `${match.placeholder}/<REDACTED>`;
}

const LOOPBACK_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|\[?::ffff:127(?:\.\d{1,3}){3}\]?)$/i;

export const diagnosticHost = (hostname: string): "loopback" | "non-loopback" =>
  LOOPBACK_HOST.test(hostname) ? "loopback" : "non-loopback";

type FieldCheck = (value: unknown) => boolean;

const oneOf =
  (...values: readonly unknown[]): FieldCheck =>
  (value) =>
    values.includes(value);
const nullable =
  (check: FieldCheck): FieldCheck =>
  (value) =>
    value === null || check(value);
const version: FieldCheck = (value) => typeof value === "string" && VERSION.test(value);
const placeholderPath: FieldCheck = (value) =>
  typeof value === "string" &&
  PLACEHOLDER_PATH.test(value) &&
  !value.split("/").some((segment) => segment === "." || segment === "..");
const stepOutcome = oneOf("ok", "failed", "skipped");
const host = oneOf("loopback", "non-loopback");

const steps: readonly DiagnosticStep[] = ["backend_start", "t3_detection", "start_preconditions"];

const entryFields: { readonly [T in DiagnosticEntry["type"]]: Record<string, FieldCheck> } = {
  backend_start: {
    outcome: oneOf("ok"),
    applicationVersion: version,
    mode: oneOf("desktop", "source"),
    nodeVersion: version,
    dataHome: placeholderPath,
  },
  t3_detection: {
    outcome: stepOutcome,
    reason: oneOf(
      "runtime_file_found",
      "runtime_file_missing",
      "runtime_file_unreadable",
      "runtime_file_malformed",
      "runtime_origin_invalid",
      "runtime_endpoint_refused",
    ),
    file: placeholderPath,
    host: nullable(host),
    t3Version: nullable(version),
  },
  unexpected_error: {
    outcome: oneOf("failed"),
    step: oneOf(...steps),
    reason: oneOf("unexpected_error"),
  },
};

const refusal = (message: string): Result<never> => ({
  ok: false,
  error: { code: "validation", message, issues: [{ code: "diagnostic_entry", path: "", message }] },
});

export function validateDiagnosticEntry(input: unknown): Result<DiagnosticEntry> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return refusal("A diagnostic entry is an object.");
  const { type, ...fields } = input as Record<string, unknown>;
  if (typeof type !== "string" || !Object.hasOwn(entryFields, type))
    return refusal("A diagnostic entry has a known type.");
  const allowed = entryFields[type as DiagnosticEntry["type"]];
  const unknown = Object.keys(fields).find((key) => !Object.hasOwn(allowed, key));
  if (unknown !== undefined) return refusal(`A ${type} entry has no ${unknown} field.`);
  const invalid = Object.entries(allowed).find(
    ([key, check]) => !Object.hasOwn(fields, key) || !check(fields[key]),
  );
  if (invalid !== undefined) return refusal(`A ${type} entry needs a valid ${invalid[0]}.`);
  return { ok: true, value: input as DiagnosticEntry };
}

const operationNames: Record<DiagnosticOperation, string> = {
  backend_start: "Start backend",
  t3_detection: "Detect T3 Code",
};

const stepNames: Record<DiagnosticStep, string> = {
  backend_start: "backend start",
  t3_detection: "T3 Code detection",
  start_preconditions: "Start readiness checks",
};

export const diagnosticOperationName = (operation: DiagnosticOperation) =>
  operationNames[operation];

export interface DiagnosticStepLine {
  readonly outcome: DiagnosticStepOutcome;
  readonly name: string;
  readonly detail: string | null;
  readonly reason: string | null;
}

const joined = (...parts: readonly (string | null)[]) =>
  parts.filter((part) => part !== null).join(" · ");

export function describeDiagnosticEntry(entry: DiagnosticEntry): DiagnosticStepLine {
  switch (entry.type) {
    case "backend_start":
      return {
        outcome: entry.outcome,
        name: "Start AgentEasel backend",
        detail: joined(
          `AgentEasel ${entry.applicationVersion}`,
          entry.mode,
          `Node ${entry.nodeVersion}`,
          `data ${entry.dataHome}`,
        ),
        reason: null,
      };
    case "t3_detection":
      return {
        outcome: entry.outcome,
        name: "Read T3 Code runtime file",
        detail: joined(
          entry.file,
          entry.host,
          entry.t3Version === null ? null : `T3 Code ${entry.t3Version}`,
        ),
        reason: entry.reason,
      };
    case "unexpected_error":
      return {
        outcome: entry.outcome,
        name: `Unexpected error during ${stepNames[entry.step]}`,
        detail: null,
        reason: entry.reason,
      };
  }
}

const outcomeMarks: Record<DiagnosticStepOutcome, string> = {
  ok: "ok  ",
  failed: "fail",
  skipped: "skip",
};

function environmentLines(environment: DiagnosticEnvironment): string[] {
  const harnesses = environment.harnesses.length
    ? environment.harnesses.map((harness) => `${harness.driver} ${harness.status}`).join(", ")
    : "none found";
  return [
    `- AgentEasel ${environment.applicationVersion} (${environment.mode})`,
    `- T3 Code ${environment.t3Version ?? "unknown"}`,
    `- ${environment.os}/${environment.arch}, installation ${environment.installation}`,
    `- Harnesses: ${harnesses}`,
  ];
}

const sameEnvironment = (left: DiagnosticEnvironment, right: DiagnosticEnvironment) =>
  JSON.stringify(left) === JSON.stringify(right);

function attemptLines(attempt: DiagnosticAttempt, header: DiagnosticEnvironment): string[] {
  const title = `### ${operationNames[attempt.operation]} · ${attempt.startedAt.slice(0, 16).replace("T", " ")} UTC · ${attempt.outcome ?? "incomplete"}`;
  const steps = attempt.entries.map(({ at, entry }) => {
    const line = describeDiagnosticEntry(entry);
    return [at.slice(11, 23), outcomeMarks[line.outcome], line.name, line.detail, line.reason]
      .filter((part) => part !== null && part !== "")
      .join("  ");
  });
  return [
    title,
    "",
    ...(sameEnvironment(attempt.environment, header)
      ? []
      : ["Environment:", ...environmentLines(attempt.environment), ""]),
    ...(attempt.truncated ? ["Earlier steps of this attempt were evicted from the log.", ""] : []),
    "```text",
    ...(steps.length ? steps : ["(no steps recorded)"]),
    "```",
    "",
  ];
}

export function diagnosticLogMarkdown(attempts: readonly DiagnosticAttempt[]): string {
  const header = attempts[0]?.environment;
  if (header === undefined) return "## AgentEasel Diagnostic log\n\nNothing recorded.\n";
  return [
    "## AgentEasel Diagnostic log",
    "",
    ...environmentLines(header),
    "",
    ...attempts.flatMap((attempt) => attemptLines(attempt, header)),
  ].join("\n");
}
