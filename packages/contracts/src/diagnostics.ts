import { operation } from "./operation.ts";

export type DiagnosticOperation =
  | "backend_start"
  | "t3_detection"
  | "reporting_recheck"
  | "reporting_install";

export type DiagnosticStep =
  | "backend_start"
  | "t3_detection"
  | "start_preconditions"
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
