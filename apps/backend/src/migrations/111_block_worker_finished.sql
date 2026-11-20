ALTER TABLE run_blocks ADD COLUMN worker_finished INTEGER NOT NULL DEFAULT 0 CHECK (worker_finished IN (0,1));
