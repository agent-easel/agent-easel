import { expect, it } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { migrate } from "../src/database.ts";
import { factoryHarness } from "./support/factory.ts";

const migrationsDirectory = fileURLToPath(new URL("../src/migrations/", import.meta.url));

function applyMigrationsThrough(databasePath: string, lastId: number) {
  const db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE IF NOT EXISTS effect_sql_migrations (
    migration_id integer PRIMARY KEY NOT NULL,
    created_at datetime NOT NULL DEFAULT current_timestamp,
    name VARCHAR(255) NOT NULL
  )`);
  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const id = Number(file.slice(0, 3));
    if (id > lastId) continue;
    const statements = readFileSync(join(migrationsDirectory, file), "utf8")
      .split(/^-- statement-breakpoint\s*$/m)
      .filter((statement) => statement.trim());
    db.exec("BEGIN");
    for (const statement of statements) db.exec(statement);
    db.prepare("INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?)").run(
      id,
      file.slice(4, -4),
    );
    db.exec("COMMIT");
  }
  db.close();
}

function seedPreUpgradeTitles(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`INSERT INTO projects (id, endpoint, environment_id, project_id, title, workspace_root, availability, observed_at)
    VALUES ('project', 'http://127.0.0.1:9/mcp', 'env', 't3-project', 'Project', '/tmp/project', 'ready', '2026-01-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO tasks (id, project_id, title, created_at)
    VALUES ('task', 'project', 'Task', '2026-01-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO t3_authorization_contexts (id, endpoint, authorization_identity, environment_id, created_at)
    VALUES ('context', 'http://127.0.0.1:9/mcp', 'grant', 'env', '2026-01-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO flows (id, created_at) VALUES ('flow', '2026-01-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO flow_revisions (id, flow_id, revision, name, input_x, input_y, saved_at)
    VALUES ('revision', 'flow', 1, 'Flow', 0, 0, '2026-01-01T00:00:00.000Z')`);
  db.exec(`INSERT INTO runs (id, task_id, request_id, request_fingerprint, input, context_id, workspace_root, started_at, title, created_at, creation_key, flow_revision_id)
    VALUES ('run', 'task', 'request', 'fingerprint', 'prompt', 'context', '/tmp/project', '2026-01-01T00:00:00.000Z', 'Legacy title', '2026-01-01T00:00:00.000Z', 'request', 'revision')`);
  db.exec(
    `INSERT INTO run_blocks (run_id, block_id, name, state) VALUES ('run', 'bound', 'Entry worker', 'working')`,
  );
  db.exec(
    `INSERT INTO run_blocks (run_id, block_id, name, state) VALUES ('run', 'unbound', 'Later worker', 'not-started')`,
  );
  db.exec(`INSERT INTO run_thread_bindings (id, run_id, block_id, environment_id, thread_id, role)
    VALUES ('binding', 'run', 'bound', 'env', 'thread-legacy', 'worker')`);
  db.exec(`INSERT INTO operation_intents (id, run_id, block_id, kind, cause, target_json, request_key, payload_json, fingerprint, context_id, state)
    VALUES ('launch', 'run', 'unbound', 'launch', 'start:unbound', '{}', 'launch-key', '{"title":"Factory #1 · 2 Later worker"}', 'fingerprint', 'context', 'uncertain')`);
  db.close();
}

it("upgrading baselines a bound legacy worker and leaves an unbound legacy launch intent unchanged", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  applyMigrationsThrough(h.databasePath, 112);
  seedPreUpgradeTitles(h.databasePath);

  // Act
  await Effect.runPromise(
    Effect.provide(migrate, SqliteClient.layer({ filename: h.databasePath })),
  );

  // Assert
  const db = new DatabaseSync(h.databasePath, { readOnly: true });
  const bound = db
    .prepare(
      "SELECT title_synced_revision, title_sync_state, title_target, title_acknowledged FROM run_thread_bindings WHERE id = 'binding'",
    )
    .get() as {
    title_synced_revision: number | null;
    title_sync_state: string | null;
    title_target: string | null;
    title_acknowledged: string | null;
  };
  const launch = db
    .prepare("SELECT payload_json FROM operation_intents WHERE id = 'launch'")
    .get() as { payload_json: string };
  const bindings = db.prepare("SELECT thread_id FROM run_thread_bindings").all() as {
    thread_id: string;
  }[];
  db.close();
  expect({ ...bound }).toStrictEqual({
    title_synced_revision: 0,
    title_sync_state: null,
    title_target: null,
    title_acknowledged: null,
  });
  expect(JSON.parse(launch.payload_json)).toMatchObject({ title: "Factory #1 · 2 Later worker" });
  expect(bindings.map((row) => row.thread_id)).toStrictEqual(["thread-legacy"]);
});
