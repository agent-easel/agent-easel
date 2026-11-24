import assert from "node:assert/strict";
import test from "node:test";
import { findOldProductName } from "./check-product-name.mjs";

const files = {
  "docs/a.md": "Use T3 Factory today.\nAgentEasel only.",
  "docs/b.md": "See https://github.com/alimek/t3-factory/issues/1 and agenteasel.",
  "CHANGELOG.md": "t3factory.app was the old domain",
  "apps/desktop/src/updates.ts": "T3 Factory receives no more updates.",
  "docs/c.md": "Download from t3factory.app or T3.Factory-1.dmg.",
};

await test("flags the old product name outside the allowlist and repository URLs", () => {
  const found = findOldProductName(Object.keys(files), (file) => files[file]);

  assert.deepEqual(
    found.map((line) => line.split(": ")[0]),
    ["docs/a.md:1", "docs/c.md:1"],
  );
});
