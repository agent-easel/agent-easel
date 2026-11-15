import { DatabaseSync } from "node:sqlite";

/**
 * Makes the open backend's storage refuse to record a Condition arrival, as a transient storage
 * failure would, until the returned function restores it. No public operation can make a Run
 * transaction fail, so this one schema trigger stands in for the outage.
 */
export function conditionStorageInterrupted(databasePath: string) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(
    "CREATE TRIGGER interrupted_condition_storage BEFORE INSERT ON condition_arrivals BEGIN SELECT RAISE(ABORT, 'storage interrupted'); END",
  );
  return () => {
    database.exec("DROP TRIGGER interrupted_condition_storage");
    database.close();
  };
}
