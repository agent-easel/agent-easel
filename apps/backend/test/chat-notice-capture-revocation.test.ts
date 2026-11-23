import { expect, it } from "@effect/vitest";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { reportNotices } from "../src/chat-control/report-notices.ts";
import type { ReportOrigin, RunReport } from "../src/chat-control/run-reports.ts";
import { migrate } from "../src/database.ts";

const origin: ReportOrigin = {
  runId: "run",
  applicationId: "application",
  destination: { guildId: "guild", parentChannelId: "channel", threadId: "thread" },
};

const archivedBeforeRevocation: RunReport = {
  run: {
    id: "run",
    number: 1,
    title: "Improve search",
    project: { id: "project", name: "Project", repositoryPath: "/workspace" },
    flow: "Flow",
    state: "archived",
    startedAt: "2026-11-23T10:00:00.000Z",
  },
  settlement: null,
  endingName: null,
  blocks: [],
  needsInput: [],
  problems: [],
};

it.effect(
  "an Archive capture whose Run read predates a Project revocation owes no notice and keeps the regrant baseline",
  () =>
    Effect.gen(function* () {
      // Arrange
      const sql = yield* SqlClient.SqlClient;
      yield* migrate;
      yield* sql`PRAGMA foreign_keys = OFF`;
      yield* sql`INSERT INTO chat_run_reporting (run_id,baseline) VALUES ('run',1)`;

      // Act
      yield* sql.withTransaction(reportNotices(sql).capture(origin, archivedBeforeRevocation));

      // Assert
      expect(yield* sql`SELECT purpose FROM chat_deliveries`).toStrictEqual([]);
      expect(yield* sql`SELECT baseline,archive_noticed FROM chat_run_reporting`).toEqual([
        { baseline: 1, archive_noticed: 0 },
      ]);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);
