---
globs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs', '**/*.mts', '**/*.cts']
---

Do not ask to add or restore JavaScript or TypeScript comments: the static gate rejects any new comment outside exact `// Arrange`, `// Act` and `// Assert` lines in tests.

Deleting stale or prose comments is intentional and lowers the ratchet allowance; only existing legal notices and runtime or tool directives must stay. Express intent through clear names and code, and record durable decisions in ADRs rather than inline comments. See docs/quality-gates.md, "Comment ratchet".
