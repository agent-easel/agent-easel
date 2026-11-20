import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unavailableGitHub } from "../../../apps/backend/src/adapters/github.ts";
import { loadConfiguration } from "../../../apps/backend/src/config.ts";
import { startServer } from "../../../apps/backend/src/server.ts";
import { ControlledGit } from "../../../apps/backend/test/support/controlled-git.ts";
import { ControlledT3 } from "../../../apps/backend/test/support/controlled-t3.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import type { Host } from "./host.ts";
import type { remoteAccessFixture } from "./remote-access.ts";

/** The address T3's runtime file declares; the controlled T3 answers on any address. */
const detectedEndpoint = "http://127.0.0.1:3773/mcp";

export interface FreshOptions {
  /** `false` turns Claude and Codex off in T3, so no installable harness is on. */
  harnessesOn?: boolean;
  /** `false` leaves no runtime file, as when T3 is not running on this computer. */
  t3Running?: boolean;
  /** `false` gives the T3 state directory another T3's identity, so discovery refuses it. */
  sameT3?: boolean;
}

/**
 * A fresh Factory host for First-run setup: a new home, so no completion and no saved T3
 * endpoint, beside the controlled T3 and a disposable T3 state directory. While it runs,
 * host-surface and remote browsers reach it instead of the shared host, which stays untouched.
 *
 * T3's settings turn on Claude and Codex with nothing installed, as in Figma F04, and keep
 * Cursor and Grok off.
 */
async function startFreshHost({
  harnessesOn = true,
  t3Running = true,
  sameT3 = true,
}: FreshOptions) {
  const home = await mkdtemp(join(tmpdir(), "factory-first-run-"));
  const state = join(home, "t3-state");
  const claude = join(home, "reporting-claude");
  const codex = join(home, "reporting-codex");
  await Promise.all([state, claude, codex].map((directory) => mkdir(directory)));
  const t3 = new ControlledT3();
  t3.contract.serverVersion = "0.1.11";
  await writeFile(
    join(state, "environment-id"),
    sameT3 ? t3.connection.environmentId : "another-environment",
  );
  const writeSettings = (codexOn: boolean) =>
    writeFile(
      join(state, "settings.json"),
      JSON.stringify({
        providerInstances: {
          "setup-claude": {
            driver: "claudeAgent",
            enabled: harnessesOn,
            config: { homePath: claude },
          },
          "codex-main": { driver: "codex", enabled: codexOn, config: { homePath: codex } },
          "setup-cursor": { driver: "cursor" },
          "setup-grok": { driver: "grok", enabled: false },
        },
      }),
    );
  await writeSettings(harnessesOn);
  const runtimeFile = join(state, "server-runtime.json");
  const t3Starts = () =>
    writeFile(
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
  if (t3Running) await t3Starts();
  const config = await loadConfiguration({
    FACTORY_HOME: home,
    FACTORY_PORT: "0",
    FACTORY_REMOTE_ACCESS: "1",
    FACTORY_REMOTE_HOST: "127.0.0.1",
    FACTORY_REMOTE_PORT: "0",
  });
  // Rechecks come from the fixture's T3 actions, so a journey sees each state until it changes.
  const server = await startServer(config, {
    t3,
    git: new ControlledGit(),
    github: unavailableGitHub,
    connectionRetryMs: 60_000,
    reportingStateDirectory: state,
  });
  server.factory.setRuntimeBackendUrl(`http://127.0.0.1:${server.address.port}`);
  return {
    server,
    t3,
    t3Starts,
    /** The owner turns Codex on in T3's settings. */
    codexTurnedOn: () => writeSettings(true),
    async close() {
      await server.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

type FreshHost = Awaited<ReturnType<typeof startFreshHost>>;

export function firstRunSetupFixture(
  host: Host,
  remoteAccess: Awaited<ReturnType<typeof remoteAccessFixture>>,
) {
  let fresh: FreshHost | null = null;
  const running = () => {
    if (!fresh) throw new Error("No fresh host: call firstRunSetup.fresh first.");
    return fresh;
  };
  async function stop() {
    remoteAccess.serve(null);
    await fresh?.close();
    fresh = null;
  }
  const recheck = async () => requireSuccess(await running().server.factory.recheckConnection());

  return {
    actions: {
      async fresh(options: FreshOptions = {}) {
        await stop();
        fresh = await startFreshHost(options);
        remoteAccess.serve(fresh.server);
      },
      /** T3 starts on this computer and writes its runtime file. */
      t3Starts: () => running().t3Starts(),
      codexTurnedOn: () => running().codexTurnedOn(),
      /** The owner approves in T3; the host's next check, requested here, sees it. */
      async t3Approve() {
        running().t3.connection.approve();
        await recheck();
      },
      /** The pending approval ends without consent, such as a closed T3 approval page. */
      async approvalAbandoned() {
        running().t3.connection.pendingApproval = false;
        await recheck();
      },
      /** The host's browser can no longer be opened. */
      hostBrowserFails() {
        running().t3.connection.resumeAuthorization = () =>
          Promise.reject(new Error("No browser on the Factory host"));
      },
      async t3Unavailable() {
        running().t3.connection.available = false;
        await recheck();
      },
      /** The owner connects the detected T3 on the host and approves it there. */
      async hostConnects() {
        const { factory } = running().server;
        requireSuccess(await factory.configureConnection({ endpoint: detectedEndpoint }));
        requireSuccess(await factory.authorizeConnection());
        running().t3.connection.approve();
        await recheck();
      },
      authorizationStarts: () => running().t3.connection.authorizationStarts,
    },
    reset: stop,
    /** The port host-surface browsers reach: the fresh host while one runs, else the shared host. */
    hostPort: () => (fresh ?? host).server.address.port,
    close: stop,
  };
}
