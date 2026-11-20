---
name: delete-comment
description: Audit JavaScript and TypeScript comments, remove prose safely, publish implementation debt, and preserve durable decisions in ADRs. Use for /delete-comment, a scoped comment cleanup, or a comment line estimate.
---

# Delete comments

1. Inventory the requested paths with `node scripts/check-comments.mjs --inventory [repo-relative paths...]`. With no paths it inventories the repository's JavaScript and TypeScript. Read each comment beside the code and check the relevant documentation or history before treating a claim as stale.
2. Keep tool directives, required test labels, and legal notices when removing them would change tooling, violate policy, or lose required attribution. For each prose comment in the batch, record its path, line, category, and action in an ignored `.e2e/` ledger.
   - **Tautology** repeats the code or a documented contract without adding rationale. Delete it.
   - **Stale** describes a retired or superseded implementation. Verify the current behavior, then delete it.
   - **Excuse** explains a concrete implementation shortcut with a useful follow-up. Confirm the debt, search for an existing issue, then file or reuse one before deleting the comment. Use the [issue tracker conventions](../../../docs/agents/issue-tracker.md) when publishing.
   - **Decision Record** explains a current trade-off or non-obvious invariant. Preserve the rationale in its existing ADR or a new short ADR linked from the [documentation index](../../../docs/README.md), then delete the comment.
3. Preserve code tokens and line breaks that affect syntax. Run `pnpm check:static` and the affected suites. The [comment ratchet](../../../docs/quality-gates.md#comment-ratchet) compares each file with its base and needs no generated allowlist.
4. Report the categories and destinations, what remains deferred, and the line estimate. Count each wholly comment-only physical line once. Count inline comments separately since their removal typically leaves the code line.
