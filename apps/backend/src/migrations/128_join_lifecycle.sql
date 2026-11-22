-- Join lifecycle: a cutoff records the partial round it cancelled so the Run keeps its history, and
-- Join integrity Problems reach Chat control like every other attention matter of a chat-started
-- Run. SQLite cannot widen a CHECK in place, so the matter table is rebuilt with every row,
-- including its rowid, kept unchanged.
CREATE TABLE join_cancellations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 9007199254740991),
  cancelled_at TEXT NOT NULL,
  UNIQUE(run_id,block_id,round_number),
  FOREIGN KEY(run_id,block_id) REFERENCES run_blocks(run_id,block_id)
)
-- statement-breakpoint
CREATE INDEX run_join_events ON run_events(run_id,block_id,sequence)
WHERE kind IN ('join-round-forwarded','join-round-cancelled')
-- statement-breakpoint
CREATE TABLE chat_report_matters_with_joins (
  matter_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES chat_run_origins(run_id),
  notice_id TEXT REFERENCES chat_report_notices(delivery_id),
  kind TEXT NOT NULL CHECK (kind IN ('human', 'native-request', 'conversation-waiting', 'missing-report', 'execution-failed', 'report-problem', 'settlement-unresolved', 'condition-integrity', 'join-integrity')),
  -- NULL for a Run-level matter.
  block TEXT,
  appeared_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1))
)
-- statement-breakpoint
INSERT INTO chat_report_matters_with_joins (rowid, matter_id, run_id, notice_id, kind, block, appeared_at, resolved)
SELECT rowid, matter_id, run_id, notice_id, kind, block, appeared_at, resolved FROM chat_report_matters ORDER BY rowid
-- statement-breakpoint
DROP TABLE chat_report_matters
-- statement-breakpoint
ALTER TABLE chat_report_matters_with_joins RENAME TO chat_report_matters
-- statement-breakpoint
CREATE INDEX chat_report_matters_run ON chat_report_matters(run_id)
-- statement-breakpoint
CREATE INDEX chat_report_matters_notice ON chat_report_matters(notice_id)
