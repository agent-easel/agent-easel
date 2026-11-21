-- The Run result: the one accepted delivery into an ending of the Run's captured Finish block. A
-- Run has at most one, recorded with the ending's name as captured, and it never changes. Archive
-- keeps it. `output` is the delivered text exactly, NULL when the ending's output is `none`;
-- `output_missing` marks a blank arrival at a Required ending, which still keeps that text.
-- `author_block_id` names the block that wrote the text, through Wait, Condition and pass-through
-- forwarding. Historical Runs have no result.
CREATE TABLE run_results (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs(id),
  ending_id TEXT NOT NULL,
  ending_name TEXT NOT NULL,
  output TEXT,
  output_missing INTEGER NOT NULL CHECK (output_missing IN (0, 1)),
  source_block_id TEXT NOT NULL,
  exit_id TEXT NOT NULL,
  author_block_id TEXT NOT NULL,
  binding_id TEXT REFERENCES run_thread_bindings(id),
  origin_activation_id TEXT REFERENCES run_activations(id),
  intent_id TEXT NOT NULL UNIQUE REFERENCES operation_intents(id),
  accepted_at TEXT NOT NULL,
  CHECK (output IS NOT NULL OR output_missing = 0)
)
-- statement-breakpoint
CREATE TRIGGER immutable_run_result_update BEFORE UPDATE ON run_results BEGIN SELECT RAISE(ABORT, 'Run results are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_run_result_delete BEFORE DELETE ON run_results BEGIN SELECT RAISE(ABORT, 'Run results are immutable'); END
