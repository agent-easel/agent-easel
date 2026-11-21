-- Revisit context: every Agent block of every Flow revision, including those Runs captured,
-- gains a revisit_context setting ('keep' or 'fresh'), defaulting existing blocks to 'keep'.
-- Other block kinds have none. The block table is rebuilt under its immutability guard because
-- SQLite cannot add a column whose CHECK existing rows fail.
DROP TRIGGER immutable_flow_revision_block_update
-- statement-breakpoint
DROP TRIGGER immutable_flow_revision_block_delete
-- statement-breakpoint
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TABLE flow_revision_blocks_with_revisit_context (
  flow_revision_id TEXT NOT NULL REFERENCES flow_revisions(id),
  block_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('agent', 'human', 'continuation', 'wait', 'condition')),
  name TEXT NOT NULL,
  agent_id TEXT CHECK (kind = 'agent' OR agent_id IS NULL),
  prompt TEXT CHECK ((kind = 'continuation') = (prompt IS NOT NULL)),
  revisit_instruction TEXT CHECK ((kind = 'agent') = (revisit_instruction IS NOT NULL)),
  revisit_context TEXT CHECK ((kind = 'agent') = (revisit_context IS NOT NULL)) CHECK (revisit_context IS NULL OR revisit_context IN ('keep', 'fresh')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  wait_amount REAL,
  wait_unit TEXT CHECK (wait_unit IS NULL OR wait_unit IN ('minutes', 'hours', 'days')),
  CHECK ((wait_amount IS NULL) = (wait_unit IS NULL)),
  CHECK (kind = 'wait' OR wait_amount IS NULL),
  PRIMARY KEY (flow_revision_id, block_id),
  UNIQUE (flow_revision_id, ordinal)
)
-- statement-breakpoint
INSERT INTO flow_revision_blocks_with_revisit_context (flow_revision_id, block_id, ordinal, kind, name, agent_id, prompt, revisit_instruction, revisit_context, x, y, wait_amount, wait_unit)
SELECT flow_revision_id, block_id, ordinal, kind, name, agent_id, prompt, revisit_instruction,
  CASE WHEN kind = 'agent' THEN 'keep' END, x, y, wait_amount, wait_unit
FROM flow_revision_blocks ORDER BY rowid
-- statement-breakpoint
DROP TABLE flow_revision_blocks
-- statement-breakpoint
ALTER TABLE flow_revision_blocks_with_revisit_context RENAME TO flow_revision_blocks
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_block_update BEFORE UPDATE ON flow_revision_blocks BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_block_delete BEFORE DELETE ON flow_revision_blocks BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
