import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBridgeMetadata, feedTags, ownMetadata } from "./update-feed.mjs";

const hash = `${"a".repeat(86)}==`;
const bridge = `version: 0.12.0
files:
  - url: ../v0.12.0/T3.Factory-0.12.0-arm64.zip
    sha512: ${hash}
    size: 144976937
path: ../v0.12.0/T3.Factory-0.12.0-arm64.zip
sha512: ${hash}
releaseDate: '2026-12-01T10:00:00.000Z'
releaseName: T3 Factory 0.12.0
releaseNotes: "<ul><li>T3 Factory is now AgentEasel.</li></ul>"
`;
const attached = { "latest-mac.yml": bridge, "beta-mac.yml": bridge };

await test("a release that carries the frozen bridge metadata under both names passes", () => {
  assert.deepEqual(checkBridgeMetadata(bridge, attached), []);
});

await test("a release without the frozen bridge metadata fails", () => {
  const problems = checkBridgeMetadata(bridge, { "latest-mac.yml": bridge });

  assert.deepEqual(problems, ["beta-mac.yml is not attached to the release"]);
});

await test("a release whose bridge metadata was replaced by AgentEasel's own fails", () => {
  const own = bridge.replaceAll("../v0.12.0/T3.Factory-0.12.0", "AgentEasel-1.0.0");

  const problems = checkBridgeMetadata(bridge, { ...attached, "latest-mac.yml": own });

  assert.deepEqual(problems, ["latest-mac.yml differs from .github/release/bridge-mac.yml"]);
});

const unusable = {
  "an absolute bridge URL": bridge.replaceAll(
    "../v0.12.0/",
    "https://github.com/owner/repo/releases/download/v0.12.0/",
  ),
  "missing bridge notes": bridge.replace(/^releaseNotes: .*\n/m, ""),
  "an unfinalized bridge hash": bridge.replaceAll(
    hash,
    "FINALIZE-FROM-THE-PUBLISHED-BRIDGE-RELEASE",
  ),
};

for (const [problem, frozen] of Object.entries(unusable)) {
  await test(`frozen metadata with ${problem} fails`, () => {
    assert.notDeepEqual(checkBridgeMetadata(frozen, attached), []);
  });
}

await test("AgentEasel's own metadata addresses its Release downloads with the Release's notes", () => {
  const built = `version: 1.0.0
files:
  - url: AgentEasel-1.0.0-arm64.zip
    sha512: ${hash}
    size: 10
  - url: AgentEasel-1.0.0-arm64.dmg
    sha512: ${hash}
    size: 11
path: AgentEasel-1.0.0-arm64.zip
sha512: ${hash}
releaseDate: '2026-12-02T10:00:00.000Z'
`;
  const base = "https://github.com/agent-easel/agenteasel/releases/download/v1.0.0";

  const metadata = ownMetadata(built, {
    downloadBase: base,
    releaseName: "AgentEasel 1.0.0",
    releaseNotes: '<ul><li>First "AgentEasel" release</li></ul>',
  });

  assert.match(metadata, new RegExp(`^ {2}- url: ${base}/AgentEasel-1.0.0-arm64.zip$`, "m"));
  assert.match(metadata, new RegExp(`^ {2}- url: ${base}/AgentEasel-1.0.0-arm64.dmg$`, "m"));
  assert.match(metadata, new RegExp(`^path: ${base}/AgentEasel-1.0.0-arm64.zip$`, "m"));
  assert.match(metadata, /^releaseNotes: "<ul><li>First \\"AgentEasel\\" release<\/li><\/ul>"$/m);
});

const release = (tag_name, { prerelease = false, draft = false, own = true } = {}) => ({
  tag_name,
  prerelease,
  draft,
  assets: [{ name: own ? "agenteasel-mac.yml" : "latest-mac.yml" }],
});

await test("stable reads the newest Release and beta the newest Release or beta build", () => {
  const releases = [
    release("v1.1.0", { draft: true }),
    release("v1.0.1-beta.9", { prerelease: true }),
    release("v1.0.0"),
    release("v0.12.0", { own: false }),
  ];

  assert.deepEqual(feedTags(releases), { latest: "v1.0.0", beta: "v1.0.1-beta.9" });
});

await test("a Release newer than the last beta build reaches beta installations", () => {
  const releases = [release("v1.0.1"), release("v1.0.1-beta.9", { prerelease: true })];

  assert.deepEqual(feedTags(releases), { latest: "v1.0.1", beta: "v1.0.1" });
});
