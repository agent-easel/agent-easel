CREATE TABLE run_subflow_revisions (
  run_id TEXT NOT NULL REFERENCES runs(id),
  flow_id TEXT NOT NULL REFERENCES flows(id),
  flow_revision_id TEXT NOT NULL REFERENCES flow_revisions(id),
  PRIMARY KEY (run_id, flow_id)
)
-- statement-breakpoint
CREATE TABLE subflow_invocations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  parent_id TEXT REFERENCES subflow_invocations(id),
  placement_block_id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number >= 1),
  incoming_intent_id TEXT UNIQUE REFERENCES operation_intents(id),
  input TEXT NOT NULL,
  entry_input INTEGER NOT NULL CHECK (entry_input IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('queued', 'active', 'stopping', 'returned', 'nothing-returned', 'cancelled')),
  arrived_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (run_id, placement_block_id) REFERENCES run_blocks(run_id, block_id),
  FOREIGN KEY (run_id, flow_id) REFERENCES run_subflow_revisions(run_id, flow_id),
  UNIQUE (run_id, placement_block_id, number)
)
-- statement-breakpoint
CREATE UNIQUE INDEX subflow_invocations_running ON subflow_invocations(run_id, placement_block_id)
WHERE state IN ('active', 'stopping')
-- statement-breakpoint
CREATE INDEX subflow_invocations_run_state ON subflow_invocations(run_id, state)
-- statement-breakpoint
ALTER TABLE run_blocks ADD COLUMN invocation_id TEXT REFERENCES subflow_invocations(id)
-- statement-breakpoint
ALTER TABLE run_blocks ADD COLUMN template_block_id TEXT
-- statement-breakpoint
UPDATE run_blocks SET template_block_id=block_id
-- statement-breakpoint
CREATE UNIQUE INDEX run_blocks_in_invocation ON run_blocks(invocation_id, template_block_id)
WHERE invocation_id IS NOT NULL
-- statement-breakpoint
ALTER TABLE run_workspaces ADD COLUMN creator_placement_path TEXT
-- statement-breakpoint
ALTER TABLE subflow_invocations ADD COLUMN stop_attempt INTEGER NOT NULL DEFAULT 1
-- statement-breakpoint
CREATE TABLE subflow_results (
  invocation_id TEXT PRIMARY KEY REFERENCES subflow_invocations(id),
  ending_id TEXT NOT NULL,
  ending_name TEXT NOT NULL,
  output TEXT,
  output_missing INTEGER NOT NULL CHECK (output_missing IN (0,1)),
  source_block_id TEXT NOT NULL,
  exit_id TEXT NOT NULL,
  author_block_id TEXT NOT NULL,
  binding_id TEXT REFERENCES run_thread_bindings(id),
  origin_activation_id TEXT REFERENCES run_activations(id),
  intent_id TEXT NOT NULL UNIQUE REFERENCES operation_intents(id),
  accepted_at TEXT NOT NULL,
  released_at TEXT,
  cancelled_at TEXT
)
-- statement-breakpoint
CREATE TABLE subflow_worker_stops (
  invocation_id TEXT NOT NULL REFERENCES subflow_invocations(id),
  attempt INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  execution_id TEXT,
  request_key TEXT NOT NULL UNIQUE,
  requested_at TEXT NOT NULL,
  outcome TEXT CHECK (outcome IN ('acknowledged','failed')),
  PRIMARY KEY(invocation_id,attempt,thread_id)
)
-- statement-breakpoint
CREATE INDEX subflow_worker_stops_by_thread ON subflow_worker_stops(thread_id,execution_id)
-- statement-breakpoint
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TABLE condition_arrivals_scoped (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  block_id TEXT NOT NULL,
  template_block_id TEXT NOT NULL,
  incoming_intent_id TEXT NOT NULL UNIQUE REFERENCES operation_intents(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'selected', 'cancelled')),
  arrival_number INTEGER CHECK (arrival_number IS NULL OR
    (typeof(arrival_number) = 'integer' AND arrival_number BETWEEN 1 AND 9007199254740991)),
  flow_revision_id TEXT NOT NULL REFERENCES flow_revisions(id),
  rule_id TEXT,
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
  FOREIGN KEY (flow_revision_id, template_block_id, rule_id) REFERENCES flow_revision_condition_rules(flow_revision_id, block_id, rule_id)
)
-- statement-breakpoint
INSERT INTO condition_arrivals_scoped (id,run_id,block_id,incoming_intent_id,state,arrival_number,flow_revision_id,rule_id,message,binding_id,origin_activation_id,arrived_at,accepted_at,cancelled_at,template_block_id)
SELECT id,run_id,block_id,incoming_intent_id,state,arrival_number,flow_revision_id,rule_id,message,binding_id,origin_activation_id,arrived_at,accepted_at,cancelled_at,block_id FROM condition_arrivals ORDER BY rowid
-- statement-breakpoint
DROP TABLE condition_arrivals
-- statement-breakpoint
ALTER TABLE condition_arrivals_scoped RENAME TO condition_arrivals
-- statement-breakpoint
CREATE INDEX condition_arrivals_pending ON condition_arrivals(run_id, block_id) WHERE state = 'pending'
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
-- statement-breakpoint
ALTER TABLE operation_intents ADD COLUMN subflow_invocation_id TEXT REFERENCES subflow_invocations(id)
-- statement-breakpoint
CREATE INDEX operation_intents_subflow_return ON operation_intents(subflow_invocation_id)
WHERE subflow_invocation_id IS NOT NULL
