import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";

/** The endpoint the development seed saves; the controlled T3 answers on any address. */
const seededEndpoint = "http://127.0.0.1:0/demo-only/mcp";

/**
 * Puts the shared host into First-run setup: not completed, a T3 runtime file in the fixture's
 * T3 state directory and no Connected T3. The seeded endpoint stays saved, because the running
 * host holds it in memory; Connect replaces it with the detected address.
 *
 * T3's settings turn on Claude and Codex with nothing installed, as in Figma F04, and keep
 * Cursor and Grok off; `harnessesOn: false` turns Claude and Codex off too. The reporting
 * module's reset reinstalls the seeded Codex.
 */
export function firstRunSetupFixture({ factory, t3, home }: Host) {
  const runtimeFile = join(home, "reporting-t3-state", "server-runtime.json");
  const settingsFile = join(home, "reporting-t3-state", "settings.json");
  const codex = join(home, "reporting-codex");
  const claude = join(home, "reporting-claude");
  let seeded: { settings: string; serverVersion: string } | null = null;

  function recordCompleted(completed: boolean) {
    using database = new DatabaseSync(join(home, "factory.sqlite"));
    database
      .prepare("UPDATE first_run_setup SET completed = ? WHERE singleton = 1")
      .run(completed ? 1 : 0);
  }

  return {
    actions: {
      async fresh({ harnessesOn = true }: { harnessesOn?: boolean } = {}) {
        seeded = {
          settings: await readFile(settingsFile, "utf8"),
          serverVersion: t3.contract.serverVersion,
        };
        recordCompleted(false);
        t3.contract.serverVersion = "0.1.11";
        await mkdir(claude, { recursive: true });
        await rm(join(codex, "config.toml"), { force: true });
        await writeFile(
          settingsFile,
          JSON.stringify({
            providerInstances: {
              "setup-claude": {
                driver: "claudeAgent",
                enabled: harnessesOn,
                config: { homePath: claude },
              },
              "codex-main": {
                driver: "codex",
                enabled: harnessesOn,
                config: { homePath: codex },
              },
              "setup-cursor": { driver: "cursor" },
              "setup-grok": { driver: "grok", enabled: false },
            },
          }),
        );
        await mkdir(dirname(runtimeFile), { recursive: true });
        await writeFile(
          runtimeFile,
          JSON.stringify({
            version: 1,
            pid: process.pid,
            port: 3773,
            origin: "http://127.0.0.1:3773",
            startedAt: new Date().toISOString(),
            serverVersion: "0.1.11",
          }),
        );
        t3.connection.authorized = false;
        requireSuccess(await factory.recheckConnection());
      },
    },
    async reset() {
      if (!seeded) return;
      await writeFile(settingsFile, seeded.settings);
      t3.contract.serverVersion = seeded.serverVersion;
      seeded = null;
      await rm(runtimeFile, { force: true });
      await rm(claude, { recursive: true, force: true });
      recordCompleted(true);
      t3.connection.available = true;
      t3.connection.approve();
      requireSuccess(await factory.configureConnection({ endpoint: seededEndpoint }));
      requireSuccess(await factory.recheckConnection());
    },
  };
}
