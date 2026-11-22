import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inventory } from "./check-comments.mjs";

await test("excludes executable hashbang lines while keeping real comments", () => {
  // Arrange
  const source = "#!/usr/bin/env node\nconst value = 1;\n// kept comment\n";

  // Act
  const found = inventory("scripts/example.mjs", source);

  // Assert
  assert.deepEqual(
    found.map(({ line, column, text }) => ({ line, column, text })),
    [{ line: 3, column: 1, text: "// kept comment" }],
  );
});

await test("returns an empty inventory for an executable script with only a hashbang", () => {
  // Arrange
  const source = "#!/usr/bin/env node\nexport const value = 1;\n";

  // Act
  const found = inventory("scripts/bin.mjs", source);

  // Assert
  assert.deepEqual(found, []);
});

await test("fails explicitly when a fatal syntax error prevents complete comment scanning", () => {
  // Arrange
  const source = ")\n// later comment\n";

  // Assert
  assert.throws(
    () => inventory("scripts/broken.ts", source),
    /scripts\/broken\.ts:1:1 \[parse-error\]/,
  );
});

await test("dispatches CLI commands when invoked through a symlinked entry point", (t) => {
  // Arrange
  const dir = mkdtempSync(join(tmpdir(), "check-comments-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const symlink = join(dir, "check-comments.mjs");
  symlinkSync(fileURLToPath(new URL("./check-comments.mjs", import.meta.url)), symlink);

  // Act
  const result = spawnSync(process.execPath, [symlink, "--unknown-flag"], { encoding: "utf8" });

  // Assert
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node scripts\/check-comments\.mjs/);
});
