-- Chat control no longer posts lifecycle notices: a Run's lifecycle shows only on its status card.
-- Lifecycle notices not delivered stop being owed or retried, and so does a catch-up never created
-- that has no pending matter left to report. Delivered messages and their recorded text stay.
UPDATE chat_deliveries SET state='retired',next_attempt_at=NULL,problem=NULL,problem_at=NULL
WHERE purpose='lifecycle' AND state NOT IN ('delivered','retired')
-- statement-breakpoint
UPDATE chat_deliveries SET state='retired',next_attempt_at=NULL,problem=NULL,problem_at=NULL
WHERE purpose='catch-up' AND message_id IS NULL AND state IN ('owed','failed','unknown')
  AND NOT EXISTS (SELECT 1 FROM chat_report_matters m WHERE m.notice_id=chat_deliveries.id AND m.resolved=0)
-- statement-breakpoint
-- The notice table drops its lifecycle columns, and its application notice: a catch-up always
-- reports a pending matter, so its Run is never quiet and always gets a new card that says so.
-- Its table CHECK names the lifecycle columns, so it is rebuilt with every row and rowid kept;
-- matters reference it, so their foreign keys are checked at commit.
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TABLE chat_report_notices_current (
  delivery_id TEXT PRIMARY KEY REFERENCES chat_deliveries(id),
  run_id TEXT NOT NULL REFERENCES chat_run_origins(run_id)
)
-- statement-breakpoint
INSERT INTO chat_report_notices_current (rowid, delivery_id, run_id)
SELECT rowid, delivery_id, run_id FROM chat_report_notices ORDER BY rowid
-- statement-breakpoint
DROP TABLE chat_report_notices
-- statement-breakpoint
ALTER TABLE chat_report_notices_current RENAME TO chat_report_notices
-- statement-breakpoint
CREATE INDEX chat_report_notices_run ON chat_report_notices(run_id)
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
-- statement-breakpoint
-- The reporting row's accounted lifecycle was NULL only to ask for a baseline after a regrant; that
-- request is now its own flag.
ALTER TABLE chat_run_reporting ADD COLUMN baseline INTEGER NOT NULL DEFAULT 0 CHECK (baseline IN (0, 1))
-- statement-breakpoint
UPDATE chat_run_reporting SET baseline=1 WHERE lifecycle IS NULL
-- statement-breakpoint
ALTER TABLE chat_run_reporting DROP COLUMN lifecycle
