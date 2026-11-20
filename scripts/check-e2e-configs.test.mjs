import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { findAdHocE2eConfigs } from "./check-e2e-configs.mjs";

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "e2e-configs-"));
  files.forEach((file) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  });
  return root;
}

await test("flags ad-hoc e2e configs, ignored output directories included", () => {
  // Arrange
  const root = tree([
    "e2e.config.ts",
    "e2e.explore.config.ts",
    "e2e.tmp.config.ts",
    ".e2e/run/e2e.evidence.config.ts",
    "node_modules/pkg/e2e.dep.config.ts",
  ]);

  // Act
  const found = findAdHocE2eConfigs(root);

  // Assert
  assert.deepEqual(found, [
    join(root, ".e2e/run/e2e.evidence.config.ts"),
    join(root, "e2e.tmp.config.ts"),
  ]);
});
