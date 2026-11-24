---
globs: ['apps/backend/src/migrations/**', 'apps/backend/src/schema.sql', 'apps/backend/test/fixtures/**']
---

A schema change is a new `NNN_description.sql` migration; a released migration is never edited.

Each chunk holds one SQLite statement separated by the exact `-- statement-breakpoint` line, with no `BEGIN` or `COMMIT`. Regenerate `apps/backend/src/schema.sql` with `pnpm --filter @agent-easel/backend schema:update` after adding a migration rather than hand-editing it. A persisted JSON shape change needs a migration that rewrites stored data and a frozen-fixture upgrade test. See docs/foundation.md, "SQL migrations".
