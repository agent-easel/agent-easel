-- The Settle could not stop workers Problem is about the Run, not one Block, so a Run-level
-- attention matter has no Block: run_attention.block_id becomes nullable, and Chat control's
-- report matters accept the new kind without a Block name. Both tables are rebuilt with every row,
-- including its rowid, which orders attention of the same appearance time. Rows are restored
-- after the old table is dropped: re-inserting parent rows is what clears the deferred foreign
-- key violations the drop records for children.
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TEMP TABLE run_attention_saved AS SELECT rowid AS saved_rowid, * FROM run_attention
-- statement-breakpoint
DROP TABLE run_attention
-- statement-breakpoint
CREATE TABLE run_attention (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  -- NULL for a Run-level matter.
  block_id TEXT,
  execution_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_key TEXT NOT NULL,
  native_request_id TEXT,
  occurrence_id TEXT,
  appeared_at TEXT NOT NULL,
  settled_at TEXT,
  settlement_reason TEXT,
  message TEXT,
  binding_id TEXT REFERENCES run_thread_bindings(id),
  UNIQUE(run_id,source_key),
  FOREIGN KEY(run_id,block_id) REFERENCES run_blocks(run_id,block_id)
)
-- statement-breakpoint
INSERT INTO run_attention (
  rowid, id, run_id, block_id, execution_id, kind, source_key, native_request_id, occurrence_id,
  appeared_at, settled_at, settlement_reason, message, binding_id
)
SELECT
  saved_rowid, id, run_id, block_id, execution_id, kind, source_key, native_request_id,
  occurrence_id, appeared_at, settled_at, settlement_reason, message, binding_id
FROM run_attention_saved ORDER BY saved_rowid
-- statement-breakpoint
DROP TABLE run_attention_saved
-- statement-breakpoint
CREATE TRIGGER wake_run_on_new_attention AFTER INSERT ON run_attention
WHEN NEW.settled_at IS NULL
BEGIN
  UPDATE run_presentation SET snoozed=0,woke=1
  WHERE run_id=NEW.run_id AND snoozed=1
    AND NOT EXISTS(SELECT 1 FROM run_snooze_attention WHERE run_id=NEW.run_id AND attention_id=NEW.id);
END
-- statement-breakpoint
CREATE TEMP TABLE chat_report_matters_saved AS SELECT rowid AS saved_rowid, * FROM chat_report_matters
-- statement-breakpoint
DROP TABLE chat_report_matters
-- statement-breakpoint
CREATE TABLE chat_report_matters (
  matter_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES chat_run_origins(run_id),
  notice_id TEXT REFERENCES chat_report_notices(delivery_id),
  kind TEXT NOT NULL CHECK (kind IN ('human', 'native-request', 'conversation-waiting', 'missing-report', 'execution-failed', 'report-problem', 'settlement-unresolved')),
  -- NULL for a Run-level matter.
  block TEXT,
  appeared_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1))
)
-- statement-breakpoint
INSERT INTO chat_report_matters (rowid, matter_id, run_id, notice_id, kind, block, appeared_at, resolved)
SELECT saved_rowid, matter_id, run_id, notice_id, kind, block, appeared_at, resolved
FROM chat_report_matters_saved ORDER BY saved_rowid
-- statement-breakpoint
DROP TABLE chat_report_matters_saved
-- statement-breakpoint
CREATE INDEX chat_report_matters_run ON chat_report_matters(run_id)
-- statement-breakpoint
CREATE INDEX chat_report_matters_notice ON chat_report_matters(notice_id)
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
