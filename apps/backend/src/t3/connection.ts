import type { ListToolsResult } from "@modelcontextprotocol/client";

/** Saved T3 connection and project context Factory passes into T3 operations. */
export interface T3Target {
  readonly endpoint: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly workspaceRoot: string;
}
export type T3Endpoint = Pick<T3Target, "endpoint">;
export type T3EnvironmentTarget = Pick<T3Target, "endpoint" | "environmentId">;
export type T3ProjectTarget = Pick<T3Target, "endpoint" | "environmentId" | "workspaceRoot">;

/**
 * Why one T3 call failed. `unavailable`: T3 could not be reached or answered with a server error,
 * a timeout or no reply, so an action's outcome is uncertain. `authorization-required`: T3 rejected
 * the grant. `refused`: T3 declined the request or does not support it; nothing was accepted.
 * `invalid-response`: T3 answered outside the contract, so an action's outcome is uncertain.
 */
export type T3FailureKind =
  | "unavailable"
  | "authorization-required"
  | "refused"
  | "invalid-response";
/** One call's failure, classified by the connection for that call only. */
export class T3Failure extends Error {
  override readonly name = "T3Failure";
  readonly kind: T3FailureKind;
  constructor(kind: T3FailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}
export const isT3Refusal = (error: unknown) =>
  error instanceof T3Failure && error.kind === "refused";

/**
 * `approval-pending`: an approval attempt waits for consent in the backend host's browser;
 * `approval-reopen-failed`: the same, but the host's browser could not open its page again. The
 * failure belongs to that attempt, so it lasts exactly as long as the attempt does.
 */
export type T3ConnectionReason =
  | "connected"
  | "approval-required"
  | "approval-pending"
  | "approval-reopen-failed"
  | "browser-unavailable"
  | "callback-unavailable"
  | "approval-expired"
  | "contract-missing";
/** An approval attempt is still waiting for consent in the backend host's browser. */
export const isApprovalPending = (reason: T3ConnectionReason) =>
  reason === "approval-pending" || reason === "approval-reopen-failed";
export type AuthorizationResumption = "reopened" | "completing" | "none";

/** Backend-host OAuth approval of Factory by one T3 endpoint. Calls reject only with a `T3Failure`. */
export interface T3Authorization {
  /** Starts backend-host approval; returns without waiting for the human. */
  authorize(target: T3Endpoint): Promise<void>;
  /**
   * Reopens a live pending approval's own authorization page in the backend-host browser,
   * keeping its state and verifier. `completing`: a callback is being exchanged; `none`:
   * no live attempt exists (never started, expired, denied or completed). Throws when
   * the browser cannot open, and the attempt then inspects as `approval-reopen-failed` until a
   * later reopen opens its page. The page address never leaves the connection.
   */
  resumeAuthorization(target: T3Endpoint): Promise<AuthorizationResumption>;
}

export type T3ListedTool = Pick<ListToolsResult["tools"][number], "name" | "inputSchema">;
/** One tool call's answer: structured content, else the first text item that parses as JSON. */
export interface T3ToolAnswer {
  readonly isError: boolean;
  readonly content: unknown;
}
/** One MCP connection as the live T3 modules use it. */
export interface T3Session {
  /** Every tools/list page; repeated or runaway cursors fail. */
  tools(): Promise<readonly T3ListedTool[]>;
  call(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<T3ToolAnswer>;
}
/** The answer's JSON; a T3 error is a refusal and a missing answer is outside the contract. */
export function structured(answer: T3ToolAnswer): unknown {
  if (answer.isError) throw new T3Failure("refused", "T3 tool returned isError");
  if (answer.content === undefined) throw new Error("T3 tool returned no structured JSON");
  return answer.content;
}

export interface T3ServerIdentity {
  readonly serverName: string;
  readonly serverVersion: string;
}
/** What one inspection probe found. `contract-failure`: T3 answered outside the MCP connection
 * contract. `answered`: `read`'s answer; `approved` is true only with a saved grant and identity. */
export type T3Probe<A> =
  | { readonly status: "authorization-required"; readonly reason: T3ConnectionReason }
  | { readonly status: "contract-failure"; readonly server: T3ServerIdentity }
  | {
      readonly status: "answered";
      readonly answer: A;
      readonly server: T3ServerIdentity;
      /** Opaque grant lineage, never an access/refresh token or client secret. */
      readonly authorizationIdentity: string | undefined;
      readonly approved: boolean;
    };

/** How the other live T3 modules reach T3. Every call rejects only with its own `T3Failure`. */
export interface T3Calls {
  /** Runs `action` once on the endpoint's reused connection with the saved grant, after any
   * in-flight consent completes. A connection T3 no longer knows is replaced and `action` run once
   * more; any other failure is reported, so an action T3 may have executed is never repeated. */
  authorized<A>(target: T3Endpoint, action: (session: T3Session) => Promise<A>): Promise<A>;
  /** Inspects the endpoint without requiring a grant: keeps a pending approval listening, revokes a
   * rejected grant and reports a contract failure; an unreachable T3 rejects as `unavailable`.
   * `finish` derives the answer within the same call, so its failure is classified with what the
   * probe's own requests met. */
  probe<A, B>(
    target: T3Endpoint,
    read: (session: T3Session) => Promise<A>,
    finish: (probe: T3Probe<A>) => Promise<B>,
  ): Promise<B>;
}
