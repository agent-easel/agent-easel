CREATE TABLE definition_import_receipt_flows (
  request_id TEXT NOT NULL REFERENCES definition_import_receipts(request_id),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  flow_key TEXT NOT NULL,
  flow_id TEXT NOT NULL UNIQUE REFERENCES flows(id),
  PRIMARY KEY (request_id, ordinal),
  UNIQUE (request_id, flow_key)
)
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_flow_update BEFORE UPDATE ON definition_import_receipt_flows BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_flow_delete BEFORE DELETE ON definition_import_receipt_flows BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
