-- The Flow a committed import of a Flow file created, recorded beside the receipt's Agents so a
-- replay returns its id. An Agent file's receipt has no row here. Rows never change and outlive
-- the Flow they name. No existing data changes.
CREATE TABLE definition_import_receipt_flows (
  request_id TEXT PRIMARY KEY NOT NULL REFERENCES definition_import_receipts(request_id),
  flow_id TEXT NOT NULL UNIQUE REFERENCES flows(id)
)
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_flow_update BEFORE UPDATE ON definition_import_receipt_flows BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
-- statement-breakpoint
CREATE TRIGGER immutable_definition_import_receipt_flow_delete BEFORE DELETE ON definition_import_receipt_flows BEGIN SELECT RAISE(ABORT, 'Import receipts are immutable'); END
