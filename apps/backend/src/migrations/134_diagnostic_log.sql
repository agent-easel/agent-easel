-- The opt-in Diagnostic log. `enabled_until` is NULL while recording is off; every append checks
-- it and `generation` in the same transaction, and enable, disable and Delete advance the
-- generation so earlier attempt handles stop writing. `salt` keys the short hashes of identities.
CREATE TABLE diagnostic_log_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  enabled_until TEXT,
  generation INTEGER NOT NULL,
  salt TEXT NOT NULL
)
-- statement-breakpoint
INSERT INTO diagnostic_log_state (singleton, enabled_until, generation, salt)
VALUES (1, NULL, 0, lower(hex(randomblob(16))))
-- statement-breakpoint
-- `environment` is the redacted JSON snapshot captured when the attempt opened; `truncated` marks an
-- attempt whose opening entries were evicted by the entry cap.
CREATE TABLE diagnostic_attempts (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL,
  operation TEXT NOT NULL,
  started_at TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('ok', 'failed', 'partial')),
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
  environment TEXT NOT NULL
)
-- statement-breakpoint
CREATE TABLE diagnostic_entries (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id TEXT NOT NULL REFERENCES diagnostic_attempts(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  entry TEXT NOT NULL
)
-- statement-breakpoint
CREATE INDEX diagnostic_entries_attempt ON diagnostic_entries(attempt_id, sequence)
-- statement-breakpoint
CREATE INDEX diagnostic_entries_at ON diagnostic_entries(at)
-- statement-breakpoint
CREATE INDEX diagnostic_attempts_started ON diagnostic_attempts(started_at)
