import { createHash } from "node:crypto";
import { arch, platform } from "node:process";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  DiagnosticAttempt,
  DiagnosticAttemptOutcome,
  DiagnosticAttemptPage,
  DiagnosticEntry,
  DiagnosticEnvironment,
  DiagnosticHarness,
  DiagnosticLogStatus,
  DiagnosticOperation,
  DiagnosticStep,
  ReportingInstallation,
  Result,
  T3Connection,
} from "@agent-easel/contracts";
import {
  DIAGNOSTIC_ATTEMPT_PAGE_LIMIT,
  DIAGNOSTIC_ENTRY_LIMIT,
  DIAGNOSTIC_RECORDING_MS,
  DIAGNOSTIC_RETENTION_MS,
  diagnosticLogMarkdown,
  diagnosticVersion,
  validateDiagnosticEntry,
} from "@agent-easel/domain-validation";
import { newId } from "./ids.ts";
import { periodicWorker } from "./periodic.ts";
import { isReportingDriver } from "./reporting-drivers.ts";
import { failure } from "./result.ts";
import { now } from "./time.ts";

export interface DiagnosticAttemptRef {
  readonly id: string;
  readonly generation: number;
}

export interface DiagnosticRecorder {
  readonly open: (
    operation: DiagnosticOperation,
    environment: Effect.Effect<DiagnosticEnvironment>,
    expectedGeneration?: number,
    startedAt?: string,
  ) => Effect.Effect<DiagnosticAttemptRef | null, unknown>;
  readonly append: (
    attempt: DiagnosticAttemptRef,
    entry: DiagnosticEntry,
    at: string,
  ) => Effect.Effect<void, unknown>;
  readonly finish: (
    attempt: DiagnosticAttemptRef,
    outcome: DiagnosticAttemptOutcome,
  ) => Effect.Effect<void, unknown>;
}

export interface DiagnosticAttemptHandle {
  readonly id: string | null;
  readonly hash: (value: string) => string;
  readonly record: (entry: DiagnosticEntry) => Effect.Effect<void>;
  readonly finish: (outcome: DiagnosticAttemptOutcome) => Effect.Effect<void>;
  readonly guard: <A, E, R>(
    step: DiagnosticStep,
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export const noDiagnosticAttempt: DiagnosticAttemptHandle = {
  id: null,
  hash: () => "00000000",
  record: () => Effect.void,
  finish: () => Effect.void,
  guard: (_step, work) => work,
};

export interface DiagnosticEnvironmentSources {
  readonly applicationVersion: string | undefined;
  readonly serverId: string;
  readonly connection: () => Effect.Effect<Result<T3Connection>, unknown>;
  readonly installations: () => Effect.Effect<Result<readonly ReportingInstallation[]>, unknown>;
}

interface StateRow {
  readonly enabled_until: string | null;
  readonly generation: number;
  readonly salt: string;
}

interface AttemptRow {
  readonly sequence: number;
  readonly id: string;
  readonly operation: DiagnosticOperation;
  readonly started_at: string;
  readonly outcome: DiagnosticAttemptOutcome | null;
  readonly truncated: number;
  readonly environment: string;
}

interface LatestVerdict {
  readonly order: number;
  readonly generation: number;
  readonly observed: string | null;
}

const observedVerdict = (entries: readonly DiagnosticEntry[], outcome: DiagnosticAttemptOutcome) =>
  JSON.stringify([entries, outcome]);

const HARNESS_LIMIT = 16;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const recording = (state: StateRow, at: string) =>
  state.enabled_until !== null && state.enabled_until > at;

const shortHash = (salt: string, value: string) =>
  createHash("sha256").update(`${salt}\0${value}`).digest("hex").slice(0, 8);

const knownPlatform = (value: string) =>
  ["darwin", "linux", "win32"].includes(value) ? value : "other";
const knownArch = (value: string) => (["arm64", "x64"].includes(value) ? value : "other");

function harnessesOf(installations: readonly ReportingInstallation[]): DiagnosticHarness[] {
  const harnesses = installations.map((installation): DiagnosticHarness =>
    installation.kind === "instance"
      ? {
          driver: isReportingDriver(installation.provider) ? installation.provider : "unknown",
          status: installation.status,
        }
      : { driver: "none", status: installation.kind },
  );
  return harnesses.slice(0, HARNESS_LIMIT);
}

const orNull = <A>(read: Effect.Effect<Result<A>, unknown>) =>
  read.pipe(
    Effect.map((result) => (result.ok ? result.value : null)),
    Effect.catchCause(() => Effect.succeed(null)),
  );

function diagnosticEnvironment(
  sources: DiagnosticEnvironmentSources,
  hash: (value: string) => string,
): Effect.Effect<DiagnosticEnvironment> {
  return Effect.gen(function* () {
    const [connection, installations] = yield* Effect.all(
      [orNull(sources.connection()), orNull(sources.installations())],
      { concurrency: "unbounded" },
    );
    const t3Version = connection?.contract?.serverVersion;
    return {
      applicationVersion: diagnosticVersion(sources.applicationVersion ?? "source"),
      mode: sources.applicationVersion ? ("desktop" as const) : ("source" as const),
      t3Version: t3Version === undefined ? null : diagnosticVersion(t3Version),
      os: knownPlatform(platform),
      arch: knownArch(arch),
      installation: hash(sources.serverId),
      harnesses: harnessesOf(installations ?? []),
    };
  });
}

interface AttemptOpening {
  readonly sequence: number;
  readonly operation: DiagnosticOperation;
  readonly startedAt: string;
  readonly environment: string;
}

const makeSqliteRecorder = (
  sql: SqlClient.SqlClient,
  readState: Effect.Effect<StateRow, unknown>,
) => {
  const openings = new WeakMap<DiagnosticAttemptRef, AttemptOpening>();
  const live = (attempt: DiagnosticAttemptRef) =>
    Effect.gen(function* () {
      const state = yield* readState;
      return recording(state, yield* now) && state.generation === attempt.generation;
    });
  const restoreAfterEviction = (attempt: DiagnosticAttemptRef) =>
    Effect.gen(function* () {
      const owner =
        yield* sql`SELECT 1 AS present FROM diagnostic_attempts WHERE id = ${attempt.id}`;
      if (owner.length > 0) return;
      const opening = openings.get(attempt)!;
      yield* sql`INSERT INTO diagnostic_attempts (sequence, id, generation, operation, started_at, truncated, environment)
        VALUES (${opening.sequence}, ${attempt.id}, ${attempt.generation}, ${opening.operation}, ${opening.startedAt}, 1, ${opening.environment})`;
    });
  const evict = Effect.gen(function* () {
    const [counted] = yield* sql<{
      count: number;
    }>`SELECT count(*) AS count FROM diagnostic_entries`;
    const excess = (counted?.count ?? 0) - DIAGNOSTIC_ENTRY_LIMIT;
    if (excess <= 0) return;
    const oldest = sql`SELECT sequence FROM diagnostic_entries ORDER BY at, sequence LIMIT ${excess}`;
    const evicted = yield* sql<{ attempt_id: string }>`
      SELECT DISTINCT attempt_id FROM diagnostic_entries WHERE sequence IN (${oldest})`;
    const ids = evicted.map((row) => row.attempt_id);
    yield* sql`DELETE FROM diagnostic_entries WHERE sequence IN (${oldest})`;
    yield* sql`UPDATE diagnostic_attempts SET truncated = 1 WHERE id IN ${sql.in(ids)}`;
    yield* sql`DELETE FROM diagnostic_attempts WHERE id IN ${sql.in(ids)} AND NOT EXISTS (
      SELECT 1 FROM diagnostic_entries WHERE attempt_id = diagnostic_attempts.id)`;
  });
  const recorder: DiagnosticRecorder = {
    open: (operation, environment, expectedGeneration, observedStart) =>
      Effect.gen(function* () {
        const before = yield* readState;
        const at = yield* now;
        if (!recording(before, at)) return null;
        const startedAt = observedStart ?? at;
        if (expectedGeneration !== undefined && before.generation !== expectedGeneration)
          return null;
        const snapshot = JSON.stringify(yield* environment);
        const id = yield* newId;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const state = yield* readState;
            if (!recording(state, yield* now) || state.generation !== before.generation)
              return null;
            const [inserted] = yield* sql<{ sequence: number }>`
              INSERT INTO diagnostic_attempts (id, generation, operation, started_at, environment)
              VALUES (${id}, ${state.generation}, ${operation}, ${startedAt}, ${snapshot})
              RETURNING sequence`;
            const attempt = { id, generation: state.generation };
            openings.set(attempt, {
              sequence: inserted!.sequence,
              operation,
              startedAt,
              environment: snapshot,
            });
            return attempt;
          }),
        );
      }),
    append: (attempt, entry, at) =>
      sql.withTransaction(
        Effect.gen(function* () {
          if (!(yield* live(attempt))) return;
          yield* restoreAfterEviction(attempt);
          yield* sql`INSERT INTO diagnostic_entries (attempt_id, at, entry)
            VALUES (${attempt.id}, ${at}, ${JSON.stringify(entry)})`;
          yield* evict;
        }),
      ),
    finish: (attempt, outcome) =>
      sql.withTransaction(
        Effect.gen(function* () {
          if (!(yield* live(attempt))) return;
          yield* sql`UPDATE diagnostic_attempts SET outcome = ${outcome} WHERE id = ${attempt.id}`;
        }),
      ),
  };
  return recorder;
};

function validRecordingInput(input: unknown): input is { enabled: boolean } {
  return (
    typeof input === "object" &&
    input !== null &&
    Object.keys(input).length === 1 &&
    "enabled" in input &&
    typeof input.enabled === "boolean"
  );
}

interface PagePosition {
  readonly startedAt: string;
  readonly sequence: number;
}

type PageQuery = { cursor: PagePosition | null; limit: number; ids: readonly string[] | null };

const PAGE_CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_(\d{1,15})$/;
const FIRST_PAGE: PagePosition = {
  startedAt: "9999-12-31T23:59:59.999Z",
  sequence: Number.MAX_SAFE_INTEGER,
};
const pageCursor = (row: AttemptRow) => `${row.started_at}_${row.sequence}`;

function pageQuery(cursor: string, limit: string, ids: string): Result<PageQuery> {
  const requested = ids === "" ? null : ids.split(",");
  const size = limit === "" ? DEFAULT_PAGE_SIZE : Number(limit);
  const position = PAGE_CURSOR.exec(cursor);
  if (cursor !== "" && position === null)
    return failure("validation", "Send the cursor of an earlier page.");
  if (!Number.isInteger(size) || size < 1 || size > DIAGNOSTIC_ATTEMPT_PAGE_LIMIT)
    return failure("validation", `Ask for 1–${DIAGNOSTIC_ATTEMPT_PAGE_LIMIT} attempts.`);
  if (
    requested !== null &&
    (requested.length > DIAGNOSTIC_ATTEMPT_PAGE_LIMIT ||
      !requested.every((id) => ATTEMPT_ID.test(id)))
  )
    return failure(
      "validation",
      `Filter by up to ${DIAGNOSTIC_ATTEMPT_PAGE_LIMIT} attempt IDs separated by commas.`,
    );
  return {
    ok: true,
    value: {
      cursor: position === null ? null : { startedAt: position[1]!, sequence: Number(position[2]) },
      limit: size,
      ids: requested,
    },
  };
}

export const makeDiagnosticLog = (
  sources: DiagnosticEnvironmentSources,
  injected: DiagnosticRecorder | undefined,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    let salt: string | undefined;
    const readState = sql<StateRow>`
      SELECT enabled_until, generation, salt FROM diagnostic_log_state WHERE singleton = 1`.pipe(
      Effect.flatMap(([state]) =>
        state === undefined
          ? Effect.fail(new Error("The Diagnostic log state is missing."))
          : Effect.sync(() => {
              salt = state.salt;
              return state;
            }),
      ),
    );
    const hash = (value: string) =>
      salt === undefined ? noDiagnosticAttempt.hash(value) : shortHash(salt, value);
    const recorder = injected ?? makeSqliteRecorder(sql, readState);
    const environment = diagnosticEnvironment(sources, hash);
    let dropped = 0;
    const upkeep = (work: Effect.Effect<unknown, unknown>) =>
      work.pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.void,
        ),
      );
    const contained = <A>(work: () => Effect.Effect<A, unknown>, fallback: A): Effect.Effect<A> =>
      Effect.suspend(work).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.interrupt
            : Effect.sync(() => {
                dropped += 1;
                return fallback;
              }),
        ),
      );
    const guardWith =
      (record: DiagnosticAttemptHandle["record"]): DiagnosticAttemptHandle["guard"] =>
      (step, work) =>
        work.pipe(
          Effect.onError((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : record({
                  type: "unexpected_error",
                  outcome: "failed",
                  step,
                  reason: "unexpected_error",
                }),
          ),
        );
    let observations = 0;
    const latest = new Map<DiagnosticOperation, LatestVerdict>();
    const remember = (operation: DiagnosticOperation, verdict: LatestVerdict) => {
      const last = latest.get(operation);
      if (last === undefined || last.order <= verdict.order) latest.set(operation, verdict);
    };
    const handle = (
      attempt: DiagnosticAttemptRef,
      operation: DiagnosticOperation,
      order: number,
    ) => {
      const entries: DiagnosticEntry[] = [];
      const recordAt = (entry: DiagnosticEntry, at: string) =>
        contained(() => {
          entries.push(entry);
          const valid = validateDiagnosticEntry(entry);
          if (!valid.ok) return Effect.fail(valid.error);
          return recorder.append(attempt, valid.value, at);
        }, undefined);
      const record = (entry: DiagnosticEntry) => Effect.flatMap(now, (at) => recordAt(entry, at));
      return {
        id: attempt.id,
        hash,
        record,
        recordAt,
        finish: (outcome: DiagnosticAttemptOutcome) =>
          contained(() => recorder.finish(attempt, outcome), undefined).pipe(
            Effect.map(() =>
              remember(operation, {
                order,
                generation: attempt.generation,
                observed: observedVerdict(entries, outcome),
              }),
            ),
          ),
        guard: guardWith(record),
      };
    };
    const open = (
      operation: DiagnosticOperation,
      order: number,
      expectedGeneration?: number,
      startedAt?: string,
    ) =>
      contained(
        () => recorder.open(operation, environment, expectedGeneration, startedAt),
        null,
      ).pipe(
        Effect.map((opened) => {
          if (opened === null) return null;
          remember(operation, { order, generation: opened.generation, observed: null });
          return handle(opened, operation, order);
        }),
      );
    const attempt = (operation: DiagnosticOperation, expectedGeneration?: number) =>
      open(operation, ++observations, expectedGeneration).pipe(
        Effect.map((opened) => opened ?? noDiagnosticAttempt),
      );

    const prune = Effect.gen(function* () {
      const cutoff = new Date(Date.parse(yield* now) - DIAGNOSTIC_RETENTION_MS).toISOString();
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE diagnostic_attempts SET truncated = 1 WHERE id IN (
            SELECT attempt_id FROM diagnostic_entries WHERE at < ${cutoff})`;
          yield* sql`DELETE FROM diagnostic_entries WHERE at < ${cutoff}`;
          yield* sql`DELETE FROM diagnostic_attempts WHERE started_at < ${cutoff} AND NOT EXISTS (
            SELECT 1 FROM diagnostic_entries WHERE attempt_id = diagnostic_attempts.id)`;
        }),
      );
    });
    const status = Effect.gen(function* (): Effect.fn.Return<Result<DiagnosticLogStatus>, unknown> {
      const state = yield* readState;
      const enabled = recording(state, yield* now);
      const [any] = yield* sql<{ present: number }>`
        SELECT EXISTS (SELECT 1 FROM diagnostic_attempts) AS present`;
      return {
        ok: true,
        value: {
          enabled,
          until: enabled ? state.enabled_until : null,
          hasEntries: any?.present === 1,
          dropped,
        },
      };
    });
    const attempts = (rows: readonly AttemptRow[]) =>
      Effect.gen(function* () {
        const ids = rows.map((row) => row.id);
        const entries = ids.length
          ? yield* sql<{ attempt_id: string; at: string; entry: string }>`
              SELECT attempt_id, at, entry FROM diagnostic_entries
              WHERE attempt_id IN ${sql.in(ids)} ORDER BY at, sequence`
          : [];
        return rows.map((row): DiagnosticAttempt => ({
          id: row.id,
          operation: row.operation,
          startedAt: row.started_at,
          outcome: row.outcome,
          truncated: row.truncated === 1,
          environment: JSON.parse(row.environment) as DiagnosticEnvironment,
          entries: entries
            .filter((entry) => entry.attempt_id === row.id)
            .map((entry) => ({ at: entry.at, entry: JSON.parse(entry.entry) as DiagnosticEntry })),
        }));
      });

    const recordingGeneration = contained(
      () =>
        Effect.gen(function* () {
          const state = yield* readState;
          return recording(state, yield* now) ? state.generation : null;
        }),
      null,
    );
    const changeAttempt = (operation: DiagnosticOperation) =>
      Effect.gen(function* (): Effect.fn.Return<DiagnosticAttemptHandle> {
        const generation = yield* recordingGeneration;
        if (generation === null) return noDiagnosticAttempt;
        const order = ++observations;
        const startedAt = yield* now;
        const steps: { entry: DiagnosticEntry; at: string }[] = [];
        const record = (entry: DiagnosticEntry) =>
          Effect.map(now, (at) => void steps.push({ entry, at }));
        return {
          id: null,
          hash,
          record,
          finish: (outcome) =>
            Effect.gen(function* () {
              const observed = observedVerdict(
                steps.map(({ entry }) => entry),
                outcome,
              );
              const last = latest.get(operation);
              if (
                last !== undefined &&
                last.order < order &&
                last.generation === generation &&
                last.observed === observed
              )
                return;
              const recording = yield* open(operation, order, generation, startedAt);
              if (recording === null) return;
              for (const { entry, at } of steps) yield* recording.recordAt(entry, at);
              yield* recording.finish(outcome);
            }),
          guard: guardWith(record),
        };
      });

    yield* upkeep(readState);
    yield* upkeep(prune);
    yield* periodicWorker(PRUNE_INTERVAL_MS, upkeep(prune), Effect.void);

    return {
      attempt,
      changeAttempt,
      recordingGeneration,
      hash,
      getDiagnosticLog: () =>
        Effect.gen(function* () {
          yield* prune;
          return yield* status;
        }),
      setDiagnosticRecording: (input: unknown) =>
        Effect.gen(function* (): Effect.fn.Return<Result<DiagnosticLogStatus>, unknown> {
          if (!validRecordingInput(input))
            return failure("validation", "Send { enabled: boolean }.");
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const state = yield* readState;
              const at = yield* now;
              if (input.enabled && !recording(state, at)) {
                const until = new Date(Date.parse(at) + DIAGNOSTIC_RECORDING_MS).toISOString();
                yield* sql`UPDATE diagnostic_log_state
                  SET enabled_until = ${until}, generation = generation + 1 WHERE singleton = 1`;
              }
              if (!input.enabled && state.enabled_until !== null)
                yield* sql`UPDATE diagnostic_log_state
                  SET enabled_until = NULL, generation = generation + 1 WHERE singleton = 1`;
            }),
          );
          return yield* status;
        }),
      deleteDiagnosticLog: () =>
        Effect.gen(function* () {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM diagnostic_entries`;
              yield* sql`DELETE FROM diagnostic_attempts`;
              yield* sql`UPDATE diagnostic_log_state SET generation = generation + 1 WHERE singleton = 1`;
            }),
          );
          dropped = 0;
          return yield* status;
        }),
      listDiagnosticAttempts: (cursor: string, limit: string, ids: string) =>
        Effect.gen(function* (): Effect.fn.Return<Result<DiagnosticAttemptPage>, unknown> {
          const query = pageQuery(cursor, limit, ids);
          if (!query.ok) return query;
          const { cursor: position, limit: size, ids: requested } = query.value;
          const before = position ?? FIRST_PAGE;
          const older = sql`(started_at < ${before.startedAt}
            OR (started_at = ${before.startedAt} AND sequence < ${before.sequence}))`;
          yield* prune;
          const rows =
            requested === null
              ? yield* sql<AttemptRow>`SELECT * FROM diagnostic_attempts WHERE ${older}
                  ORDER BY started_at DESC, sequence DESC LIMIT ${size + 1}`
              : yield* sql<AttemptRow>`SELECT * FROM diagnostic_attempts
                  WHERE id IN ${sql.in(requested)} AND ${older}
                  ORDER BY started_at DESC, sequence DESC LIMIT ${size + 1}`;
          const page = rows.slice(0, size);
          return {
            ok: true,
            value: {
              attempts: yield* attempts(page),
              nextCursor: rows.length > size ? pageCursor(page.at(-1)!) : null,
            },
          };
        }),
      exportDiagnosticLog: () =>
        Effect.gen(function* (): Effect.fn.Return<Result<string>, unknown> {
          yield* prune;
          const rows =
            yield* sql<AttemptRow>`SELECT * FROM diagnostic_attempts ORDER BY started_at DESC, sequence DESC`;
          return { ok: true, value: diagnosticLogMarkdown(yield* attempts(rows)) };
        }),
    };
  });

export type DiagnosticLog = Effect.Success<ReturnType<typeof makeDiagnosticLog>>;
