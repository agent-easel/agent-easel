-- Import receipts: one per committed import of a portable document, keyed by the client's request
-- id and written in the transaction that creates the definitions. The fingerprint covers the
-- canonical document and the reviewed selections, so a retry with the same content replays the
-- original result and other content under the same id conflicts. A Flow file's receipt also names
-- the Flow it created; an Agent file's has no Flow. Receipts never change and outlive the definitions
-- they name: a replay returns a removed definition's id instead of creating another.
-- No existing data changes.
CREATE TABLE definition_import_receipts (
  request_id TEXT PRIMARY KEY NOT NULL CHECK (length(request_id) BETWEEN 1 AND 256),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  flow_id TEXT UNIQUE REFERENCES flows(id),
  created_at TEXT NOT NULL
)
-- statement-breakpoint
CREATE TABLE definition_import_receipt_agents (
  request_id TEXT NOT NULL REFERENCES definition_import_receipts(request_id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  agent_key TEXT NOT NULL,
  agent_id TEXT NOT NULL UNIQUE REFERENCES agents(id),
  PRIMARY KEY (request_id, ordinal),
  UNIQUE (request_id, agent_key)
)
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_update BEFORE UPDATE ON definition_import_receipts BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_delete BEFORE DELETE ON definition_import_receipts BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_agent_update BEFORE UPDATE ON definition_import_receipt_agents BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_agent_delete BEFORE DELETE ON definition_import_receipt_agents BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
