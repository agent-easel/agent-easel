import { periodicWorker } from "./periodic.ts";
import * as Semaphore from "effect/Semaphore";
import { now } from "./time.ts";
import { newId } from "./ids.ts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  AuthorizationContext,
  DiagnosticConnectionReason,
  DiagnosticHost,
  DiagnosticOperation,
  Result,
  T3Connection,
  T3ConnectionRecovery,
} from "@agent-easel/contracts";
import { diagnosticHost, diagnosticVersion } from "@agent-easel/domain-validation";
import {
  isApprovalPending,
  T3Failure,
  type T3Authorization,
  type T3ConnectionReason,
  type T3FailureKind,
} from "./t3/connection.ts";
import {
  NO_T3_SUPPORT,
  type T3ContractReader,
  type T3Inspection,
  type T3ContractSnapshot,
  type T3Support,
} from "./t3/contract.ts";
import type { LiveChanges } from "./live-changes.ts";
import { isLocalEndpoint } from "./endpoint-local.ts";
import {
  noDiagnosticAttempt,
  type DiagnosticAttemptHandle,
  type DiagnosticLog,
} from "./diagnostic-log.ts";

type ContextRow = {
  id: string;
  endpoint: string;
  authorization_identity: string;
  environment_id: string;
  created_at: string;
};
const contextValue = (row: ContextRow): AuthorizationContext => ({
  id: row.id,
  endpoint: row.endpoint,
  environmentId: row.environment_id,
  createdAt: row.created_at,
});
const explanations: Record<T3ConnectionReason, string> = {
  connected:
    "T3 Code connection is ready. Project, harness and runtime execution readiness still require separate checks.",
  "approval-required":
    "Approve access in T3 Code by opening authorization on the AgentEasel host; consent happens in that computer's browser. No token copying is needed.",
  "approval-pending":
    "Approve access in the browser opened on the backend host. AgentEasel will recheck automatically.",
  "approval-reopen-failed":
    "AgentEasel could not open the backend-host browser. The pending approval is unchanged; check the host's desktop/browser setup and try again.",
  "browser-unavailable":
    "AgentEasel could not open the backend-host browser. Check its desktop/browser setup and choose Authorize again.",
  "callback-unavailable":
    "AgentEasel could not bind the loopback OAuth callback on port 43827. Free that port and choose Authorize again.",
  "approval-expired":
    "OAuth approval expired or was denied. Choose Authorize to try again on the backend host.",
  "contract-missing":
    "T3 Code does not satisfy the connection contract. Inspect the reported problems, update T3 Code if needed, and recheck.",
};

/** Bounds how often anyone may open the host browser through `openConnectionAuthorization`. */
const AUTHORIZATION_OPEN_COOLDOWN_MS = 5_000;

const connectionFailures: Record<T3FailureKind, DiagnosticConnectionReason> = {
  unavailable: "t3_unavailable",
  "authorization-required": "t3_authorization_required",
  refused: "t3_refused",
  "invalid-response": "t3_invalid_response",
};

const missingEndpoint = (message: string) => ({
  ok: false as const,
  error: { code: "validation" as const, message, issues: [] },
});

/** Internal access to the T3 contract snapshot: `fresh` performs one connection check, `latest`
 * reads the last completed check. Neither is a public operation. */
export interface ContractSnapshots {
  readonly fresh: () => Effect.Effect<T3ContractSnapshot, unknown>;
  readonly latest: () => Effect.Effect<T3ContractSnapshot>;
}

/** Every status transition is published to live subscribers; `status` is the authority. */
export const makeConnection = (
  {
    connection: authorization,
    contract,
    close: closeT3,
  }: {
    connection: T3Authorization;
    contract: T3ContractReader;
    close: () => Promise<void>;
  },
  intervalMs: number,
  changes: LiveChanges,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const mutex = yield* Semaphore.make(1);
    const [savedRow] = yield* sql<{
      endpoint: string;
      context_id: string | null;
    }>`SELECT * FROM t3_connection WHERE singleton = 1`;
    let saved = savedRow;
    let current: ContextRow | undefined;
    if (saved?.context_id) {
      [current] =
        yield* sql<ContextRow>`SELECT * FROM t3_authorization_contexts WHERE id = ${saved.context_id}`;
    }
    let status: T3Connection = {
      endpoint: saved?.endpoint ?? null,
      state: "unavailable",
      explanation: "Save your T3 Code MCP endpoint to connect.",
      checkedAt: null,
      authorizationContext: current ? contextValue(current) : null,
      authorizationPending: false,
      authorizationOpenFailed: false,
      readyGeneration: null,
      contract: null,
    };
    /** The support answers of the check that set `status`. */
    let support: T3Support = NO_T3_SUPPORT;
    let closed = false;
    let diagnostics: DiagnosticLog | undefined;
    /** When `openConnectionAuthorization` last asked the host browser; bounds repeated opens. */
    let lastOpenedAt: number | undefined;
    const value = (ids: readonly string[] = []): Result<T3ConnectionRecovery> => ({
      ok: true,
      value: ids.length ? { ...status, diagnosticAttemptIds: ids } : status,
    });
    /** A snapshot offers support answers only together with a ready authorization context. */
    const snapshot = (): T3ContractSnapshot => {
      const contextId = status.state === "ready" ? (status.authorizationContext?.id ?? null) : null;
      return {
        contextId,
        answered: status.state !== "unavailable",
        support: contextId ? support : NO_T3_SUPPORT,
      };
    };
    // Once a mutation starts, shutdown drains it before closing the adapter and SQL.
    const serial = <A, E>(action: Effect.Effect<A, E>) =>
      mutex.withPermits(1)(Effect.uninterruptible(action));
    /** Publishes a check's result: only a different connection, not a later check time, is a change. */
    const publishCheck = (before: T3Connection) => {
      if (Equal.equals({ ...before, checkedAt: null }, { ...status, checkedAt: null }))
        changes.connectionChecked();
      else changes.connectionChanged();
    };
    const begin = Effect.fn(function* (operation: DiagnosticOperation, ids: string[]) {
      const attempt = yield* diagnostics?.attempt(operation) ?? Effect.succeed(noDiagnosticAttempt);
      if (attempt.id !== null) ids.push(attempt.id);
      return attempt;
    });
    const bindAuthorizationContext = Effect.fn(function* (
      savedRow: NonNullable<typeof saved>,
      observation: T3Inspection,
    ) {
      const environment = observation.contract?.environmentId;
      if (
        observation.authorizationIdentity &&
        environment &&
        ["ready", "incompatible"].includes(observation.state)
      ) {
        if (
          !current ||
          current.authorization_identity !== observation.authorizationIdentity ||
          current.environment_id !== environment
        ) {
          const row: ContextRow = {
            id: yield* newId,
            endpoint: savedRow.endpoint,
            authorization_identity: observation.authorizationIdentity,
            environment_id: environment,
            created_at: yield* now,
          };
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO t3_authorization_contexts (id, endpoint, authorization_identity, environment_id, created_at)
              VALUES (${row.id}, ${row.endpoint}, ${row.authorization_identity}, ${row.environment_id}, ${row.created_at})`;
              yield* sql`UPDATE t3_connection SET context_id = ${row.id} WHERE singleton = 1`;
            }),
          );
          current = row;
          savedRow.context_id = row.id;
        }
      }
    });
    const recordInspection = Effect.fn(function* (
      attempt: DiagnosticAttemptHandle,
      host: DiagnosticHost,
      observation: T3Inspection,
      invalidReady: boolean,
    ) {
      if (attempt.id === null || !diagnostics) return;
      const environment = observation.contract?.environmentId;
      const contextMissing = !observation.authorizationIdentity || !environment;
      yield* attempt.record({
        type: "t3_connection",
        outcome: status.state === "ready" ? "ok" : "failed",
        host,
        reason: invalidReady ? "authorization_context_missing" : observation.reason,
      });
      if (!observation.contract) return;
      yield* attempt.record({
        type: "t3_connection_contract",
        outcome: observation.reason === "contract-missing" ? "failed" : "ok",
        t3Version: diagnosticVersion(observation.contract.serverVersion),
        reason: observation.reason === "contract-missing" ? "contract-missing" : null,
      });
      const grant = observation.authorizationIdentity;
      yield* attempt.record({
        type: "t3_connection_identity",
        outcome: contextMissing ? "failed" : "ok",
        environment: environment ? diagnostics.hash(environment) : null,
        grant: grant ? diagnostics.hash(grant) : null,
        reason: contextMissing ? "authorization_context_missing" : null,
      });
    });
    const check = Effect.fn("Connection.check")(function* ({
      ids = [],
      record = true,
    }: { ids?: string[]; record?: boolean } = {}) {
      if (!saved || closed) return value(ids);
      const savedRow = saved;
      const endpoint = savedRow.endpoint;
      const before = status;
      const attempt = record ? yield* begin("t3_connection", ids) : noDiagnosticAttempt;
      const unavailable = Effect.gen(function* () {
        support = NO_T3_SUPPORT;
        status = {
          ...status,
          state: "unavailable",
          checkedAt: yield* now,
          authorizationPending: false,
          authorizationOpenFailed: false,
          readyGeneration: null,
          contract: null,
          explanation:
            "T3 Code is unavailable. Start T3 Code or check the endpoint and network. AgentEasel will reconnect automatically.",
        };
        publishCheck(before);
      });
      yield* attempt
        .guard(
          "t3_connection",
          Effect.gen(function* () {
            const host = diagnosticHost(new URL(endpoint).hostname);
            const observation = yield* Effect.tryPromise({
              try: () => contract.inspect({ endpoint }, attempt),
              catch: (cause) => cause,
            }).pipe(
              Effect.catchIf(
                (cause) => cause instanceof T3Failure,
                (failure) =>
                  attempt
                    .record({
                      type: "t3_connection",
                      outcome: "failed",
                      host,
                      reason: connectionFailures[failure.kind],
                    })
                    .pipe(Effect.as(null)),
              ),
            );
            if (!observation) return yield* unavailable;
            const environment = observation.contract?.environmentId;
            yield* bindAuthorizationContext(savedRow, observation);
            support = observation.support;
            // Kept while the connection stays ready for the same authorization context.
            const sameReady =
              before.readyGeneration !== null && before.authorizationContext?.id === current?.id;
            let readyGeneration: string | null = null;
            if (observation.state === "ready")
              readyGeneration = sameReady ? before.readyGeneration : yield* newId;
            status = {
              endpoint,
              state: observation.state,
              explanation: explanations[observation.reason],
              checkedAt: yield* now,
              authorizationContext: current ? contextValue(current) : null,
              // The pending attempt owns both, so a resumed attempt reports them as before.
              authorizationPending: isApprovalPending(observation.reason),
              authorizationOpenFailed: observation.reason === "approval-reopen-failed",
              readyGeneration,
              contract: observation.contract ?? null,
            };
            publishCheck(before);
            const contextMissing = !observation.authorizationIdentity || !environment;
            const invalidReady = status.state === "ready" && contextMissing;
            if (invalidReady) {
              status = {
                ...status,
                state: "incompatible",
                readyGeneration: null,
                explanation:
                  "T3 Code did not provide a verifiable authorization context and environment. Reauthorize and recheck.",
              };
              publishCheck(before);
            }
            yield* recordInspection(attempt, host, observation, invalidReady);
          }),
        )
        .pipe(Effect.catch(() => unavailable));
      yield* attempt.finish(status.state === "ready" ? "ok" : "failed");
      return value(ids);
    });
    /** Retires the current context and starts a new approval attempt; callers hold the mutex. */
    const startAuthorization = Effect.fn("Connection.startAuthorization")(function* (
      endpoint: { endpoint: string; context_id: string | null },
      ids: string[] = [],
    ) {
      const attempt = yield* begin("t3_oauth_open", ids);
      return yield* attempt
        .guard(
          "t3_oauth_open",
          Effect.gen(function* () {
            yield* sql`UPDATE t3_connection SET context_id = NULL WHERE singleton = 1`;
            endpoint.context_id = null;
            current = undefined;
            status = {
              ...status,
              authorizationContext: null,
              authorizationPending: false,
              authorizationOpenFailed: false,
              readyGeneration: null,
              contract: null,
              state: "authorization-required",
            };
            changes.connectionChanged();
            const started = yield* attempt
              .guard(
                "t3_oauth_open",
                Effect.tryPromise({
                  try: () => authorization.authorize({ endpoint: endpoint.endpoint }, attempt),
                  catch: (cause) => cause,
                }).pipe(
                  Effect.as(true),
                  Effect.catchIf(
                    (cause) => cause instanceof T3Failure,
                    () => Effect.succeed(false),
                  ),
                ),
              )
              .pipe(Effect.orElseSucceed(() => false));
            if (started) yield* check({ ids });
            else {
              status = {
                ...status,
                explanation:
                  "Authorization could not start. Check T3 Code, backend-host browser and loopback callback port 43827, then authorize again.",
              };
              changes.connectionChanged();
            }
            const opened = started && (status.authorizationPending || status.state === "ready");
            yield* attempt.record({
              type: "t3_oauth",
              step: "t3_oauth_open",
              outcome: opened ? "ok" : "failed",
              reason: opened ? null : started ? "approval_not_started" : "oauth_request_failed",
            });
            yield* attempt.finish(opened ? "ok" : "failed");
            return value(ids);
          }),
        )
        .pipe(Effect.onError(() => attempt.finish("failed")));
    });
    let stopWorker = Effect.void;
    const close = Effect.gen(function* () {
      if (closed) return;
      closed = true;
      yield* stopWorker;
      yield* Effect.tryPromise(closeT3);
    });
    yield* Effect.addFinalizer(() => close.pipe(Effect.orDie));
    return {
      start: (log: DiagnosticLog) =>
        Effect.gen(function* () {
          diagnostics = log;
          authorization.setOAuthDiagnostics?.(
            log.attempt,
            Effect.runPromiseWith(yield* Effect.context()),
          );
          yield* check();
          stopWorker = yield* periodicWorker(intervalMs, serial(check()), serial(Effect.void));
        }),
      getConnection: () => Effect.sync(() => value()),
      recheckConnection: () => serial(check()),
      snapshots: {
        fresh: () => serial(Effect.map(check({ record: false }), snapshot)),
        latest: () => Effect.sync(snapshot),
      } satisfies ContractSnapshots,
      configureConnection: (input: unknown) =>
        serial(
          Effect.gen(function* () {
            const parsed = parseEndpoint(input);
            if (!parsed.ok) return parsed;
            const endpoint = parsed.value;
            if (saved?.endpoint !== endpoint) {
              yield* sql`INSERT INTO t3_connection (singleton, endpoint, context_id) VALUES (1, ${endpoint}, NULL)
          ON CONFLICT(singleton) DO UPDATE SET endpoint = excluded.endpoint, context_id = NULL`;
              saved = { endpoint, context_id: null };
              current = undefined;
              status = {
                ...status,
                endpoint,
                authorizationContext: null,
                authorizationOpenFailed: false,
                readyGeneration: null,
                contract: null,
              };
              changes.connectionChanged();
            }
            return yield* check();
          }),
        ),
      authorizeConnection: () =>
        serial(
          Effect.gen(function* () {
            if (!saved) return missingEndpoint("Save a T3 Code endpoint before authorizing.");
            return yield* startAuthorization(saved);
          }),
        ),
      openConnectionAuthorization: () =>
        serial(
          Effect.gen(function* () {
            if (!saved)
              return missingEndpoint(
                "The AgentEasel host has no T3 Code endpoint yet. Save it on the AgentEasel host first.",
              );
            const endpoint = saved;
            // Fresh evidence first: an approval that just completed is never replaced.
            const ids: string[] = [];
            yield* check({ ids });
            if (status.state !== "authorization-required") return value(ids);
            const at = yield* Clock.currentTimeMillis;
            if (lastOpenedAt !== undefined && at - lastOpenedAt < AUTHORIZATION_OPEN_COOLDOWN_MS)
              return value(ids);
            lastOpenedAt = at;
            const attempt = yield* begin("t3_oauth_resume", ids);
            const resumed = yield* attempt
              .guard(
                "t3_oauth_resume",
                Effect.tryPromise({
                  try: () =>
                    authorization.resumeAuthorization({ endpoint: endpoint.endpoint }, attempt),
                  catch: (cause) => cause,
                }).pipe(
                  Effect.catchIf(
                    (cause) => cause instanceof T3Failure,
                    () => Effect.succeed("failed" as const),
                  ),
                ),
              )
              .pipe(Effect.orElseSucceed(() => "failed" as const));
            const outcome =
              resumed === "reopened" ? "ok" : resumed === "failed" ? "failed" : "skipped";
            yield* attempt.record({
              type: "t3_oauth",
              step: "t3_oauth_resume",
              outcome,
              reason: {
                reopened: null,
                failed: "oauth_request_failed",
                none: "approval_not_pending",
                completing: "approval_completing",
              }[resumed] as
                | "oauth_request_failed"
                | "approval_not_pending"
                | "approval_completing"
                | null,
            });
            yield* attempt.finish(outcome === "failed" ? "failed" : "ok");
            // A failed open is recorded on the pending attempt, which the check reports.
            if (resumed !== "none") return yield* check({ ids });
            return yield* startAuthorization(endpoint, ids);
          }),
        ),
      close,
    };
  });

export function parseEndpoint(input: unknown): Result<string> {
  try {
    if (
      typeof input !== "object" ||
      input === null ||
      !("endpoint" in input) ||
      typeof input.endpoint !== "string"
    )
      throw new Error();
    const url = new URL(input.endpoint.trim());
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && isLocalEndpoint(url.href)))
    )
      throw new Error();
    return { ok: true, value: url.href };
  } catch {
    return {
      ok: false,
      error: {
        code: "validation",
        message:
          "Use an HTTPS MCP endpoint, or HTTP on loopback, without credentials, query or fragment.",
        issues: [
          {
            code: "endpoint_invalid",
            path: "endpoint",
            message: "Enter the T3 Code MCP URL without secrets.",
          },
        ],
      },
    };
  }
}
