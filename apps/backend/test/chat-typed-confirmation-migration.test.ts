import { expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../src/migrations/", import.meta.url);
const TYPED_CONFIRMATION = "129_chat_typed_confirmation.sql";

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

const proposal = (id: string, state: string, expiresAt: string, endedReason = "NULL") =>
  `('${id}','app','guild','channel','thread','user','start','{}','${id}','[]',1,'message','call',
    '${state}',${endedReason},'2026-11-20T10:00:00.000Z','${expiresAt}','button-${id}',0)`;

it("a review still waiting for a button click at upgrade expires, and no button message is edited later", () => {
  // Arrange
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = OFF");
  applyBefore(database, TYPED_CONFIRMATION);
  database.exec(
    `INSERT INTO chat_proposals(id,application_id,guild_id,parent_channel_id,thread_id,requester_id,operation,
       parameters_json,identity,project_ids_json,generation,message_id,tool_call_id,state,ended_reason,created_at,
       expires_at,button_message_id,button_settled)
     VALUES ${proposal("waiting", "presented", "2999-01-01T00:00:00.000Z")},
            ${proposal("replaced", "ended", "2026-11-20T10:05:00.000Z", "'superseded'")}`,
  );

  // Act
  apply(database, TYPED_CONFIRMATION);

  // Assert
  const rows = database
    .prepare(
      "SELECT id,state,expires_at,confirmation_code,confirmation_message_id,resolution_settled FROM chat_proposals ORDER BY id",
    )
    .all()
    .map((row) => ({ ...row }));
  expect(rows).toStrictEqual([
    {
      id: "replaced",
      state: "ended",
      expires_at: "2026-11-20T10:05:00.000Z",
      confirmation_code: null,
      confirmation_message_id: "button-replaced",
      resolution_settled: 1,
    },
    {
      id: "waiting",
      state: "presented",
      expires_at: "2026-11-20T10:00:00.000Z",
      confirmation_code: null,
      confirmation_message_id: "button-waiting",
      resolution_settled: 1,
    },
  ]);
  database.close();
});
