-- A global Agent's execution settings for Runs in one Project. Overrides belong to the Agent
-- revision, so a Run's captured revision and its Project still decide its settings alone.
-- Additive: no existing Agent has an override.
CREATE TABLE agent_revision_project_overrides (
  agent_revision_id TEXT NOT NULL REFERENCES agent_revisions(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  environment_id TEXT NOT NULL CHECK (length(trim(environment_id)) > 0),
  provider_instance_id TEXT NOT NULL CHECK (length(trim(provider_instance_id)) > 0),
  model_id TEXT NOT NULL CHECK (length(trim(model_id)) > 0),
  model_options_json TEXT NOT NULL CHECK (json_valid(model_options_json)),
  PRIMARY KEY (agent_revision_id, project_id),
  UNIQUE (agent_revision_id, ordinal)
)
-- statement-breakpoint
CREATE TRIGGER immutable_agent_revision_override_delete BEFORE DELETE ON agent_revision_project_overrides BEGIN SELECT RAISE(ABORT, 'Agent revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_agent_revision_override_update BEFORE UPDATE ON agent_revision_project_overrides BEGIN SELECT RAISE(ABORT, 'Agent revisions are immutable'); END
