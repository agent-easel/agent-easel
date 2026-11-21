-- The Finish block is optional: a revision has one only when its row exists. Migration 114 and
-- later saves gave every revision a Finish block; one without endings declared nothing, took no
-- wire and never ended a Run, so it is removed. A Finish block with endings is kept unchanged.
DROP TRIGGER immutable_flow_revision_finish_delete
-- statement-breakpoint
DELETE FROM flow_revision_finish
WHERE NOT EXISTS (
  SELECT 1 FROM flow_revision_endings e
  WHERE e.flow_revision_id = flow_revision_finish.flow_revision_id
)
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_finish_delete BEFORE DELETE ON flow_revision_finish BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
