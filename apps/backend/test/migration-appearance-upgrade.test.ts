import { expect, it } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { migrate } from "../src/database.ts";
import { factoryHarness } from "./support/factory.ts";
import { loadMigrationData } from "./support/migration-data.ts";

it("upgrading from a database with a stored T3 theme snapshot drops the retired table and preserves unaffected data", async (c) => {
  // Arrange
  const h = await factoryHarness(c);
  await loadMigrationData(h.databasePath, "appearance-grant-upgrade-data.json");
  const beforeDb = new DatabaseSync(h.databasePath, { readOnly: true });
  const beforeServer = beforeDb.prepare("SELECT * FROM factory_server").all();
  const beforeConnection = beforeDb.prepare("SELECT * FROM t3_connection").all();
  const beforeContexts = beforeDb.prepare("SELECT * FROM t3_authorization_contexts").all();
  beforeDb.close();

  // Act
  await Effect.runPromise(
    Effect.provide(migrate, SqliteClient.layer({ filename: h.databasePath })),
  );

  // Assert
  const afterDb = new DatabaseSync(h.databasePath, { readOnly: true });
  const retiredTable = afterDb
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'appearance_snapshot'")
    .get();
  const afterServer = afterDb.prepare("SELECT * FROM factory_server").all();
  const afterConnection = afterDb.prepare("SELECT * FROM t3_connection").all();
  const afterContexts = afterDb.prepare("SELECT * FROM t3_authorization_contexts").all();
  afterDb.close();
  expect(retiredTable).toBeUndefined();
  expect(afterServer).toStrictEqual(beforeServer);
  expect(afterConnection).toStrictEqual(beforeConnection);
  expect(afterContexts).toStrictEqual(beforeContexts);
});
