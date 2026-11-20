-- First-run setup completion is installation-wide durable state, never derived from the live T3
-- connection, so a later outage cannot gate the application again. An installation that already
-- has a saved T3 endpoint is already set up and is recorded as completed; a fresh home has no
-- saved endpoint and starts not completed.
CREATE TABLE first_run_setup (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  completed INTEGER NOT NULL CHECK (completed IN (0, 1))
)
-- statement-breakpoint
INSERT INTO first_run_setup (singleton, completed) SELECT 1, EXISTS (SELECT 1 FROM t3_connection)
