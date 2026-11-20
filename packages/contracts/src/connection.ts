import type { FlowReadiness } from "./flow.ts";
import { operation } from "./operation.ts";

/** T3's hosted app; Factory links to it and to its thread routes but takes no action there. */
export const T3_APP_URL = "https://app.t3.codes";

export interface RuntimeSelection {
  readonly projectId: string;
  readonly agentId: string;
}
export interface RuntimeReadiness extends FlowReadiness {
  readonly checkedAt: string;
  readonly instructions: string;
}
export interface ReportingInstallationActions {
  readonly install: boolean;
  readonly repair: boolean;
  readonly reinstall: boolean;
}
/**
 * The id of the only target reporting discovery answers when it could not list T3's provider
 * instances; its message names the blocker and the recovery.
 */
export const REPORTING_DISCOVERY_REFUSED = "unavailable";
/** The id of the only target when discovery read T3's settings and found no instance on. */
export const REPORTING_NONE_ENABLED = "none-enabled";

export interface ReportingInstallation {
  readonly id: string;
  readonly provider: string;
  readonly instances: readonly string[];
  readonly path: string | null;
  /** The harness skills folder Factory writes its skills into, beside `path`. */
  readonly skillsPath: string | null;
  /** `unsupported`: the provider has no Factory reporting yet; there is nothing to install. */
  readonly status: "not-installed" | "installed" | "needs-attention" | "unsupported";
  readonly message: string;
  /** Least current state among the optional user-invoked skills; independent of reporting readiness. */
  readonly launchSkill: "current" | "missing" | "outdated" | null;
  readonly runtimeEvidence: "UNVERIFIED" | "ACCEPTED_REPORT";
  readonly actions: ReportingInstallationActions;
}
export type ConnectionState = "unavailable" | "authorization-required" | "incompatible" | "ready";
export interface T3Contract {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly environmentId: string | null;
  readonly tools: readonly {
    readonly name: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
  }[];
  readonly problems: readonly string[];
  /** Contract inspection never proves project, harness or runtime execution readiness. */
  readonly executionVerified: false;
}
export interface AuthorizationContext {
  readonly id: string;
  readonly endpoint: string;
  readonly environmentId: string;
  readonly createdAt: string;
}
export interface T3Connection {
  readonly endpoint: string | null;
  readonly state: ConnectionState;
  readonly explanation: string;
  readonly checkedAt: string | null;
  readonly authorizationContext: AuthorizationContext | null;
  /** An approval started on the host is waiting for consent in the host's browser. */
  readonly authorizationPending: boolean;
  readonly contract: T3Contract | null;
}

/** A T3 found running on the Factory host's computer; a suggestion until the connection check proves it. */
export interface DetectedT3 {
  readonly endpoint: string;
  /** T3's runtime file does not always state its version. */
  readonly serverVersion: string | null;
}
/**
 * First-run setup is completed once, durably, by the host. Step progress is not part of it: the
 * steps read the connection and reporting installations.
 */
export interface FirstRunSetup {
  readonly completed: boolean;
  readonly detectedT3: DetectedT3 | null;
  /** Provider drivers Factory can install into that T3 keeps off, for the install step's caption. */
  readonly harnessesOffInT3: readonly string[];
}

export interface ConfigureConnectionInput {
  readonly endpoint: string;
}
export interface InstallReportingInput {
  readonly targetId: string;
}

/** T3 connection, reporting installation and runtime readiness operations. */
export const connectionOperations = {
  getReportingInstallations: operation<never, readonly ReportingInstallation[]>()({
    method: "GET",
    path: "/api/reporting",
  }),
  installReporting: operation<InstallReportingInput, ReportingInstallation>()({
    method: "POST",
    path: "/api/reporting/install",
    body: "json",
  }),
  recheckRuntime: operation<RuntimeSelection, RuntimeReadiness>()({
    method: "POST",
    path: "/api/runtime/recheck",
    body: "json",
  }),
  getConnection: operation<never, T3Connection>()({ method: "GET", path: "/api/connection" }),
  configureConnection: operation<ConfigureConnectionInput, T3Connection>()({
    method: "PUT",
    path: "/api/connection",
    body: "json",
  }),
  recheckConnection: operation<never, T3Connection>()({
    method: "POST",
    path: "/api/connection/recheck",
  }),
  authorizeConnection: operation<never, T3Connection>()({
    method: "POST",
    path: "/api/connection/authorize",
  }),
  /**
   * Opens authorization for the saved endpoint in the host's browser: reopens a live
   * pending approval, or starts one when none exists. Never edits the endpoint and never
   * replaces a grant that is ready or incompatible. Allowed for approved remote clients.
   */
  openConnectionAuthorization: operation<never, T3Connection>()({
    method: "POST",
    path: "/api/connection/authorization/open",
  }),
  /** Whether First-run setup is completed, and the T3 running on this computer, if any. */
  getFirstRunSetup: operation<never, FirstRunSetup>()({ method: "GET", path: "/api/setup" }),
  /** Host only: records that First-run setup is completed. */
  completeFirstRunSetup: operation<never, FirstRunSetup>()({
    method: "POST",
    path: "/api/setup/complete",
  }),
};
