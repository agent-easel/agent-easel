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
  }
  async resumeAuthorization(_target: T3Endpoint): Promise<AuthorizationResumption> {
    if (!this.pendingApproval) return "none";
    this.reopenedApprovals++;
    return "reopened";
  }
  approve(identity = "controlled-grant-2") {
    this.identity = identity;
    this.authorized = true;
    this.pendingApproval = false;
  }
}
