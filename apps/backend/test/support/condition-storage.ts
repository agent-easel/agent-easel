import { DatabaseSync } from "node:sqlite";
import { CONDITION_ARRIVAL_MAX } from "@t3-factory/contracts";

/** The open backend's storage, for a change no public operation can make. */
function openStorage(databasePath: string) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  return database;
}

/**
 * Makes the open backend's storage refuse to record a Condition arrival, as a transient storage
 * failure would, until the returned function restores it. No public operation can make a Run
 * transaction fail, so this one schema trigger stands in for the outage.
 */
export function conditionStorageInterrupted(databasePath: string) {
  const database = openStorage(databasePath);
  database.exec(
    "CREATE TRIGGER interrupted_condition_storage BEFORE INSERT ON condition_arrivals BEGIN SELECT RAISE(ABORT, 'storage interrupted'); END",
  );
  return () => {
    database.exec("DROP TRIGGER interrupted_condition_storage");
    database.close();
  };
}

/**
 * Renumbers the one Condition arrival already selected to the largest safe integer and moves its
 * count there, consistently, so the next arrival number is not representable. Reaching it through
 * public operations would take that many arrivals.
 */
export function conditionCountAtMaximum(databasePath: string) {
  const database = openStorage(databasePath);
  database
    .prepare("UPDATE condition_arrivals SET arrival_number=? WHERE state='selected'")
    .run(BigInt(CONDITION_ARRIVAL_MAX));
  database.prepare("UPDATE condition_counters SET arrivals=?").run(BigInt(CONDITION_ARRIVAL_MAX));
  database.close();
}

/**
 * Deletes captured Condition rule `ruleId` from every stored Flow revision while the backend is
 * closed, leaving the wires that leave by its output. Captured revisions are immutable, so the
 * immutability trigger is dropped for the change and recreated as the schema defines it.
 */
export function capturedConditionRuleDeleted(databasePath: string, ruleId: string) {
  const database = openStorage(databasePath);
  database.exec("BEGIN");
  database.exec("DROP TRIGGER immutable_flow_revision_condition_rule_delete");
  database.prepare("DELETE FROM flow_revision_condition_rules WHERE rule_id=?").run(ruleId);
  database.exec(
    "CREATE TRIGGER immutable_flow_revision_condition_rule_delete BEFORE DELETE ON flow_revision_condition_rules BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END",
  );
  database.exec("COMMIT");
  database.close();
}
