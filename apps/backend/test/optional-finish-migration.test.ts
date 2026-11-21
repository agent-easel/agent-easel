import { expect, it } from "@effect/vitest";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const directory = new URL("../src/migrations/", import.meta.url);
const OPTIONAL_FINISH = "119_optional_finish_block.sql";

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

it("the optional Finish migration removes Finish blocks without endings and keeps those with endings, their wires and the guard", () => {
  // Arrange
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = OFF");
  applyBefore(database, OPTIONAL_FINISH);
  database.exec(
    `INSERT INTO flow_revisions(id,flow_id,revision,name,input_x,input_y,saved_at)
     VALUES ('plain','flow-a',1,'Plain',0,0,'2026-11-21T10:00:00.000Z'),
            ('ending','flow-b',1,'Ending',0,0,'2026-11-21T10:00:00.000Z');
     INSERT INTO flow_revision_finish(flow_revision_id,x,y) VALUES ('plain',620,0),('ending',900,40);
     INSERT INTO flow_revision_endings(flow_revision_id,ending_id,ordinal,name,description,output,output_description)
     VALUES ('ending','delivered',0,'Delivered','','required','PR URL');
     INSERT INTO flow_revision_connections(flow_revision_id,ordinal,source_block_id,exit_id,target_block_id,target_ending_id)
     VALUES ('ending',0,'coder','done',NULL,'delivered')`,
  );

  // Act
  apply(database, OPTIONAL_FINISH);

  // Assert
  const finishes = database.prepare("SELECT * FROM flow_revision_finish").all();
  const wires = database.prepare("SELECT target_ending_id FROM flow_revision_connections").all();
  const guarded = () => database.exec("DELETE FROM flow_revision_finish");
  expect(finishes.map((row) => ({ ...row }))).toStrictEqual([
    { flow_revision_id: "ending", x: 900, y: 40 },
  ]);
  expect(wires.map((row) => ({ ...row }))).toStrictEqual([{ target_ending_id: "delivered" }]);
  expect(guarded).toThrow("Flow revisions are immutable");
  database.close();
});
