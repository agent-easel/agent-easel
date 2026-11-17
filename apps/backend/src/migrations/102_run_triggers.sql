-- Triggers: saved rules that start Runs from outside Factory. Named run_triggers so they are not
-- confused with SQL triggers. Removal deletes a Trigger and everything it keeps; Runs it started
-- keep their own records. Additive: no existing row changes.
CREATE TABLE run_triggers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('github_issues')),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  project_id TEXT NOT NULL REFERENCES projects(id),
  flow_id TEXT NOT NULL REFERENCES flows(id),
  schedule_enabled INTEGER NOT NULL CHECK (schedule_enabled IN (0, 1)),
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 1 AND 1440),
  max_active_runs INTEGER NOT NULL CHECK (max_active_runs BETWEEN 1 AND 10),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  next_check_at TEXT,
  latest_check_at TEXT,
  latest_check_started INTEGER CHECK (latest_check_started >= 0),
  latest_check_waiting INTEGER CHECK (latest_check_waiting >= 0),
  error_code TEXT,
  error_message TEXT,
  error_first_seen_at TEXT,
  error_last_seen_at TEXT,
  error_count INTEGER CHECK (error_count >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (latest_check_at IS NULL) = (latest_check_started IS NULL)
    AND (latest_check_at IS NULL) = (latest_check_waiting IS NULL)
  ),
  CHECK (
    (error_code IS NULL) = (error_message IS NULL)
    AND (error_code IS NULL) = (error_first_seen_at IS NULL)
    AND (error_code IS NULL) = (error_last_seen_at IS NULL)
    AND (error_code IS NULL) = (error_count IS NULL)
  )
)
-- statement-breakpoint
-- Names are unique among current Triggers only, so a removed Trigger's name can be reused.
CREATE UNIQUE INDEX run_triggers_name ON run_triggers (name COLLATE NOCASE)
-- statement-breakpoint
CREATE INDEX run_triggers_listing ON run_triggers (created_at DESC, id ASC)
-- statement-breakpoint
CREATE TRIGGER run_triggers_kind_fixed BEFORE UPDATE OF kind ON run_triggers
WHEN NEW.kind IS NOT OLD.kind
BEGIN SELECT RAISE(ABORT, 'A Trigger keeps the kind it was created with'); END
-- statement-breakpoint
-- The issues the latest check did not start, in the order the check met them.
CREATE TABLE run_trigger_check_misses (
  trigger_id TEXT NOT NULL REFERENCES run_triggers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  issue TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (trigger_id, position)
)
-- statement-breakpoint
-- GitHub Issues settings: the confirmed repository, the query as saved and its ready label.
CREATE TABLE run_trigger_github_issues (
  trigger_id TEXT PRIMARY KEY REFERENCES run_triggers(id) ON DELETE CASCADE,
  repository_host TEXT NOT NULL CHECK (length(repository_host) > 0),
  repository_name_with_owner TEXT NOT NULL CHECK (length(repository_name_with_owner) > 0),
  repository_node_id TEXT NOT NULL CHECK (length(repository_node_id) > 0),
  query TEXT NOT NULL CHECK (length(query) BETWEEN 1 AND 1000),
  ready_label TEXT NOT NULL CHECK (length(ready_label) > 0)
)
-- statement-breakpoint
CREATE INDEX run_trigger_github_issues_repository ON run_trigger_github_issues (repository_node_id)
