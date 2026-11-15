-- An Agent may be saved without a model: a revision's execution columns are now all present or
-- all null. Present values keep their non-empty and JSON checks. The revision table is rebuilt
-- under its immutability guards because SQLite cannot relax NOT NULL in place; every revision
-- keeps its id, Agent, number, content and save time, so exits, Runs and activations that
-- reference it are unchanged.
DROP TRIGGER immutable_agent_revision_update
-- statement-breakpoint
DROP TRIGGER immutable_agent_revision_delete
-- statement-breakpoint
PRAGMA defer_foreign_keys=ON
-- statement-breakpoint
CREATE TABLE agent_revisions_with_optional_execution (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  prompt TEXT NOT NULL CHECK (length(prompt) <= 120000),
  environment_id TEXT CHECK (length(trim(environment_id)) > 0),
  provider_instance_id TEXT CHECK (length(trim(provider_instance_id)) > 0),
  model_id TEXT CHECK (length(trim(model_id)) > 0),
  model_options_json TEXT CHECK (json_valid(model_options_json)),
  saved_at TEXT NOT NULL,
  -- Execution settings are complete or absent (the Agent Needs a model), never partial.
  CHECK (
    (environment_id IS NULL) = (provider_instance_id IS NULL)
    AND (environment_id IS NULL) = (model_id IS NULL)
    AND (environment_id IS NULL) = (model_options_json IS NULL)
  ),
  UNIQUE (agent_id, revision)
)
-- statement-breakpoint
INSERT INTO agent_revisions_with_optional_execution (
  id, agent_id, revision, name, prompt, environment_id, provider_instance_id, model_id,
  model_options_json, saved_at
)
SELECT id, agent_id, revision, name, prompt, environment_id, provider_instance_id, model_id,
  model_options_json, saved_at
FROM agent_revisions ORDER BY rowid
-- statement-breakpoint
DROP TABLE agent_revisions
-- statement-breakpoint
ALTER TABLE agent_revisions_with_optional_execution RENAME TO agent_revisions
-- statement-breakpoint
-- Run definition revisions reference a revision by Agent and id.
CREATE UNIQUE INDEX agent_revisions_identity ON agent_revisions(agent_id, id)
-- statement-breakpoint
CREATE TRIGGER immutable_agent_revision_update BEFORE UPDATE ON agent_revisions BEGIN SELECT RAISE(ABORT, 'Agent revisions are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_agent_revision_delete BEFORE DELETE ON agent_revisions BEGIN SELECT RAISE(ABORT, 'Agent revisions are immutable'); END
-- statement-breakpoint
PRAGMA defer_foreign_keys=OFF
