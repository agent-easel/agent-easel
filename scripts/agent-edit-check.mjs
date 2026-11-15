// Claude Code PostToolUse hook (.claude/settings.json): formats the edited file and reports its
// lint findings while the agent still holds the edit, instead of at the pre-push gate.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

const { tool_input: input, cwd } = JSON.parse(readFileSync(0, "utf8"));
const file = typeof input?.file_path === "string" ? relative(cwd, input.file_path) : "";
// Scratch and memory files outside the checkout are not the repository's to format.
if (!file || file.startsWith("..") || isAbsolute(file)) process.exit(0);

function vp(...args) {
  const run = spawnSync("pnpm", ["exec", "vp", ...args, "--no-error-on-unmatched-pattern", file], {
    cwd,
    encoding: "utf8",
  });
  if (run.error || run.status === null) {
    // Exit 1 shows the hook failure to the user without telling the agent its edit is wrong.
    process.stderr.write(
      `agent-edit-check could not run vp ${args[0]}: ${run.error ?? run.signal}\n`,
    );
    process.exit(1);
  }
  return run;
}

// Exit 2 hands stderr back to the agent as feedback on the completed edit.
function report(message, output) {
  process.stderr.write(`${message}:\n${output}\n`);
  process.exit(2);
}

const fmt = vp("fmt");
if (fmt.status !== 0) {
  report(
    "vp fmt could not parse the file you just edited (the pre-push gate fails on it)",
    fmt.stdout || fmt.stderr,
  );
}
if (!/\.(?:[cm]?[jt]sx?)$/.test(file)) process.exit(0);

const lint = vp("lint", "--format=agent");
if (lint.status === 0) process.exit(0);
const findings = lint.stdout.split("\n").filter((line) => line.startsWith(`${file}:`));
if (findings.length === 0) {
  process.stderr.write(`agent-edit-check: vp lint failed without findings:\n${lint.stderr}\n`);
  process.exit(1);
}
report(
  "vp lint findings in the file you just edited (the pre-push gate fails on each; an import or " +
    "variable your next edit uses resolves itself)",
  findings.join("\n"),
);
