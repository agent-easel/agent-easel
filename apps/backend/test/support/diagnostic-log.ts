import { assert, type TestContext } from "@effect/vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import { DIAGNOSTIC_ENTRY_LIMIT } from "@agent-easel/domain-validation";
import type { FactoryOptions } from "../../src/index.ts";
import { migrate } from "../../src/database.ts";
import { makeDiagnosticLog, type DiagnosticRecorder } from "../../src/diagnostic-log.ts";
import { failure } from "../../src/result.ts";
import { now } from "../../src/time.ts";
import { factoryHarness } from "./factory.ts";
import { ControlledT3 } from "./controlled-t3.ts";

export const runtimeFile = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    pid: 4242,
    host: "0.0.0.0",
    port: 3773,
    origin: "http://127.0.0.1:3773",
    startedAt: "2026-11-20T08:00:00.000Z",
    serverVersion: "0.1.11",
    ...fields,
  });

export const throwingRecorder: DiagnosticRecorder = {
  open: () => Effect.succeed({ id: "00000000-0000-4000-8000-000000000000", generation: 1 }),
  append: () => {
    throw new Error("The diagnostic recorder failed to append.");
  },
  finish: () => Effect.die(new Error("The diagnostic recorder failed to finish.")),
};

export async function diagnosticHome(context: TestContext, file: string = runtimeFile()) {
  const harness = await factoryHarness(context);
  const state = join(harness.processHome, "t3-state");
  await mkdir(state);
  await writeFile(join(state, "server-runtime.json"), file);
  const open = (options: Omit<FactoryOptions, "databasePath"> = {}) =>
    harness.open({
      reportingStateDirectory: state,
      t3: new ControlledT3(),
      connectionRetryMs: 60_000,
      ...options,
    });
  return { harness, state, open };
}

export async function recordingConnection(context: TestContext) {
  const harness = await factoryHarness(context);
  const t3 = new ControlledT3();
  t3.connection.authorized = true;
  const factory = await harness.open({ t3, connectionRetryMs: 60_000 });
  assert((await factory.configureConnection({ endpoint: "http://localhost:3773/mcp" })).ok);
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);
  await factory.close();
  return { harness, t3 };
}

export async function recordingHome(context: TestContext, file?: string) {
  const home = await diagnosticHome(context, file);
  const factory = await home.open();
  assert((await factory.setDiagnosticRecording({ enabled: true })).ok);
  return { ...home, factory };
}

export const diagnosticStore = (context: TestContext) =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(async () =>
      realpath(await mkdtemp(join(tmpdir(), "agenteasel-diagnostics-"))),
    );
    context.onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const sqlContext = yield* Layer.build(
      SqliteClient.layer({ filename: join(directory, "factory.sqlite") }),
    );
    yield* Effect.provide(migrate, sqlContext);
    const open = makeDiagnosticLog(
      {
        applicationVersion: undefined,
        serverId: "diagnostic-store",
        connection: () => Effect.succeed(failure("internal", "No T3 Code connection.")),
        installations: () => Effect.succeed({ ok: true, value: [] }),
      },
      undefined,
    ).pipe(Effect.provide(sqlContext));
    return { open, sql: Context.get(sqlContext, SqlClient.SqlClient) };
  });

export const entriesAtCapacity = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const at = yield* now;
    const id = "f111e700-0000-4000-8000-000000000000";
    const entry = JSON.stringify({
      type: "t3_detection",
      outcome: "ok",
      reason: "runtime_file_found",
      file: "<T3_STATE>/server-runtime.json",
      host: "loopback",
      t3Version: "0.1.11",
    });
    yield* sql`INSERT INTO diagnostic_attempts (id, generation, operation, started_at, outcome, environment)
      VALUES (${id}, 0, 't3_detection', ${at}, 'ok', '{}')`;
    yield* sql`INSERT INTO diagnostic_entries (attempt_id, at, entry)
      WITH RECURSIVE filler(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM filler WHERE n < ${DIAGNOSTIC_ENTRY_LIMIT})
      SELECT ${id}, ${at}, ${entry} FROM filler`;
  });

export function diagnosticStateMissing(databasePath: string) {
  using database = new DatabaseSync(databasePath);
  database.exec("DELETE FROM diagnostic_log_state");
}

export function diagnosticPruneRefused(databasePath: string) {
  using database = new DatabaseSync(databasePath);
  database.exec("UPDATE diagnostic_entries SET at = '2000-01-01T00:00:00.000Z'");
  database.exec(
    "CREATE TRIGGER refused_diagnostic_prune BEFORE DELETE ON diagnostic_entries BEGIN SELECT RAISE(ABORT, 'storage refused'); END",
  );
}

export function projectStorageRefused(databasePath: string) {
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TRIGGER refused_project_update BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT, 'storage refused'); END",
  );
  return () => {
    database.exec("DROP TRIGGER refused_project_update");
    database.close();
  };
}

export const afterScheduledChecks = (factory: {
  readonly listProjects: () => Effect.Effect<unknown, unknown>;
}) => factory.listProjects();
