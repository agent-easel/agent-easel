import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const oldName = /t3[ ._-]?factory/i;

const everywhere = [/alimek\/t3-factory/gi, /\/T3-Factory\b/g, /\bcd t3-factory\b/g];

export const allowlist = [
  { path: /^CHANGELOG\.md$/, why: "release history" },
  { path: /^apps\/backend\/test\/fixtures\//, why: "captured data of old installations" },
  {
    path: /^(\.github\/release\/bridge-mac\.yml|scripts\/update-feed(\.test)?\.mjs)$/,
    why: "frozen bridge update metadata",
  },
  { path: /^docs\/release\.md$/, why: "update path of old installations" },
  {
    path: /^(apps\/desktop\/(src|test|test\/support)\/previous-installation\.(test\.)?ts|apps\/frontend\/src\/components\/(migration-summary|previous-installation-settings)\.tsx|tests\/desktop-migration\.e2e\.ts)$/,
    why: "migration from the old installation",
  },
  { path: /^docs\/desktop-and-clients\.md$/, why: "bridge release and old data home" },
  { path: /^scripts\/check-product-name\.mjs$/, why: "this gate" },
  { path: /^scripts\/check-product-name\.test\.mjs$/, why: "this gate" },
  { path: /^GLOSSARY\.md$/, why: "lists the names to avoid" },
  { path: /^\.gitignore$/, why: "old data home" },
  { path: /^apps\/desktop\/scripts\/probe-package\.mjs$/, why: "comment about the old data home" },
  { path: /^(apps\/frontend\/src\/styles\.css|docs\/design-system\.md)$/, why: "Figma file title" },
  { path: /^docs\/quality-gates\.md$/, why: "describes this gate" },
  {
    path: /^apps\/landing\/(vercel\.json|test\/deployment\.test\.mjs)$/,
    why: "redirect from the old domain",
  },
  {
    path: /^(packages\/contracts\/src\/portable-document\.ts|docs\/studio\.md|tests\/subflow-import\.e2e\.ts|apps\/(backend|frontend)\/test\/(definition-(import|export)\.test\.ts|support\/definition-import\.ts))$/,
    why: "export format id that import still accepts",
  },
];

const trackedFiles = () =>
  execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);

export function findOldProductName(files, read) {
  const found = [];
  for (const file of files) {
    if (allowlist.some((entry) => entry.path.test(file))) continue;
    const text = read(file);
    if (text === null) continue;
    text.split("\n").forEach((line, index) => {
      const stripped = everywhere.reduce((rest, pattern) => rest.replace(pattern, ""), line);
      if (oldName.test(stripped)) found.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  return found;
}

const readText = (file) => {
  try {
    const buffer = readFileSync(file);
    return buffer.includes(0) ? null : buffer.toString("utf8");
  } catch {
    return null;
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findOldProductName(trackedFiles(), readText);
  if (found.length > 0) {
    console.error(
      `The product is named AgentEasel. These lines still use "T3 Factory", "t3-factory" or "t3factory":\n${found.map((line) => `  ${line}`).join("\n")}\n` +
        "Rename them, or add the file to the allowlist in scripts/check-product-name.mjs when it must keep the old name.",
    );
    process.exit(1);
  }
}
