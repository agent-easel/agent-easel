import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, globSync } from "node:fs";
import { pathToFileURL } from "node:url";

const reviewAndRootProse = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "GLOSSARY.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "SUPPORT.md",
  "LICENSE",
  ".github/pull_request_template.md",
  "sentinel.config.yaml",
]);

function isProse(path) {
  return (
    reviewAndRootProse.has(path) ||
    /^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(path) ||
    /^\.agents\/rules\/[^/]+\.md$/.test(path)
  );
}

export function shouldRunUiJourneys(paths) {
  return paths.length === 0 || !paths.every(isProse);
}

// Map feature-owned code only. Shared components, infrastructure and unknown paths
// fall back to the full suite rather than guessing which journeys use them.
const journeyAreas = [
  [
    /^apps\/frontend\/src\/(?:routes\/run-composer\.tsx$|components\/(?:launch-picker-options|prompt-editor|prompt-images)\.)/,
    [
      "composer-launch-states",
      "composer-live",
      "composer-menus",
      "composer-menus-destructive",
      "run-images",
    ],
  ],
  [
    /^apps\/frontend\/src\/(?:routes\/flow-editor\.tsx$|components\/(?:flow-canvas|flow-block|flow-wires|block-inspector)\.)/,
    [
      "flow-authoring",
      "flow-readiness",
      "condition-block",
      "wait-block",
      "continuation",
      "canvas-viewport",
      "studio-live",
    ],
  ],
  [
    /^apps\/(?:frontend\/src\/components\/studio-triggers\/|frontend\/src\/routes\/triggers\.tsx$|backend\/src\/triggers\/)/,
    ["studio-triggers", "run-evidence"],
  ],
  [
    /^apps\/(?:frontend\/src\/components\/chat-[^/]+\.|backend\/src\/chat-control\/)/,
    ["chat-control"],
  ],
  [
    /^apps\/frontend\/src\/components\/(?:appearance-settings|theme-color-settings|inherited-colors)\./,
    ["appearance", "theme-colors", "settings-navigation"],
  ],
  [
    /^apps\/frontend\/src\/components\/(?:keyboard-settings|canvas-shortcuts)\./,
    ["keyboard-shortcuts", "canvas-viewport"],
  ],
];

const journeyFile = /^tests\/[\w-]+\.e2e\.ts$/;
const unitTestFile =
  /^(?:apps\/[^/]+\/test\/[^/]+\.test\.ts|scripts\/(?:[^/]+\/)*[^/]+\.test\.[cm]?[jt]s)$/;

// null means the full suite; [] means no journeys are needed.
export function selectAffectedJourneys(paths, availableSpecs) {
  const selected = new Set();
  for (const path of paths) {
    if (isProse(path) || unitTestFile.test(path)) continue;
    if (journeyFile.test(path)) {
      if (availableSpecs.has(path)) selected.add(path);
      continue;
    }

    const area = journeyAreas.find(([pattern]) => pattern.test(path));
    if (!area) return null;

    const specs = area[1].map((name) => `tests/${name}.e2e.ts`);
    if (!specs.every((spec) => availableSpecs.has(spec))) return null;
    for (const spec of specs) selected.add(spec);
  }
  return [...selected].sort((left, right) => left.localeCompare(right, "en"));
}

function gitPaths(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean);
}

function affectedPaths(base) {
  const commit = execFileSync(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`],
    {
      encoding: "utf8",
    },
  ).trim();
  const fork = execFileSync("git", ["merge-base", commit, "HEAD"], { encoding: "utf8" }).trim();
  return [
    ...gitPaths("diff", "--no-renames", "--name-only", "-z", fork, "--"),
    ...gitPaths("ls-files", "--others", "--exclude-standard", "-z"),
  ];
}

function affected(args) {
  const run = args[0] === "--run";
  const [base = "origin/main", ...extra] = run ? args.slice(1) : args;
  if (extra.length || base.startsWith("-")) {
    throw new Error("Usage: node scripts/select-ui-journeys.mjs --affected [--run] [base-ref]");
  }
  const specs = selectAffectedJourneys(affectedPaths(base), new Set(globSync("tests/*.e2e.ts")));
  if (!run) {
    process.stdout.write(`${JSON.stringify(specs)}\n`);
    return;
  }
  if (specs?.length === 0) {
    process.stdout.write("No affected UI journeys.\n");
    return;
  }
  process.stdout.write(
    specs === null ? "Running all UI journeys.\n" : `Running UI journeys:\n${specs.join("\n")}\n`,
  );
  const result = spawnSync("pnpm", ["test:e2e", ...(specs ?? [])], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function selectForCi([base, head, ...extra]) {
  if (extra.length || !/^[a-f0-9]{40}$/.test(base ?? "") || !/^[a-f0-9]{40}$/.test(head ?? "")) {
    throw new Error("Usage: node scripts/select-ui-journeys.mjs <base-sha> <head-sha>");
  }
  // base...head diffs from the merge base. Disabling renames includes both sides.
  const paths = gitPaths("diff", "--no-renames", "--name-only", "-z", `${base}...${head}`);
  const output = `run=${shouldRunUiJourneys(paths)}\n`;
  process.stdout.write(output);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === "--affected") affected(args.slice(1));
  else selectForCi(args);
}
