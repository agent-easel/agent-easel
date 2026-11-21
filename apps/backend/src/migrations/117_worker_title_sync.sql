-- A Run title revision and each physical worker binding's title sync. Existing bound
-- workers are baselined at the current revision with nothing queued, so an upgrade does
-- not rename historical threads. Unbound launch intents have no binding row to baseline.
ALTER TABLE runs ADD COLUMN title_revision INTEGER NOT NULL DEFAULT 0 CHECK (title_revision >= 0)
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_acknowledged TEXT
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_synced_revision INTEGER
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_target TEXT
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_target_revision INTEGER
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_request_id TEXT
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_inflight_revision INTEGER
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_inflight_request_id TEXT
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_sync_state TEXT CHECK (
  title_sync_state IS NULL OR title_sync_state IN ('pending', 'inflight', 'retired', 'paused')
)
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_disposition TEXT CHECK (
  title_disposition IS NULL OR title_disposition IN (
    'thread-not-found', 'capability-denied', 'superseded', 'unavailable', 'unclassified'
  )
)
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_blocked_context TEXT
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_attempt INTEGER NOT NULL DEFAULT 0
-- statement-breakpoint
ALTER TABLE run_thread_bindings ADD COLUMN title_not_before TEXT
-- statement-breakpoint
UPDATE run_thread_bindings
SET title_synced_revision = (
  SELECT runs.title_revision FROM runs WHERE runs.id = run_thread_bindings.run_id
)
WHERE role = 'worker'
