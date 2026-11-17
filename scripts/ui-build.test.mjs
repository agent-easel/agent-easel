import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { uiBuildSignature, uiBuildSignatureFile } from "./ui-build.ts";

function checkBuild(root) {
  const module = new URL("./ui-build.ts", import.meta.url).href;
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { requireCurrentUiBuild } from ${JSON.stringify(module)}; requireCurrentUiBuild(process.argv[1]);`,
      root,
    ],
    { encoding: "utf8" },
  );
}

function builtProject(context) {
  const root = mkdtempSync(join(tmpdir(), "factory-ui-build-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "apps/frontend/src/main.ts": "export const app = 'current';",
    "apps/frontend/public/icon.svg": "<svg/>",
    "apps/frontend/index.html": "<html/>",
    "apps/frontend/vite.config.ts": "export default {};",
    "apps/frontend/dist/index.html": "<html>built</html>",
    "packages/contracts/src/index.ts": "export const contract = 1;",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    utimesSync(join(root, path), 1, 1);
  }
  const stamp = join(root, "apps/frontend/dist", uiBuildSignatureFile);
  writeFileSync(stamp, uiBuildSignature(root));
  return { root, stamp, source: join(root, "apps/frontend/src/main.ts") };
}

await test("a cached UI build remains current when identical sources have newer timestamps", (context) => {
  // Arrange
  const project = builtProject(context);
  utimesSync(project.source, 2, 2);

  // Act
  const result = checkBuild(project.root);

  // Assert
  assert.equal(result.status, 0, result.stderr);
});

await test("changed source content is rejected even when its timestamp matches the cached build", (context) => {
  // Arrange
  const project = builtProject(context);
  writeFileSync(project.source, "export const app = 'changed';");
  utimesSync(project.source, 1, 1);

  // Act
  const result = checkBuild(project.root);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run `pnpm build`/);
});

await test("a build without its recorded input signature is rejected", (context) => {
  // Arrange
  const project = builtProject(context);
  rmSync(project.stamp);

  // Act
  const result = checkBuild(project.root);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run `pnpm build`/);
});

await test("a signature without built UI cannot start journeys", (context) => {
  // Arrange
  const project = builtProject(context);
  rmSync(join(project.root, "apps/frontend/dist/index.html"));

  // Act
  const result = checkBuild(project.root);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run `pnpm build`/);
});

await test("dependency changes invalidate the cached UI build", (context) => {
  // Arrange
  const project = builtProject(context);
  writeFileSync(join(project.root, "pnpm-lock.yaml"), "lockfileVersion: '9.1'");

  // Act
  const result = checkBuild(project.root);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run `pnpm build`/);
});

await test("removing a shared source invalidates the cached UI build", (context) => {
  // Arrange
  const project = builtProject(context);
  rmSync(join(project.root, "packages/contracts/src/index.ts"));

  // Act
  const result = checkBuild(project.root);

  // Assert
  assert.equal(result.status, 1);
  assert.match(result.stderr, /run `pnpm build`/);
});

await test("cached UI signatures remain valid in a different checkout with the same input contents", (context) => {
  // Arrange
  const original = builtProject(context);
  const restored = builtProject(context);
  copyFileSync(original.stamp, restored.stamp);
  writeFileSync(restored.source, readFileSync(original.source));

  // Act
  const result = checkBuild(restored.root);

  // Assert
  assert.equal(result.status, 0, result.stderr);
});
