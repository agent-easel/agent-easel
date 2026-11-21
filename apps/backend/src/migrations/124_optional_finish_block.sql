-- Existing empty Finish blocks stop appearing in graphs. Their stored positions remain intact.
ALTER TABLE flow_revision_finish ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
-- statement-breakpoint
DROP TRIGGER immutable_flow_revision_finish_update
-- statement-breakpoint
UPDATE flow_revision_finish
SET active = 0
WHERE NOT EXISTS (
  SELECT 1 FROM flow_revision_endings e
  WHERE e.flow_revision_id = flow_revision_finish.flow_revision_id
)
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_finish_update BEFORE UPDATE ON flow_revision_finish BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
