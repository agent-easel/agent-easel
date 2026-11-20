import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const allowed = new Set(["e2e.config.ts", "e2e.explore.config.ts"]);
const skipped = new Set(["node_modules", ".git"]);

// Walks the working tree rather than `git ls-files` so a config in an ignored directory such as
// `.e2e/` counts too; only dependency and Git internals are skipped.
export function findAdHocE2eConfigs(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) walk(path);
      } else if (/^e2e\..+\.config\.ts$/.test(entry.name) && !allowed.has(entry.name)) {
        found.push(path);
      }
    }
  };
  walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findAdHocE2eConfigs(process.cwd());
  if (found.length > 0) {
    console.error(
      `Ad-hoc e2e config files are not allowed:\n${found.map((file) => `  ${file}`).join("\n")}\n` +
        "Delete them. Capture evidence with `pnpm e2e:evidence` and run the affected journeys " +
        "with `pnpm test:e2e:affected`; see docs/quality-gates.md.",
    );
    process.exit(1);
  }
}
