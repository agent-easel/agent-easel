import { operation } from "./operation.ts";

export type DiagnosticStartOperation = "start" | "start_preflight";

export type DiagnosticOperation = DiagnosticStartOperation | "backend_start" | "t3_detection";

export type DiagnosticStep = "backend_start" | "t3_detection" | "start_preconditions";

export type DiagnosticStepOutcome = "ok" | "failed" | "skipped";

export type DiagnosticAttemptOutcome = "ok" | "failed" | "partial";

export type DiagnosticHost = "loopback" | "non-loopback";

export type T3DetectionReason =
  | "runtime_file_found"
  | "runtime_file_missing"
  | "runtime_file_unreadable"
  | "runtime_file_malformed"
  | "runtime_origin_invalid"
  | "runtime_endpoint_refused";

export const diagnosticStartReasons = [
  "project_connection",
  "project_unavailable",
  "flow_project_mismatch",
  "flow_unavailable",
  "flow_not_ready",
  "subflow_revision_unavailable",
  "workspace_remote_host",
  "workspace_ref_unreadable",
  "workspace_default_branch_missing",
  "workspace_ref_missing",
  "attachments_unsupported",
  "launch_unsupported",
  "fresh_context_unsupported",
  "agent_unavailable",
  "agent_model_required",
  "agent_readiness",
  "connection_unavailable",
  "capabilities_unavailable",
  "environment_unsupported",
  "harness_unsupported",
  "settings_unavailable",
  "contract_missing",
  "runtime_unavailable",
  "reporting_installation",
  "reporting_unsupported",
  "readiness_blocked",
] as const;

export type DiagnosticStartReason = (typeof diagnosticStartReasons)[number];

export type DiagnosticEntry =
  | {
      readonly type: "start_preconditions";
      readonly outcome: "ok";
      readonly reason: "ready";
    }
  | {
      readonly type: "start_preconditions";
      readonly outcome: "failed";
      readonly reason: DiagnosticStartReason;
    }
  | {
      readonly type: "backend_start";
      readonly outcome: "ok";
      readonly applicationVersion: string;
      readonly mode: "desktop" | "source";
      readonly nodeVersion: string;
      readonly dataHome: string;
    }
  | {
      readonly type: "t3_detection";
      readonly outcome: DiagnosticStepOutcome;
      readonly reason: T3DetectionReason;
      readonly file: string;
      readonly host: DiagnosticHost | null;
      readonly t3Version: string | null;
    }
  | {
      readonly type: "unexpected_error";
      readonly outcome: "failed";
      readonly step: DiagnosticStep;
      readonly reason: "unexpected_error";
    };

export interface DiagnosticHarness {
  readonly driver: string;
  readonly status:
    | "not-installed"
    | "installed"
    | "needs-attention"
    | "unsupported"
    | "discovery-refused"
    | "none-enabled";
}

export interface DiagnosticEnvironment {
  readonly applicationVersion: string;
  readonly mode: "desktop" | "source";
  readonly t3Version: string | null;
  readonly os: string;
  readonly arch: string;
  readonly installation: string;
  readonly harnesses: readonly DiagnosticHarness[];
}

export interface DiagnosticLogEntry {
  readonly at: string;
  readonly entry: DiagnosticEntry;
}

export interface DiagnosticAttempt {
  readonly id: string;
  readonly operation: DiagnosticOperation;
  readonly startedAt: string;
  readonly outcome: DiagnosticAttemptOutcome | null;
  readonly truncated: boolean;
  readonly environment: DiagnosticEnvironment;
  readonly entries: readonly DiagnosticLogEntry[];
}

export interface DiagnosticAttemptPage {
  readonly attempts: readonly DiagnosticAttempt[];
  readonly nextCursor: string | null;
}

export interface DiagnosticLogStatus {
  readonly enabled: boolean;
  readonly until: string | null;
  readonly hasEntries: boolean;
  readonly dropped: number;
}

export interface SetDiagnosticRecordingInput {
  readonly enabled: boolean;
}

export const diagnosticOperations = {
  getDiagnosticLog: operation<never, DiagnosticLogStatus>()({
    method: "GET",
    path: "/api/settings/diagnostics",
  }),
  setDiagnosticRecording: operation<SetDiagnosticRecordingInput, DiagnosticLogStatus>()({
    method: "PUT",
    path: "/api/settings/diagnostics",
    body: "json",
  }),
  deleteDiagnosticLog: operation<never, DiagnosticLogStatus>()({
    method: "DELETE",
    path: "/api/settings/diagnostics",
  }),
  listDiagnosticAttempts: operation<never, DiagnosticAttemptPage>()({
    method: "GET",
    path: "/api/settings/diagnostics/attempts",
    query: ["cursor", "limit", "ids"],
  }),
  exportDiagnosticLog: operation<never, string>()({
    method: "GET",
    path: "/api/settings/diagnostics/export",
    answer: "text",
  }),
};
