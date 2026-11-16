// electron-builder `afterSign` hook: notarizes the signed application and staples its ticket
// before the dmg and zip are built. It replaces electron-builder's built-in notarization, which
// staples once and fails the whole build when Apple's ticket service drops the connection;
// stapling here goes through stapler.sh, which retries.
// Requires APPLE_API_KEY (path to the .p8 key), APPLE_API_KEY_ID and APPLE_API_ISSUER.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const stapler = fileURLToPath(new URL("stapler.sh", import.meta.url));

export default function notarize({ appOutDir, packager }) {
  const app = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  const missing = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) throw new Error(`Notarization requires ${missing.join(", ")}.`);
  const credentials = [
    "--key",
    process.env.APPLE_API_KEY,
    "--key-id",
    process.env.APPLE_API_KEY_ID,
    "--issuer",
    process.env.APPLE_API_ISSUER,
  ];
  const work = mkdtempSync(join(tmpdir(), "factory-notarize-"));
  try {
    const archive = join(work, "app.zip");
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
    const submitted = spawnSync(
      "xcrun",
      ["notarytool", "submit", archive, ...credentials, "--wait", "--output-format", "json"],
      { encoding: "utf8" },
    );
    let result = {};
    try {
      result = JSON.parse(submitted.stdout);
    } catch {
      // A failed submission may print no JSON; the error below reports its raw output.
    }
    if (submitted.status !== 0 || result.status !== "Accepted") {
      const log =
        typeof result.id === "string"
          ? spawnSync("xcrun", ["notarytool", "log", result.id, ...credentials], {
              encoding: "utf8",
            }).stdout
          : "";
      throw new Error(`Notarization failed: ${submitted.stdout}${submitted.stderr}\n${log}`);
    }
    console.log(`Notarized ${app} (submission ${result.id}).`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  execFileSync(stapler, ["staple", app], { stdio: "inherit" });
}
