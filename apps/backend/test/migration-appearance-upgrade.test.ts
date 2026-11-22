import { expect, it } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { migrate } from "../src/database.ts";
import { factoryHarness } from "./support/factory.ts";
import { loadMigrationData } from "./support/migration-data.ts";

it("upgrading from a database with a stored T3 theme snapshot drops the retired table", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  await loadMigrationData(h.databasePath, "appearance-grant-upgrade-data.json");

  // Act
  await Effect.runPromise(
    Effect.provide(migrate, SqliteClient.layer({ filename: h.databasePath })),
  );

  // Assert
  const db = new DatabaseSync(h.databasePath, { readOnly: true });
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'appearance_snapshot'")
    .get();
  db.close();
  expect(row).toBeUndefined();
});
