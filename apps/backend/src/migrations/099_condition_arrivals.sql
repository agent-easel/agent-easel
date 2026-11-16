-- Condition arrivals: each distinct delivery accepted at a Run's Condition, keyed by the incoming
-- Handoff, is numbered from 1 per Run and Condition across every wire and worker. A selection keeps
-- only the matched captured rule (null for Otherwise), never a copy of the rules. Additive: no
-- existing row changes; Runs already capturing a Condition start its count at 0.
CREATE TABLE condition_counters (
  run_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  -- The last arrival number committed at this Condition; JSON and SQLite both hold it exactly.
  arrivals INTEGER NOT NULL DEFAULT 0 CHECK (typeof(arrivals) = 'integer' AND arrivals BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (run_id, block_id),
  FOREIGN KEY (run_id, block_id) REFERENCES run_blocks(run_id, block_id)
)
-- statement-breakpoint
CREATE TABLE condition_arrivals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  block_id TEXT NOT NULL,
  -- The logical delivery: a redelivery of the same Handoff finds its arrival and records nothing.
  incoming_intent_id TEXT NOT NULL UNIQUE REFERENCES operation_intents(id),
  -- `pending` waits in order for its number; `cancelled`: Archive or manual settlement ended it
  -- before it was numbered.
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'selected', 'cancelled')),
  arrival_number INTEGER CHECK (arrival_number IS NULL OR
    (typeof(arrival_number) = 'integer' AND arrival_number BETWEEN 1 AND 9007199254740991)),
  -- The Run's captured Flow revision, so a matched rule names one of its immutable rule rows.
  flow_revision_id TEXT NOT NULL REFERENCES flow_revisions(id),
  -- The matched rule, whose output was selected; null when Otherwise was.
  rule_id TEXT,
  -- The forwarded text, kept only while a recipient still reads it.
  message TEXT,
  binding_id TEXT REFERENCES run_thread_bindings(id),
  origin_activation_id TEXT REFERENCES run_activations(id),
  arrived_at TEXT NOT NULL,
  accepted_at TEXT,
  cancelled_at TEXT,
  CHECK ((state = 'selected') = (arrival_number IS NOT NULL)),
  CHECK ((state = 'selected') = (accepted_at IS NOT NULL)),
  CHECK ((state = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (state = 'selected' OR (rule_id IS NULL AND message IS NULL)),
  CHECK (origin_activation_id IS NULL OR binding_id IS NOT NULL),
  UNIQUE (run_id, block_id, arrival_number),
  FOREIGN KEY (run_id, block_id) REFERENCES run_blocks(run_id, block_id),
  FOREIGN KEY (flow_revision_id, block_id, rule_id) REFERENCES flow_revision_condition_rules(flow_revision_id, block_id, rule_id)
)
-- statement-breakpoint
CREATE INDEX condition_arrivals_pending ON condition_arrivals(run_id, block_id) WHERE state = 'pending'
-- statement-breakpoint
ALTER TABLE operation_intents ADD COLUMN condition_arrival_id TEXT REFERENCES condition_arrivals(id)
-- statement-breakpoint
INSERT INTO condition_counters (run_id, block_id)
SELECT r.id, b.block_id FROM runs r
JOIN flow_revision_blocks b ON b.flow_revision_id = r.flow_revision_id AND b.kind = 'condition'
JOIN run_blocks rb ON rb.run_id = r.id AND rb.block_id = b.block_id
