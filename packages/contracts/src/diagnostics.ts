import { operation } from "./operation.ts";

export type DiagnosticStartOperation = "start" | "start_preflight";

export type DiagnosticOAuthOperation = "t3_oauth_open" | "t3_oauth_resume" | "t3_oauth_callback";
export type DiagnosticOperation =
  | DiagnosticStartOperation
  | "backend_start"
  | "t3_detection"
  | "t3_connection"
  | DiagnosticOAuthOperation
  | "reporting_recheck"
  | "reporting_install";

export type DiagnosticOAuthStep =
  | DiagnosticOAuthOperation
  | "t3_oauth_listener"
  | "t3_oauth_browser"
  | "t3_oauth_exchange";
export type DiagnosticStep =
  | "backend_start"
  | "t3_detection"
  | "t3_connection"
  | "start_preconditions"
  | DiagnosticOAuthStep
  | "reporting_discovery"
  | "reporting_install";

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

export type DiagnosticConnectionReason =
  | "connected"
  | "approval-required"
  | "approval-pending"
  | "approval-reopen-failed"
  | "browser-unavailable"
  | "callback-unavailable"
  | "approval-expired"
  | "contract-missing"
  | "authorization_context_missing"
  | "t3_unavailable"
  | "t3_authorization_required"
  | "t3_refused"
  | "t3_invalid_response";

export type ReportingHarnessName =
  | "codex"
  | "claudeAgent"
  | "cursor"
  | "grok"
  | "antigravity"
  | "mistral-vibe"
  | "unknown";

export type T3ReadStage = "connection" | "endpoint" | "policy" | "identity" | "settings";

export type T3ReadReason =
  | "read_ok"
  | "settings_missing"
  | "connection_not_ready"
  | "remote_endpoint"
  | "managed_host"
  | "identity_mismatch"
  | "identity_unreadable"
  | "settings_unreadable"
  | "settings_malformed"
  | "none_enabled";

export type EnablementRule =
  | "instance_disabled"
  | "config_disabled"
  | "instance_enabled"
  | "config_enabled"
  | "project_enabled"
  | "driver_default_off"
  | "driver_default_on";

export type HomeSource =
  | "configured_path"
  | "environment"
  | "default"
  | "fixed"
  | "t3_profile"
  | "vibe_home"
  | "not_evaluated";

export type HomeReason =
  | "chosen"
  | "candidate_unused"
  | "managed_setup"
  | "custom_launch_args"
  | "shadow_home"
  | "relative_path"
  | "redacted_environment"
  | "environment_override"
  | "not_a_directory"
  | "home_missing"
  | "home_unreadable"
  | "profile_missing"
  | "profile_unsupported";

export type ConflictReason =
  | "no_entry"
  | "entry_current"
  | "entry_other_address"
  | "entry_conflicting"
  | "entry_edited"
  | "entry_duplicated"
  | "config_unmanageable"
  | "config_invalid"
  | "config_unreadable"
  | "skill_outdated";

export type InstallTargetReason = "target_found" | "target_unavailable";

export type InstallWriteKind =
  | "config"
  | "block_skill"
  | "canonical_block_skill"
  | "optional_skill"
  | "verification";

export type InstallSkillName =
  | "factory-block"
  | "factory-start-run"
  | "setup-factory"
  | "factory-configure";

export type InstallWriteReason =
  | "written"
  | "unchanged"
  | "permission_denied"
  | "missing_directory"
  | "no_space"
  | "changed_during_install"
  | "unmanageable_file"
  | "verification_failed"
  | "write_failed";

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
      readonly type: "t3_connection";
      readonly outcome: DiagnosticStepOutcome;
      readonly host: DiagnosticHost;
      readonly reason: DiagnosticConnectionReason;
    }
  | {
      readonly type: "t3_connection_contract";
      readonly outcome: DiagnosticStepOutcome;
      readonly t3Version: string;
      readonly reason: "contract-missing" | null;
    }
  | {
      readonly type: "t3_connection_identity";
      readonly outcome: DiagnosticStepOutcome;
      readonly environment: string | null;
      readonly grant: string | null;
      readonly reason: "authorization_context_missing" | null;
    }
  | {
      readonly type: "t3_oauth";
      readonly step: DiagnosticOAuthStep;
      readonly outcome: DiagnosticStepOutcome;
      readonly reason:
        | "callback_unavailable"
        | "browser_unavailable"
        | "approval_not_pending"
        | "approval_completing"
        | "approval_not_started"
        | "oauth_request_failed"
        | "oauth_callback_invalid"
        | "oauth_approval_denied"
        | "oauth_exchange_failed"
        | null;
    }
  | {
      readonly type: "t3_state_read";
      readonly outcome: DiagnosticStepOutcome;
      readonly stage: T3ReadStage;
      readonly reason: T3ReadReason;
    }
  | {
      readonly type: "enablement";
      readonly outcome: "ok" | "skipped";
      readonly instance: string;
      readonly driver: ReportingHarnessName;
      readonly enabled: boolean;
      readonly rule: EnablementRule;
    }
  | {
      readonly type: "home";
      readonly outcome: DiagnosticStepOutcome;
      readonly instance: string;
      readonly driver: ReportingHarnessName;
      readonly homeSource: HomeSource;
      readonly reason: HomeReason;
      readonly path: string | null;
    }
  | {
      readonly type: "conflict_check";
      readonly outcome: DiagnosticStepOutcome;
      readonly driver: ReportingHarnessName;
      readonly reason: ConflictReason;
      readonly file: string;
    }
  | {
      readonly type: "install_target";
      readonly outcome: "ok" | "failed";
      readonly driver: ReportingHarnessName;
      readonly reason: InstallTargetReason;
    }
  | {
      readonly type: "install_write";
      readonly outcome: DiagnosticStepOutcome;
      readonly driver: ReportingHarnessName;
      readonly write: InstallWriteKind;
      readonly skill: InstallSkillName | null;
      readonly reason: InstallWriteReason;
      readonly file: string;
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
