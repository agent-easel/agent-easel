import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const testFile = /\.(?:test|e2e)\.(?:[cm]?[jt]s|[jt]sx)$/;

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function files(...args) {
  return git(...args)
    .split("\0")
    .filter((path) => sourceFile.test(path));
}

function commentRanges(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, source.languageVariant);
  const ranges = [];
  let end = 0;

  function scanGap(start) {
    scanner.setText(source.text, end, start - end);
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      if (
        kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        kind === ts.SyntaxKind.MultiLineCommentTrivia
      ) {
        ranges.push({ start: scanner.getTokenStart(), end: scanner.getTokenEnd() });
      }
    }
  }

  function visit(node) {
    const children = node.getChildren(source).filter((child) => !ts.isJSDoc(child));
    if (children.length > 0) {
      children.forEach(visit);
      return;
    }
    const start = ts.isJsxText(node) ? node.pos : node.getStart(source);
    if (start < end) return;
    scanGap(start);
    end = node.end;
  }

  visit(source);
  return ranges;
}

function inventory(path, content) {
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest);
  const lineStarts = source.getLineStarts();
  return commentRanges(source).map(({ start, end }) => {
    const text = content.slice(start, end);
    const first = source.getLineAndCharacterOfPosition(start);
    const last = source.getLineAndCharacterOfPosition(end);
    const before = content.slice(lineStarts[first.line], start);
    const after = content.slice(end, lineStarts[last.line + 1] ?? content.length);
    const testLabel =
      testFile.test(path) &&
      before.trim() === "" &&
      /^\/\/ (Arrange|Act|Assert)$/.test(text.trimEnd());
    const license = text.startsWith("/*!") || /^\s*\*\s+@license\b/m.test(text);
    return {
      path,
      line: first.line + 1,
      column: first.character + 1,
      start,
      end,
      text,
      standalone: before.trim() === "" && after.trim() === "",
      exception: testLabel ? "test label" : license ? "license" : null,
    };
  });
}

function additions(previous, current) {
  const remaining = new Map();
  for (const { text } of previous) {
    remaining.set(text, (remaining.get(text) ?? 0) + 1);
  }
  return current.filter(({ text, exception }) => {
    if (exception === "test label") return false;
    const allowance = remaining.get(text) ?? 0;
    if (allowance === 0) return true;
    remaining.set(text, allowance - 1);
    return false;
  });
}

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function showInventory(paths) {
  const tracked = files("ls-files", "--cached", "--others", "--exclude-standard", "-z");
  const selected = tracked.filter(
    (path) =>
      paths.length === 0 ||
      paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
  );
  const deleted = new Set(files("ls-files", "--deleted", "-z"));
  for (const path of new Set(selected)) {
    if (!deleted.has(path)) {
      for (const comment of inventory(path, read(path))) {
        console.log(JSON.stringify(comment));
      }
    }
  }
}

function check(base) {
  const changes = git(
    "diff",
    "--name-status",
    "--no-renames",
    "--diff-filter=AMT",
    "-z",
    base,
    "--",
  )
    .split("\0")
    .slice(0, -1);
  const tracked = new Map();
  for (let index = 0; index < changes.length; index += 2) {
    const [status, path] = changes.slice(index, index + 2);
    if (sourceFile.test(path)) tracked.set(path, status !== "A");
  }
  const untracked = files("ls-files", "--others", "--exclude-standard", "-z");
  for (const path of untracked) {
    if (!tracked.has(path)) tracked.set(path, false);
  }

  for (const [path, existed] of tracked) {
    const previous = existed ? inventory(path, git("show", `${base}:${path}`)) : [];
    for (const { line, column } of additions(previous, inventory(path, read(path)))) {
      console.error(
        `${path}:${line}:${column} [no-new-comments] Express intent in code or record the decision in an ADR.`,
      );
      process.exitCode = 1;
    }
  }
}

const [mode, ...args] = process.argv.slice(2);
if (mode === "--inventory") {
  showInventory(
    args
      .map((path) => path.split(sep).join("/").replace(/^\.\//, "").replace(/\/$/, ""))
      .filter((path) => path !== "." && path !== ""),
  );
} else if (mode === undefined || (mode === "--base" && args.length === 1)) {
  const ref = args[0] ?? process.env.FACTORY_COMMENT_BASE;
  const base = ref
    ? git("rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`).trim()
    : git("merge-base", "HEAD", "origin/main").trim();
  check(base);
} else {
  console.error("Usage: node scripts/check-comments.mjs [--base <ref> | --inventory [path ...]]");
  process.exitCode = 2;
}
