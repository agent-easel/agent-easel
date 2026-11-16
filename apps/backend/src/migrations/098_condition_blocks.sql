-- Condition blocks: a Flow revision block may be a Condition, whose ordered rules are immutable
-- child rows of the revision Runs capture; its fixed Otherwise output is implicit for the kind.
-- Existing revisions keep every block unchanged; no Condition is inferred. The block table is
-- rebuilt under its immutability guard because SQLite cannot widen a CHECK in place.
DROP TRIGGER immutable_flow_revision_block_update
-- statement-breakpoint
DROP TRIGGER immutable_flow_revision_block_delete
-- statement-breakpoint
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TABLE flow_revision_blocks_with_conditions (
  flow_revision_id TEXT NOT NULL REFERENCES flow_revisions(id),
  block_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('agent', 'human', 'continuation', 'wait', 'condition')),
  name TEXT NOT NULL,
  -- Unresolved by design: drafts may name a missing Agent, and history outlives the Agent.
  agent_id TEXT CHECK (kind = 'agent' OR agent_id IS NULL),
  -- The prompt a Continuation sends once per Run; empty only in a draft.
  prompt TEXT CHECK ((kind = 'continuation') = (prompt IS NOT NULL)),
  -- The instruction an Agent block's later visits receive, stored trimmed; empty when unset.
  revisit_instruction TEXT CHECK ((kind = 'agent') = (revisit_instruction IS NOT NULL)),
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
INSERT INTO flow_revision_blocks_with_conditions (flow_revision_id, block_id, ordinal, kind, name, agent_id, prompt, revisit_instruction, x, y, wait_amount, wait_unit)
SELECT flow_revision_id, block_id, ordinal, kind, name, agent_id, prompt, revisit_instruction, x, y, wait_amount, wait_unit
FROM flow_revision_blocks ORDER BY rowid
-- statement-breakpoint
DROP TABLE flow_revision_blocks
-- statement-breakpoint
ALTER TABLE flow_revision_blocks_with_conditions RENAME TO flow_revision_blocks
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_block_update BEFORE UPDATE ON flow_revision_blocks BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_block_delete BEFORE DELETE ON flow_revision_blocks BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
-- statement-breakpoint
-- A Condition block's rules in order. Wires leave by `rule_id`, which never equals the implicit
-- Otherwise output's id. A threshold is null while the draft has none, else a whole arrival
-- number JSON and SQLite both hold exactly; readiness owns its order. Names are stored trimmed.
CREATE TABLE flow_revision_condition_rules (
  flow_revision_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  rule_id TEXT NOT NULL CHECK (rule_id <> 'otherwise'),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  name TEXT NOT NULL,
  from_arrival INTEGER CHECK (from_arrival IS NULL OR
    (typeof(from_arrival) = 'integer' AND from_arrival BETWEEN 1 AND 9007199254740991)),
  PRIMARY KEY (flow_revision_id, block_id, rule_id),
  UNIQUE (flow_revision_id, block_id, ordinal),
  FOREIGN KEY (flow_revision_id, block_id) REFERENCES flow_revision_blocks(flow_revision_id, block_id)
)
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_condition_rule_update BEFORE UPDATE ON flow_revision_condition_rules BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_flow_revision_condition_rule_delete BEFORE DELETE ON flow_revision_condition_rules BEGIN SELECT RAISE(ABORT, 'Flow revisions are immutable'); END
