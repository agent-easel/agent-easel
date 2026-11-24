import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuild } from "@electron/rebuild";
import { buildIdentity } from "./build-identity.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const stage = join(root, "stage");
const desktop = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const argv = process.argv.slice(2);
const identity = buildIdentity(
  root,
  desktop.version,
  argv.includes("--release") ? "release" : argv.includes("--beta") ? "beta" : "development",
  argv[argv.indexOf("--beta") + 1],
);
const electronVersion = desktop.devDependencies.electron;
// Resolve the same fs-ext the backend depends on, never a separately chosen version.
const backendRequire = createRequire(
  fileURLToPath(new URL("../../backend/package.json", import.meta.url)),
);
const fsExt = dirname(backendRequire.resolve("fs-ext/package.json"));
const fsExtRequire = createRequire(join(fsExt, "package.json"));
const nan = dirname(fsExtRequire.resolve("nan/package.json"));
const fsExtVersion = JSON.parse(await readFile(join(fsExt, "package.json"), "utf8")).version;

// The workspace's own fs-ext serves `pnpm start` and tests under Node's ABI. Rebuilding
// inside the repository lets @electron/rebuild walk up and replace that shared binary,
// so the Electron copy is built in an isolated directory and the original is checked.
const workspaceBinary = join(fsExt, "build", "Release", "fs_ext.node");
const digest = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const workspaceBefore = await digest(workspaceBinary);
const isolated = await mkdtemp(join(tmpdir(), "factory-desktop-stage-"));

await rm(stage, { recursive: true, force: true });
await mkdir(join(isolated, "node_modules"), { recursive: true });
const copySource = (from, to) =>
  cp(from, to, {
    recursive: true,
    filter: (path) => !/\/(build|node_modules|tests?|\.git)(\/|$)/.test(path.slice(from.length)),
  });
await copySource(fsExt, join(isolated, "node_modules", "fs-ext"));
await copySource(nan, join(isolated, "node_modules", "nan"));
await writeFile(
  join(isolated, "package.json"),
  JSON.stringify(
    {
      name: "agenteasel",
      productName: "AgentEasel",
      version: identity.version,
      factoryBuild: identity,
      description: desktop.description,
      author: "AgentEasel",
      license: "UNLICENSED",
      type: "module",
      main: "build/main.js",
      dependencies: { "fs-ext": fsExtVersion },
    },
    null,
    2,
  ) + "\n",
);
await rebuild({
  buildPath: isolated,
  projectRootPath: isolated,
  electronVersion,
  arch: "arm64",
  onlyModules: ["fs-ext"],
  force: true,
});
if ((await digest(workspaceBinary)) !== workspaceBefore)
  throw new Error(
    `Staging modified the workspace fs-ext binary at ${workspaceBinary}; run pnpm rebuild fs-ext.`,
  );
await cp(isolated, stage, { recursive: true });
await cp(join(root, "build"), join(stage, "build"), { recursive: true });
// Keep the native runtime asset outside node_modules: electron-builder's pnpm collector
// otherwise walks to the workspace and substitutes its Node-ABI build for this copy.
await cp(join(isolated, "node_modules", "fs-ext"), join(stage, "build", "native", "fs-ext"), {
  recursive: true,
});
// The notifications module uses only N-API, which is ABI-stable: it builds against Node's
// headers and loads in Electron. It is never part of `pnpm install`, so Linux CI never builds it.
execFileSync(
  "clang++",
  [
    "-std=c++20",
    "-fobjc-arc",
    "-arch",
    "arm64",
    "-mmacosx-version-min=13.0",
    "-DNODE_GYP_MODULE_NAME=notifications",
    `-I${join(process.execPath, "..", "..", "include", "node")}`,
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-framework",
    "Foundation",
    "-framework",
    "UserNotifications",
    join(root, "native", "notifications.mm"),
    "-o",
    join(stage, "build", "native", "notifications.node"),
  ],
  { stdio: "inherit" },
);
const packagedManifest = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
packagedManifest.dependencies = {};
await writeFile(join(stage, "package.json"), JSON.stringify(packagedManifest, null, 2) + "\n");
await rm(join(stage, "node_modules"), { recursive: true, force: true });
await rm(isolated, { recursive: true, force: true });
console.log(
  `Staged AgentEasel ${identity.version} for Electron ${electronVersion} arm64 at ${stage}`,
);
