-- An import receipt records the version of its fingerprint. Version 2 covers the document, the
-- reviewed selections and the import target; version 1 covers only the document and selections of
-- an import made before imports took a target, which was always global. Additive: every existing
-- receipt keeps version 1 and replays only as a global import.
ALTER TABLE definition_import_receipts ADD COLUMN fingerprint_version INTEGER NOT NULL DEFAULT 1 CHECK (fingerprint_version IN (1, 2))
