import { expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../src/migrations/", import.meta.url);
const JOIN_LIFECYCLE = "127_join_lifecycle.sql";

function apply(database: DatabaseSync, file: string) {
  for (const statement of readFileSync(new URL(file, directory), "utf8")
    .split(/^-- statement-breakpoint\s*$/m)
    .filter((part) => part.trim()))
    database.exec(statement);
}

function applyBefore(database: DatabaseSync, last: string) {
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".sql") && name < last)
    .sort())
    apply(database, file);
}

it("the Join lifecycle migration keeps every recorded chat matter in place and lets Join integrity Problems be recorded", () => {
  // Arrange
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = OFF");
  applyBefore(database, JOIN_LIFECYCLE);
  database.exec(
    `INSERT INTO chat_report_matters(matter_id,run_id,notice_id,kind,block,appeared_at,resolved)
     VALUES ('matter-a','run-a',NULL,'human','review','2026-11-01T10:00:00.000Z',1),
            ('matter-b','run-a',NULL,'condition-integrity','gate','2026-11-01T11:00:00.000Z',0),
            ('matter-c','run-b',NULL,'settlement-unresolved',NULL,'2026-11-02T10:00:00.000Z',0)`,
  );
  const before = database.prepare("SELECT rowid,* FROM chat_report_matters ORDER BY rowid").all();

  // Act
  apply(database, JOIN_LIFECYCLE);

  // Assert
  const after = database.prepare("SELECT rowid,* FROM chat_report_matters ORDER BY rowid").all();
  expect(after.map((row) => ({ ...row }))).toStrictEqual(before.map((row) => ({ ...row })));
  database.exec(
    `INSERT INTO chat_report_matters(matter_id,run_id,notice_id,kind,block,appeared_at)
     VALUES ('matter-d','run-b',NULL,'join-integrity','merge','2026-11-02T11:00:00.000Z')`,
  );
  expect(() =>
    database.exec(
      `INSERT INTO chat_report_matters(matter_id,run_id,notice_id,kind,block,appeared_at)
       VALUES ('matter-e','run-b',NULL,'unknown-kind','merge','2026-11-02T12:00:00.000Z')`,
    ),
  ).toThrow(/CHECK constraint failed/);
  expect(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chat_report_matters' AND name NOT GLOB 'sqlite_*' ORDER BY name",
      )
      .all()
      .map((row) => row.name),
  ).toEqual(["chat_report_matters_notice", "chat_report_matters_run"]);
  database.close();
});

it("the Join lifecycle migration records one cancellation per Join round", () => {
  // Arrange
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = OFF");
  applyBefore(database, JOIN_LIFECYCLE);
  apply(database, JOIN_LIFECYCLE);
  const cancel = (id: string, round: number) =>
    database
      .prepare(
        "INSERT INTO join_cancellations(id,run_id,block_id,round_number,cancelled_at) VALUES (?,'run-a','merge',?,'2026-11-01T10:00:00.000Z')",
      )
      .run(id, round);
  cancel("cancel-1", 1);

  expect(() => cancel("cancel-2", 1)).toThrow(/UNIQUE constraint failed/);
  expect(() => cancel("cancel-3", 0)).toThrow(/CHECK constraint failed/);
  cancel("cancel-4", 2);
  database.close();
});
