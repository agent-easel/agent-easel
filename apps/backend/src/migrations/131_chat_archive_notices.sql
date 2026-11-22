-- Keep every delivery identity, order and reference. The delivery purposes gain `archive`, the
-- notice posted once in a chat-started Run's originating thread when the Run is Archived.
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TEMP TABLE chat_deliveries_saved AS SELECT rowid AS saved_rowid, * FROM chat_deliveries
-- statement-breakpoint
DROP TABLE chat_deliveries
-- statement-breakpoint
CREATE TABLE chat_deliveries (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('receipt', 'status-card', 'attention', 'lifecycle', 'catch-up', 'completion', 'archive')),
  action_id TEXT REFERENCES chat_actions(id),
  run_id TEXT,
  guild_id TEXT NOT NULL,
  parent_channel_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  project_ids_json TEXT NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('owed', 'sending', 'delivered', 'failed', 'unknown', 'cancelled', 'lost', 'retired')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT,
  problem TEXT,
  problem_at TEXT,
  message_id TEXT,
  sent_by_application_id TEXT,
  created_at TEXT NOT NULL,
  CHECK ((problem IS NULL) = (problem_at IS NULL)),
  CHECK ((purpose = 'receipt') = (run_id IS NULL)),
  CHECK (purpose <> 'receipt' OR state NOT IN ('lost', 'retired'))
)
-- statement-breakpoint
INSERT INTO chat_deliveries (rowid, id, purpose, action_id, run_id, guild_id, parent_channel_id, thread_id, project_ids_json, text, state, attempts, next_attempt_at, problem, problem_at, message_id, sent_by_application_id, created_at)
SELECT saved_rowid, id, purpose, action_id, run_id, guild_id, parent_channel_id, thread_id, project_ids_json, text, state, attempts, next_attempt_at, problem, problem_at, message_id, sent_by_application_id, created_at FROM chat_deliveries_saved
-- statement-breakpoint
DROP TABLE chat_deliveries_saved
-- statement-breakpoint
CREATE INDEX chat_deliveries_state ON chat_deliveries(state)
-- statement-breakpoint
CREATE INDEX chat_deliveries_message ON chat_deliveries(message_id)
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
-- statement-breakpoint
CREATE INDEX chat_deliveries_pending_completion ON chat_deliveries(run_id)
WHERE purpose='completion' AND message_id IS NULL AND state IN ('owed','sending','failed','unknown')
-- statement-breakpoint
-- Whether the Run's Archive notice was accounted for, so a Run posts one however often it is captured.
ALTER TABLE chat_run_reporting ADD COLUMN archive_noticed INTEGER NOT NULL DEFAULT 0 CHECK (archive_noticed IN (0, 1))
-- statement-breakpoint
-- Introducing Archive notices does not announce Runs an upgraded host already archived.
INSERT INTO chat_run_reporting (run_id,archive_noticed)
SELECT o.run_id,1 FROM chat_run_origins o JOIN runs r ON r.id=o.run_id WHERE r.archived_at IS NOT NULL
ON CONFLICT(run_id) DO UPDATE SET archive_noticed=1
