import { readFileSync } from "node:fs";
import notarize from "./scripts/notarize.mjs";

const { factoryBuild } = JSON.parse(
  readFileSync(new URL("stage/package.json", import.meta.url), "utf8"),
);
const feed = process.env.FACTORY_UPDATE_URL;
const publish = feed
  ? [
      {
        provider: "generic",
        url: feed,
        ...(factoryBuild.channel === "beta" ? { channel: "beta" } : {}),
      },
    ]
  : null;
const signed = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarized = signed && Boolean(process.env.APPLE_API_KEY);

export default {
  appId: "app.agenteasel.desktop",
  productName: "AgentEasel",
  // electron-builder's default ${version} drops SemVer build metadata.
  // Match GitHub's download names so update metadata and checksums use the same URLs.
  artifactName: `AgentEasel-${factoryBuild.version}-\${arch}.\${ext}`,
  copyright: "AgentEasel",
  directories: { app: "stage", output: "release", buildResources: "resources" },
  files: ["build/**/*", "!build/**/*.map", "package.json"],
  asar: true,
  asarUnpack: ["build/native/fs-ext/build/Release/*.node", "build/native/notifications.node"],
  // stage.mjs already built the native modules for this Electron ABI.
  npmRebuild: false,
  nodeGypRebuild: false,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  mac: {
    target: [
      { target: "dmg", arch: ["arm64"] },
      // Squirrel.Mac installs updates from the zip.
      { target: "zip", arch: ["arm64"] },
    ],
    category: "public.app-category.developer-tools",
    // macOS bundle version fields stay numeric; package/app and artifact versions carry Git identity.
    bundleVersion: factoryBuild.baseVersion,
    bundleShortVersion: factoryBuild.baseVersion,
    icon: "resources/icon.png",
    minimumSystemVersion: "13.0",
    // Notarization requires the hardened runtime; ad-hoc developer packages cannot use it.
    hardenedRuntime: signed,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",
    // Apple Silicon kills unsigned binaries, and fuse flipping voids Electron's linker
    // signature: developer packages are ad-hoc signed ("-"), which is not a release signature.
    identity: signed ? undefined : "-",
    // scripts/notarize.mjs notarizes in afterSign instead, so stapling can retry.
    notarize: false,
  },
  afterSign: notarized ? notarize : undefined,
  dmg: { sign: false },
  // Local builds never attach to a release feed, even if release credentials are in the shell.
  publish: factoryBuild.channel === "development" ? null : publish,
};
