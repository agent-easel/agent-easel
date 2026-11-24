import { expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../src/migrations/", import.meta.url);
const DROP_RECEIPTS = "133_drop_installed_update_receipts.sql";

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

it("an upgrade drops the installed update receipts and preserves unaffected data", () => {
  // Arrange
  const database = new DatabaseSync(":memory:");
  applyBefore(database, DROP_RECEIPTS);
  database.exec(
    `INSERT INTO installed_update_receipts(receipt_id)
     VALUES ('0b9e1c52-6f0e-4d3a-9c8e-2f4b7a1d5e60'), ('7c2d4e81-3a5b-4f6c-8d9e-0a1b2c3d4e5f')`,
  );
  database.exec("UPDATE first_run_setup SET completed=1");
  const unaffected = () =>
    ["factory_server", "first_run_setup"].map((table) =>
      database
        .prepare(`SELECT * FROM ${table}`)
        .all()
        .map((row) => ({ ...row })),
    );
  const before = unaffected();

  // Act
  apply(database, DROP_RECEIPTS);

  // Assert
  const retired = database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'installed_update_receipts'",
    )
    .get();
  expect(retired).toBeUndefined();
  expect(unaffected()).toStrictEqual(before);
  expect(before.flat()).not.toHaveLength(0);
  database.close();
});
