import { DatabaseSync } from "node:sqlite";

function openStorage(databasePath: string) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

export function joinStorageInterrupted(databasePath: string) {
  const database = openStorage(databasePath);
  database.exec(
    "CREATE TRIGGER interrupted_join_storage BEFORE INSERT ON join_arrivals BEGIN SELECT RAISE(ABORT, 'storage interrupted'); END",
  );
  return () => {
    database.exec("DROP TRIGGER interrupted_join_storage");
    database.close();
  };
}

export function queuedJoinMessageLost(databasePath: string) {
  const database = openStorage(databasePath);
  database.exec(
    "UPDATE operation_intents SET payload_json=NULL WHERE id IN (SELECT incoming_intent_id FROM join_arrivals WHERE round_id IS NULL AND cancelled_at IS NULL)",
  );
  database.close();
}

export function queuedJoinMessageAltered(databasePath: string) {
  const database = openStorage(databasePath);
  database.exec(
    `UPDATE operation_intents SET payload_json='{"message":"Altered."}' WHERE id IN (SELECT incoming_intent_id FROM join_arrivals WHERE round_id IS NULL AND cancelled_at IS NULL)`,
  );
  database.close();
}

export function joinRoundAtMaximum(databasePath: string) {
  const database = openStorage(databasePath);
  database.prepare("UPDATE join_rounds SET number=?").run(BigInt(Number.MAX_SAFE_INTEGER));
  database.close();
}

export function joinRoundsForwarded(
  databasePath: string,
  runId: string,
  blockId: string,
  rounds: number,
) {
  const database = openStorage(databasePath);
  database.exec("BEGIN");
  const round = database.prepare(
    "INSERT INTO join_rounds(id,run_id,block_id,number,forwarded_at,message) VALUES(?,?,?,?,?,NULL)",
  );
  const event = database.prepare(
    "INSERT INTO run_events(run_id,block_id,kind,source_key,observed_at,cause_id) VALUES(?,?,'join-round-forwarded',?,?,?)",
  );
  for (let number = 1; number <= rounds; number++) {
    const id = `synthetic-round-${number}`;
    const at = new Date(Date.UTC(2026, 10, 7, 9, 0, number)).toISOString();
    round.run(id, runId, blockId, number, at);
    event.run(runId, blockId, `join-round-forwarded:${id}`, at, id);
  }
  database.exec("COMMIT");
  database.close();
}

export function foreignJoinQueue(databasePath: string, runId: string, otherRunId: string) {
  const database = openStorage(databasePath);
  database
    .prepare("UPDATE join_arrivals SET run_id=? WHERE run_id=? AND round_id IS NULL")
    .run(runId, otherRunId);
  database.close();
}

export function capturedJoinEndingMissing(databasePath: string) {
  const database = openStorage(databasePath);
  database.exec("PRAGMA foreign_keys=OFF");
  database.exec("BEGIN");
  database.exec("DROP TRIGGER immutable_flow_revision_ending_delete");
  database.exec("DELETE FROM flow_revision_endings");
  database.exec(
    "CREATE TRIGGER immutable_flow_revision_ending_delete BEFORE DELETE ON flow_revision_endings BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END",
  );
  database.exec("COMMIT");
  database.close();
}
