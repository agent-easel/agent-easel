-- A Run's T3 updates go to the one conversation whose own T3 activity recorded the Run's Start
-- call. `settled_cycle` is the last `run-settled` event accounted for; `final` marks an Archived
-- Run whose updates owe nothing more.
CREATE TABLE run_update_subscriptions (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  thread_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  environment_id TEXT NOT NULL,
  subscribed_at TEXT NOT NULL,
  settled_cycle INTEGER,
  final INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1))
)
-- statement-breakpoint
-- One queued update per row. `sending` is recorded before the T3 call; a send whose outcome is
-- not a definitive answer becomes `unknown` and is never sent again.
CREATE TABLE run_update_deliveries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run_update_subscriptions(run_id),
  event TEXT NOT NULL CHECK (event IN ('attention', 'settlement')),
  settlement TEXT CHECK (settlement IN ('automatic', 'manual', 'finish')),
  state TEXT NOT NULL CHECK (state IN ('owed', 'sending', 'delivered', 'refused', 'unknown', 'retired')),
  text TEXT,
  problem TEXT,
  created_at TEXT NOT NULL,
  attempted_at TEXT,
  CHECK ((event = 'settlement') = (settlement IS NOT NULL))
)
-- statement-breakpoint
CREATE INDEX run_update_deliveries_state ON run_update_deliveries(state)
-- statement-breakpoint
-- Every attention matter of a subscribed Run Factory has accounted for, so a matter is announced
-- at most once. A matter pending at subscription has no delivery: it was never announced.
CREATE TABLE run_update_matters (
  run_id TEXT NOT NULL REFERENCES run_update_subscriptions(run_id),
  matter_id TEXT NOT NULL,
  presentation TEXT NOT NULL CHECK (presentation IN ('needs-input', 'problem')),
  delivery_id TEXT REFERENCES run_update_deliveries(id),
  resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  PRIMARY KEY (run_id, matter_id)
)
