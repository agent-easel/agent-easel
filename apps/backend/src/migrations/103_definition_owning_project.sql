-- Every Flow and Agent identity records its owning Project: the Factory Project it belongs to, or
-- NULL for a global definition. Ownership is not part of a revision, so revisions and the Runs that
-- captured them stay unchanged. Additive: every existing Flow and Agent becomes global.
ALTER TABLE flows ADD COLUMN project_id TEXT REFERENCES projects(id)
-- statement-breakpoint
ALTER TABLE agents ADD COLUMN project_id TEXT REFERENCES projects(id)
