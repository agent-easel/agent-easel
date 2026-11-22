-- Join: a Flow revision block may be a Join, which has no stored fields of its own beyond its name
-- and position; its sources come from the revision's connections. The block table of every Flow
-- revision, including those Runs captured, is rebuilt under its immutability guard to admit the
-- 'join' kind. Every stored block keeps its values and no Join is inferred.
DROP TRIGGER immutable_flow_revision_block_update
-- statement-breakpoint
DROP TRIGGER immutable_flow_revision_block_delete
-- statement-breakpoint
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TABLE flow_revision_blocks_with_join (
  flow_revision_id TEXT NOT NULL REFERENCES flow_revisions(id),
  block_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('agent', 'human', 'continuation', 'wait', 'condition', 'subflow', 'join')),
  name TEXT NOT NULL,
  -- Unresolved by design: drafts may name a missing Agent, and history outlives the Agent.
  agent_id TEXT CHECK (kind = 'agent' OR agent_id IS NULL),
  -- The Flow a Subflow places; unresolved by design like agent_id, null while the draft has none.
  flow_id TEXT CHECK (kind = 'subflow' OR flow_id IS NULL),
  -- The prompt a Continuation sends once per Run; empty only in a draft.
  prompt TEXT CHECK ((kind = 'continuation') = (prompt IS NOT NULL)),
  -- The instruction an Agent block's later visits receive, stored trimmed; empty when unset.
  revisit_instruction TEXT CHECK ((kind = 'agent') = (revisit_instruction IS NOT NULL)),
  -- Whether an Agent block's later visits keep or clear provider context ('keep' or 'fresh').
  revisit_context TEXT CHECK ((kind = 'agent') = (revisit_context IS NOT NULL)) CHECK (revisit_context IS NULL OR revisit_context IN ('keep', 'fresh')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  -- A Wait's duration; both are null while the draft has none. Any finite amount saves:
  -- readiness owns the range, judged on the normalized duration.
  wait_amount REAL,
  wait_unit TEXT CHECK (wait_unit IS NULL OR wait_unit IN ('minutes', 'hours', 'days')),
  CHECK ((wait_amount IS NULL) = (wait_unit IS NULL)),
  CHECK (kind = 'wait' OR wait_amount IS NULL),
  PRIMARY KEY (flow_revision_id, block_id),
  UNIQUE (flow_revision_id, ordinal)
)
-- statement-breakpoint
INSERT INTO flow_revision_blocks_with_join (flow_revision_id, block_id, ordinal, kind, name, agent_id, flow_id, prompt, revisit_instruction, revisit_context, x, y, wait_amount, wait_unit)
SELECT flow_revision_id, block_id, ordinal, kind, name, agent_id, flow_id, prompt, revisit_instruction,
  revisit_context, x, y, wait_amount, wait_unit
FROM flow_revision_blocks ORDER BY rowid
-- statement-breakpoint
DROP TABLE flow_revision_blocks
-- statement-breakpoint
ALTER TABLE flow_revision_blocks_with_join RENAME TO flow_revision_blocks
-- statement-breakpoint
CREATE INDEX flow_revision_blocks_by_flow ON flow_revision_blocks(flow_id) WHERE flow_id IS NOT NULL
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_block_update BEFORE UPDATE ON flow_revision_blocks BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_block_delete BEFORE DELETE ON flow_revision_blocks BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
