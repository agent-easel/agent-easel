import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const uiBuildSignatureFile = "build-inputs.sha256";

function inputFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Shared by the build and fixture, so cached output is checked against the same inputs. */
export function uiBuildSignature(root: string): string {
  const paths = [
    "apps/frontend/src",
    "apps/frontend/public",
    "apps/frontend/index.html",
    "apps/frontend/vite.config.ts",
    "apps/frontend/package.json",
    "apps/frontend/tsconfig.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "scripts/ui-build.ts",
    ...readdirSync(join(root, "packages")).flatMap((name) => [
      `packages/${name}/src`,
      `packages/${name}/package.json`,
      `packages/${name}/tsconfig.json`,
      `packages/${name}/tsconfig.build.json`,
    ]),
  ];
  const files = paths
    .map((path) => join(root, path))
    .filter(existsSync)
    .flatMap(inputFiles)
    .sort();
  const hash = createHash("sha256");
  for (const path of files) {
    const name = relative(root, path).split(sep).join("/");
    const content = createHash("sha256").update(readFileSync(path)).digest("hex");
    hash.update(JSON.stringify([name, content]));
  }
  return hash.digest("hex");
}

function currentUiBuild(root: string): boolean {
  const builtUi = join(root, "apps/frontend/dist/index.html");
  const stamp = join(root, "apps/frontend/dist", uiBuildSignatureFile);
  return (
    existsSync(builtUi) &&
    existsSync(stamp) &&
    readFileSync(stamp, "utf8") === uiBuildSignature(root)
  );
}

export function requireCurrentUiBuild(root: string): void {
  if (!currentUiBuild(root)) {
    throw new Error(
      "apps/frontend/dist is missing or does not match the UI build inputs; run `pnpm e2e:prepare` before e2e.",
    );
  }
}

if (import.meta.main) process.exitCode = currentUiBuild(process.cwd()) ? 0 : 1;
