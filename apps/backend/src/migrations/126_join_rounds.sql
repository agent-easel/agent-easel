CREATE TABLE join_rounds (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 9007199254740991),
  forwarded_at TEXT NOT NULL,
  message TEXT,
  UNIQUE(run_id,block_id,number),
  FOREIGN KEY(run_id,block_id) REFERENCES run_blocks(run_id,block_id)
)
-- statement-breakpoint
CREATE TABLE join_arrivals (
  ordinal INTEGER PRIMARY KEY,
  incoming_intent_id TEXT NOT NULL UNIQUE REFERENCES operation_intents(id),
  run_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  source_block_id TEXT NOT NULL,
  exit_id TEXT NOT NULL,
  arrived_at TEXT NOT NULL,
  round_id TEXT REFERENCES join_rounds(id),
  cancelled_at TEXT,
  CHECK (round_id IS NULL OR cancelled_at IS NULL),
  FOREIGN KEY(run_id,block_id) REFERENCES run_blocks(run_id,block_id),
  FOREIGN KEY(run_id,source_block_id) REFERENCES run_blocks(run_id,block_id)
)
-- statement-breakpoint
CREATE INDEX join_pending_slots ON join_arrivals(run_id,block_id,source_block_id)
WHERE round_id IS NULL AND cancelled_at IS NULL
-- statement-breakpoint
ALTER TABLE operation_intents ADD COLUMN join_round_id TEXT REFERENCES join_rounds(id)
-- statement-breakpoint
CREATE INDEX operation_intents_join_round ON operation_intents(join_round_id) WHERE join_round_id IS NOT NULL
