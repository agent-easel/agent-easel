import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const bridgeMetadataPath = ".github/release/bridge-mac.yml";
export const bridgeAssetNames = ["latest-mac.yml", "beta-mac.yml"];
export const ownMetadataName = "agenteasel-mac.yml";

const sha512 = /^[A-Za-z0-9+/]{86}==$/;

export function bridgeMetadataProblems(text) {
  const field = (name) => text.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1].trim();
  const version = field("version");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    return [`version must be the stable bridge version, got '${version ?? ""}'`];
  const zip = `../v${version}/T3.Factory-${version}-arm64.zip`;
  const problems = [];
  const urls = [...text.matchAll(/^ {2}- url: (.+)$/gm)].map((match) => match[1].trim());
  if (urls.length !== 1 || urls[0] !== zip) problems.push(`files must list only url ${zip}`);
  if (field("path") !== zip) problems.push(`path must be ${zip}`);
  const hashes = [...text.matchAll(/^ *sha512: (.+)$/gm)].map((match) => match[1].trim());
  if (hashes.length !== 2 || hashes.some((hash) => !sha512.test(hash)) || hashes[0] !== hashes[1])
    problems.push("files and the top level must carry the same bridge zip sha512");
  if (!/^ {4}size: [1-9]\d*$/m.test(text)) problems.push("files must carry the bridge zip size");
  if (!field("releaseDate")) problems.push("releaseDate is missing");
  if (!field("releaseName")) problems.push("releaseName is missing");
  if (!field("releaseNotes")) problems.push("releaseNotes is missing");
  if (text.includes("://")) problems.push("absolute URLs resolve under the selected tag and fail");
  return problems;
}
export function checkBridgeMetadata(frozen, assets) {
  const problems = bridgeMetadataProblems(frozen).map(
    (problem) => `${bridgeMetadataPath}: ${problem}`,
  );
  for (const name of bridgeAssetNames) {
    if (!assets) break;
    if (assets[name] === undefined) problems.push(`${name} is not attached to the release`);
    else if (assets[name] !== frozen) problems.push(`${name} differs from ${bridgeMetadataPath}`);
  }
  return problems;
}
export function ownMetadata(built, { downloadBase, releaseName, releaseNotes }) {
  const base = downloadBase.endsWith("/") ? downloadBase : `${downloadBase}/`;
  let addressed = 0;
  const lines = built
    .trimEnd()
    .split("\n")
    .map((line) =>
      line.replace(/^( {2}- url: |path: )(\S+)$/, (_, key, file) => {
        if (file.includes("/")) throw new Error(`Expected a bare file name in '${line}'.`);
        addressed += 1;
        return `${key}${base}${file}`;
      }),
    );
  if (addressed < 2 || lines.some((line) => /^release(Name|Notes):/.test(line)))
    throw new Error("Unexpected electron-builder update metadata.");
  lines.push(`releaseName: ${JSON.stringify(releaseName)}`);
  lines.push(`releaseNotes: ${JSON.stringify(releaseNotes)}`);
  return `${lines.join("\n")}\n`;
}

function semver(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(tag);
  return match && match.slice(1).map((part) => (part === undefined ? Infinity : Number(part)));
}

const newer = (a, b) => {
  const [x, y] = [semver(a.tag_name), semver(b.tag_name)];
  const index = x.findIndex((part, i) => part !== y[i]);
  return index !== -1 && x[index] > y[index];
};
export function feedTags(releases) {
  const published = releases.filter(
    (release) =>
      !release.draft &&
      semver(release.tag_name) &&
      release.assets.some((asset) => asset.name === ownMetadataName),
  );
  const newest = (candidates) =>
    candidates.reduce((best, release) => (!best || newer(release, best) ? release : best), null)
      ?.tag_name ?? null;
  return {
    latest: newest(published.filter((release) => !release.prerelease)),
    beta: newest(published),
  };
}

function main([command, ...args]) {
  if (command === "check-bridge") {
    const [assetDirectory] = args;
    const read = (name) => {
      try {
        return readFileSync(join(assetDirectory, name), "utf8");
      } catch {
        return undefined;
      }
    };
    const assets =
      assetDirectory && Object.fromEntries(bridgeAssetNames.map((name) => [name, read(name)]));
    const problems = checkBridgeMetadata(readFileSync(bridgeMetadataPath, "utf8"), assets);
    if (problems.length > 0) {
      console.error(
        `Old T3 Factory installations would not reach the bridge release:\n${problems.map((problem) => `  ${problem}`).join("\n")}`,
      );
      process.exit(1);
    }
    return;
  }
  if (command === "own") {
    const [built, output] = args;
    const { DOWNLOAD_BASE, RELEASE_NAME, RELEASE_NOTES } = process.env;
    writeFileSync(
      output,
      ownMetadata(readFileSync(built, "utf8"), {
        downloadBase: DOWNLOAD_BASE,
        releaseName: RELEASE_NAME,
        releaseNotes: RELEASE_NOTES,
      }),
    );
    return;
  }
  if (command === "tags") {
    const { latest, beta } = feedTags(JSON.parse(readFileSync(args[0], "utf8")));
    console.log(`latest=${latest ?? ""}\nbeta=${beta ?? ""}`);
    return;
  }
  console.error(
    "Usage: update-feed.mjs check-bridge [asset-dir] | own <built.yml> <out.yml> | tags <releases.json>",
  );
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
