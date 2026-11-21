import { expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../src/migrations/", import.meta.url);
const SETTLEMENT_REASON = "113_settlement_reason.sql";

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

it("the settlement reason migration keeps every recorded settlement and backfills manual", () => {
  // Arrange
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = OFF");
  applyBefore(database, SETTLEMENT_REASON);
  database.exec(
    `INSERT INTO run_settlements(run_id,requested_at,attempt,attempt_owner,attempted_at,stop_pass_at)
     VALUES ('run-a','2026-11-01T10:00:00.000Z',1,'owner','2026-11-01T10:00:00.000Z',NULL),
            ('run-b','2026-11-02T10:00:00.000Z',3,'owner','2026-11-02T11:00:00.000Z','2026-11-02T11:00:01.000Z')`,
  );

  // Act
  apply(database, SETTLEMENT_REASON);

  // Assert
  const rows = database
    .prepare(
      "SELECT run_id, requested_at, attempt, stop_pass_at, reason FROM run_settlements ORDER BY run_id",
    )
    .all();
  database.close();
  expect(rows.map((row) => ({ ...row }))).toStrictEqual([
    {
      run_id: "run-a",
      requested_at: "2026-11-01T10:00:00.000Z",
      attempt: 1,
      stop_pass_at: null,
      reason: "manual",
    },
    {
      run_id: "run-b",
      requested_at: "2026-11-02T10:00:00.000Z",
      attempt: 3,
      stop_pass_at: "2026-11-02T11:00:01.000Z",
      reason: "manual",
    },
  ]);
});
