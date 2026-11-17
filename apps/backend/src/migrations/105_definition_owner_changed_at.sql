-- Every Flow and Agent identity records when its owning Project last changed. Change owner appends
-- no revision, so this time is what makes an owner moved away and back differ from the definition
-- a live reader last received. Additive: existing rows keep NULL, and their last save stays their
-- update time.
ALTER TABLE flows ADD COLUMN owner_changed_at TEXT
-- statement-breakpoint
ALTER TABLE agents ADD COLUMN owner_changed_at TEXT
