import { expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../src/migrations/", import.meta.url);
const JOIN_LIFECYCLE = "128_join_lifecycle.sql";

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

it("the Join lifecycle migration keeps every recorded chat matter in place", () => {
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
  database.close();
});
