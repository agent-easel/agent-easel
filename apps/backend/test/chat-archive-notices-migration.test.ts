import { expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../src/migrations/", import.meta.url);
const ARCHIVE_NOTICES = "131_chat_archive_notices.sql";

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

it("an upgrade keeps every delivery and does not announce a Run that was already Archived", () => {
  // Arrange
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = OFF");
  applyBefore(database, ARCHIVE_NOTICES);
  database.exec(
    `INSERT INTO chat_run_origins(run_id,application_id,guild_id,parent_channel_id,thread_id,recorded_at,action_id)
     VALUES ('archived','app','guild','channel','thread','2026-11-20T10:00:00.000Z','action-1'),
            ('active','app','guild','channel','thread','2026-11-20T10:00:00.000Z','action-2')`,
  );
  database.exec(
    `INSERT INTO runs(id,task_id,request_id,request_fingerprint,input,context_id,workspace_root,started_at,flow_revision_id,archived_at)
     VALUES ('archived','task','r1','f','input','context','/w','2026-11-20T10:00:00.000Z','revision','2026-11-21T10:00:00.000Z'),
            ('active','task','r2','f','input','context','/w','2026-11-20T10:00:00.000Z','revision',NULL)`,
  );
  database.exec(
    `INSERT INTO chat_deliveries(id,purpose,run_id,guild_id,parent_channel_id,thread_id,project_ids_json,text,state,created_at)
     VALUES ('card','status-card','active','guild','channel','thread','[]','card','delivered','2026-11-20T10:00:00.000Z')`,
  );

  // Act
  apply(database, ARCHIVE_NOTICES);

  // Assert
  const noticed = database
    .prepare("SELECT run_id,archive_noticed FROM chat_run_reporting ORDER BY run_id")
    .all()
    .map((row) => ({ ...row }));
  expect(noticed).toStrictEqual([{ run_id: "archived", archive_noticed: 1 }]);
  const deliveries = database
    .prepare("SELECT id,purpose,state FROM chat_deliveries")
    .all()
    .map((row) => ({ ...row }));
  expect(deliveries).toStrictEqual([{ id: "card", purpose: "status-card", state: "delivered" }]);
  database.exec(
    `INSERT INTO chat_deliveries(id,purpose,run_id,guild_id,parent_channel_id,thread_id,project_ids_json,text,state,created_at)
     VALUES ('notice','archive','active','guild','channel','thread','[]','notice','owed','2026-11-22T10:00:00.000Z')`,
  );
  database.close();
});
