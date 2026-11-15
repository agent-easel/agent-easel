-- Condition integrity Problems: Chat control records them like every other attention matter of a
-- chat-started Run. SQLite cannot widen a CHECK in place, so the matter table is rebuilt with every
-- row kept unchanged.
CREATE TABLE chat_report_matters_with_conditions (
  matter_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES chat_run_origins(run_id),
  notice_id TEXT REFERENCES chat_report_notices(delivery_id),
  kind TEXT NOT NULL CHECK (kind IN ('human', 'native-request', 'conversation-waiting', 'missing-report', 'execution-failed', 'report-problem', 'condition-integrity')),
  block TEXT NOT NULL,
  appeared_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1))
)
-- statement-breakpoint
INSERT INTO chat_report_matters_with_conditions (matter_id, run_id, notice_id, kind, block, appeared_at, resolved)
SELECT matter_id, run_id, notice_id, kind, block, appeared_at, resolved FROM chat_report_matters ORDER BY rowid
-- statement-breakpoint
DROP TABLE chat_report_matters
-- statement-breakpoint
ALTER TABLE chat_report_matters_with_conditions RENAME TO chat_report_matters
-- statement-breakpoint
CREATE INDEX chat_report_matters_run ON chat_report_matters(run_id)
-- statement-breakpoint
CREATE INDEX chat_report_matters_notice ON chat_report_matters(notice_id)
