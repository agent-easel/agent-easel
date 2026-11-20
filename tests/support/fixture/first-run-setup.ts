import { mkdir, rm, writeFile } from "node:fs/promises";
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
 */
export function firstRunSetupFixture({ factory, t3, home }: Host) {
  const runtimeFile = join(home, "reporting-t3-state", "server-runtime.json");
  let fresh = false;

  function recordCompleted(completed: boolean) {
    using database = new DatabaseSync(join(home, "factory.sqlite"));
    database
      .prepare("UPDATE first_run_setup SET completed = ? WHERE singleton = 1")
      .run(completed ? 1 : 0);
  }

  return {
    actions: {
      async fresh() {
        fresh = true;
        recordCompleted(false);
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
      if (!fresh) return;
      fresh = false;
      await rm(runtimeFile, { force: true });
      recordCompleted(true);
      t3.connection.available = true;
      t3.connection.approve();
      requireSuccess(await factory.configureConnection({ endpoint: seededEndpoint }));
      requireSuccess(await factory.recheckConnection());
    },
  };
}
