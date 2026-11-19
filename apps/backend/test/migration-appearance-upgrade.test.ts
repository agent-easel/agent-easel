import { expect, it, type TestContext } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import * as Effect from "effect/Effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import type { AppearancePresentation, AppearanceSource } from "@t3-factory/contracts";
import { migrate } from "../src/database.ts";
import { latestAppearance } from "./support/appearance.ts";
import { factoryHarness } from "./support/factory.ts";
import { subscribe } from "./support/live.ts";
import { loadMigrationData, restoreCapturedAdapter } from "./support/migration-data.ts";

interface Capture {
  t3: Record<string, unknown>;
  /** What v0.5.0 published while following T3's Ocean theme with a paired grant. */
  presentation: AppearancePresentation & { grant: { id: string; expiresAt: string } };
  source: AppearanceSource & { grantId: string };
}

/** The v0.5.0 capture of a host following T3's Ocean theme, with what it shows without the grant. */
async function pairedThemeCapture(c: TestContext) {
  const h = await factoryHarness(c);
  const captured = await loadMigrationData<Capture>(
    h.databasePath,
    "appearance-grant-upgrade-data.json",
  );
  const { grant: _grant, ...colors } = captured.presentation;
  const { grantId: _grantId, ...source } = captured.source;
  return { h, captured, colors, source };
}

it("upgrading removes the grant from the stored theme-color snapshot and keeps its colors", async (c) => {
  // Arrange
  const { h, colors } = await pairedThemeCapture(c);

  // Act
  await Effect.runPromise(
    Effect.provide(migrate, SqliteClient.layer({ filename: h.databasePath })),
  );

  // Assert
  const db = new DatabaseSync(h.databasePath, { readOnly: true });
  const row = db.prepare("SELECT endpoint, presentation FROM appearance_snapshot").get() as {
    endpoint: string;
    presentation: string;
  };
  db.close();
  expect(JSON.parse(row.presentation)).toStrictEqual(colors);
  expect(row.endpoint).toBe("http://127.0.0.1:3773/mcp");
});

it("an upgraded host shows its kept theme colors from the first status while T3 is unreachable", async (c) => {
  // Arrange
  const { h, captured, colors, source } = await pairedThemeCapture(c);
  const t3 = await restoreCapturedAdapter(captured.t3, h.processHome);
  t3.connection.available = false;

  // Act
  const factory = await h.open({ t3, connectionRetryMs: 60_000 });

  // Assert
  const live = subscribe(c, factory.live.watchAppearance());
  const messages = await live.until((received) => latestAppearance(received) !== null);
  expect(messages[0]?.appearance.presentation).toStrictEqual(colors);
  expect(await factory.getAppearanceSource()).toStrictEqual({ ok: true, value: source });
});
