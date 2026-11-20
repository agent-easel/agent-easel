import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { buildEvidenceDiff } from "./ui-evidence-diff.mjs";

const USAGE = "Usage: pnpm e2e:evidence --base <ref> <spec> --output <dir>";
const CONFIG_NAME = "e2e.evidence.config.ts";

function parseArgs(argv) {
  const args = { base: undefined, output: undefined, spec: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--output") args.output = argv[++i];
    else if (args.spec === undefined) args.spec = argv[i];
    else fail(`Unexpected argument: ${argv[i]}\n${USAGE}`);
  }
  if (!args.base || !args.spec || !args.output) fail(USAGE);
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`Failed (${result.status}): ${command} ${args.join(" ")} in ${cwd}`);
    process.exit(result.status ?? 1);
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) fail(`git ${args.join(" ")}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/** The base commit's checkout, installed and built once per SHA and reused until the base moves. */
function baseWorktree(repo, ref) {
  const sha = git(["rev-parse", "--verify", `${ref}^{commit}`], repo);
  const cacheRoot = join(repo, ".e2e", "evidence-base");
  const dir = join(cacheRoot, sha.slice(0, 12));
  if (existsSync(join(dir, ".evidence-built"))) {
    console.log(`Reusing built base ${sha.slice(0, 12)} at ${dir}`);
    return dir;
  }
  for (const stale of existsSync(cacheRoot) ? readdirSync(cacheRoot) : []) {
    const path = join(cacheRoot, stale);
    spawnSync("git", ["worktree", "remove", "--force", path], { cwd: repo });
    rmSync(path, { recursive: true, force: true });
  }
  spawnSync("git", ["worktree", "prune"], { cwd: repo });
  console.log(`Building base ${sha.slice(0, 12)} (${ref}) at ${dir}`);
  mkdirSync(cacheRoot, { recursive: true });
  git(["worktree", "add", "--detach", dir, sha], repo);
  run("pnpm", ["install", "--frozen-lockfile"], dir);
  run("pnpm", ["build"], dir);
  writeFileSync(join(dir, ".evidence-built"), `${sha}\n`);
  return dir;
}

// A screenshot taken while a CSS transition or fade runs captures a colour that depends on timing,
// so identical builds differ. Playwright's own animations option does not cover these. Finishing
// every running finite animation each frame captures the end state without touching DOM or CSS.
const SETTLE_ANIMATIONS = `(() => {
  const finish = () => {
    for (const animation of document.getAnimations()) {
      try { animation.finish(); } catch {}
    }
    requestAnimationFrame(finish);
  };
  requestAnimationFrame(finish);
})();`;

/** Runs the spec in one checkout with the project's own config, narrowed to that one file. */
function runSpec(root, specPath, resultsDir) {
  // The generated config is the one thing both builds share, so the settling applies to a base
  // that predates it. It replaces each target's engine, which assumes the project's web engine
  // takes no other options.
  // run() exits the process on a failed spec and SIGINT skips finally, so remove it on exit.
  const configPath = join(root, CONFIG_NAME);
  process.once("exit", () => rmSync(configPath, { force: true }));
  process.once("SIGINT", () => process.exit(130));
  writeFileSync(
    configPath,
    `import base from "./e2e.config.ts";
import { web } from "@e2e-dev/web";
const engine = web({ initScripts: [${JSON.stringify(SETTLE_ANIMATIONS)}] });
export default {
  ...base,
  tests: ${JSON.stringify(specPath)},
  targets: base.targets.map((target) => ({ ...target, engine })),
};
`,
  );
  rmSync(resultsDir, { recursive: true, force: true });
  run(
    "pnpm",
    [
      "exec",
      "e2e",
      "run",
      "--config",
      CONFIG_NAME,
      specPath,
      "--output",
      relative(root, resultsDir),
    ],
    root,
  );
  rmSync(configPath, { force: true });
}

const { base, output, spec } = parseArgs(process.argv.slice(2));
const repo = git(["rev-parse", "--show-toplevel"], process.cwd());
const specFile = resolve(repo, spec);
if (!existsSync(specFile)) fail(`Spec not found: ${spec}`);
// Repo-relative, so an absolute spec argument still resolves inside each checkout.
const specPath = relative(repo, specFile);
const outDir = resolve(repo, output);
if (relative(repo, outDir).startsWith("..") || isAbsolute(relative(repo, outDir))) {
  fail("--output must be inside the repository (use .e2e/proof/<change>)");
}

const baseDir = baseWorktree(repo, base);
// An untracked or ignored spec (for example under .e2e/) is not in the base checkout.
const baseSpec = join(baseDir, specPath);
if (baseSpec !== specFile) {
  mkdirSync(dirname(baseSpec), { recursive: true });
  cpSync(specFile, baseSpec);
}

console.log("Building current tree");
run("pnpm", ["e2e:prepare"], repo);

const beforeDir = join(outDir, "before");
const afterDir = join(outDir, "after");
const baseRun = join(baseDir, ".e2e", "evidence-run");
runSpec(baseDir, specPath, baseRun);
rmSync(beforeDir, { recursive: true, force: true });
mkdirSync(dirname(beforeDir), { recursive: true });
cpSync(baseRun, beforeDir, { recursive: true });
runSpec(repo, specPath, afterDir);

console.log(buildEvidenceDiff(beforeDir, afterDir, join(outDir, "contact-sheets")));
