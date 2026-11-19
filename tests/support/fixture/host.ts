import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../../../apps/backend/src/server.ts";
import { loadConfiguration } from "../../../apps/backend/src/config.ts";
import type { ControlledGitHub } from "../../../apps/backend/test/support/controlled-github.ts";
import { ControlledGit } from "../../../apps/backend/test/support/controlled-git.ts";
import { ControlledT3Connection } from "../../../apps/backend/test/support/controlled-t3-connection.ts";
import { PersistentT3 } from "../../../scripts/dev/persistent-t3.ts";
import { seedDevelopment } from "../../../scripts/dev/seed.ts";
import { requireCurrentUiBuild } from "../../../scripts/ui-build.ts";

type ServerOptions = NonNullable<Parameters<typeof startServer>[1]>;

/**
 * The Factory host every journey's browser reaches: a disposable home, the controlled T3 engine
 * and the seeded development world. `doubles` are the external services fixture modules control.
 */
export async function startHost(
  doubles: Pick<ServerOptions, "discordApiUrl" | "applicationUpdates"> & {
    github: ControlledGitHub;
  },
) {
  requireCurrentUiBuild(fileURLToPath(new URL("../../../", import.meta.url)));
  const home = await mkdtemp(join(tmpdir(), "factory-e2e-"));
  // Harness homes and T3 state default to os.homedir() or the developer's T3 state override; keep
  // them inside the disposable home so journeys never read or write real configuration.
  process.env.HOME = home;
  delete process.env.FACTORY_T3_STATE_DIRECTORY;
  const config = await loadConfiguration({
    FACTORY_HOME: home,
    FACTORY_PORT: process.env.PORT,
    FACTORY_REMOTE_ACCESS: "1",
    FACTORY_REMOTE_HOST: "127.0.0.1",
    FACTORY_REMOTE_PORT: "0",
  });
  const t3 = new PersistentT3(home, false);
  // Use the real pending-approval simulation for remote connection journeys.
  t3.connection.authorize = ControlledT3Connection.prototype.authorize.bind(t3.connection);
  const server = await startServer(
    { ...config, port: 0 },
    {
      t3,
      git: new ControlledGit(),
      connectionRetryMs: 1000,
      reportingStateDirectory: join(home, "reporting-t3-state"),
      ...doubles,
    },
  );
  const factory = server.factory;
  factory.setRuntimeBackendUrl(`http://127.0.0.1:${server.address.port}`);
  const world = await seedDevelopment(factory, t3, doubles.github, home);
  t3.connection.approve();
  let advancing: Promise<void> | undefined;
  const timer = setInterval(() => {
    advancing ??= t3.advance().finally(() => {
      advancing = undefined;
    });
  }, 100);
  return {
    home,
    /** The port browsers reach through the fixture proxy. */
    port: config.port,
    t3,
    server,
    factory,
    /** The development seed's project, Agents and Flows, by key. */
    world,
    context: { factory, t3, projectId: world.project.id },
    async close() {
      clearInterval(timer);
      await advancing;
      await server.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

export type Host = Awaited<ReturnType<typeof startHost>>;
