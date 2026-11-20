import {
  T3Failure,
  type AuthorizationResumption,
  type T3Authorization,
  type T3Endpoint,
} from "../../src/t3/connection.ts";

export class ControlledT3Connection implements T3Authorization {
  available = true;
  authorized = false;
  identity = "controlled-grant-1";
  environmentId = "controlled-environment";
  authorizationStarts = 0;
  /** An authorization attempt waits for consent; reopening it keeps the same attempt. */
  pendingApproval = false;
  /** The pending attempt's page could not be opened again; it ends with that attempt. */
  reopenFailed = false;
  /** False: the host's browser cannot be opened, so reopening a pending approval fails. */
  hostBrowserOpens = true;
  reopenedApprovals = 0;
  /** Uses the live connection's failure kinds for unreachable T3 and unapproved grants. */
  requireConnection(message = "Unavailable") {
    if (!this.available) throw new T3Failure("unavailable", message);
    if (!this.authorized) throw new T3Failure("authorization-required", message);
  }
  async authorize(_target: T3Endpoint) {
    this.authorizationStarts++;
    this.authorized = false;
    this.pendingApproval = true;
    this.reopenFailed = false;
  }
  async resumeAuthorization(_target: T3Endpoint): Promise<AuthorizationResumption> {
    if (!this.pendingApproval) return "none";
    this.reopenFailed = !this.hostBrowserOpens;
    if (this.reopenFailed) throw new T3Failure("unavailable", "Backend browser unavailable");
    this.reopenedApprovals++;
    return "reopened";
  }
  approve(identity = "controlled-grant-2") {
    this.identity = identity;
    this.authorized = true;
    this.pendingApproval = false;
    this.reopenFailed = false;
  }
}
