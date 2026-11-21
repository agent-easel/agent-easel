import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  FactoryClient,
  Result,
  ServerUpdateAction,
} from "../../../packages/contracts/src/index.ts";
import { FACTORY_PROTOCOL } from "../../../packages/domain-validation/src/client-access.ts";
import { unavailableGitHub } from "../../../apps/backend/src/adapters/github.ts";
import { startServer } from "../../../apps/backend/src/server.ts";
import { loadConfiguration } from "../../../apps/backend/src/config.ts";
import { ControlledGit } from "../../../apps/backend/test/support/controlled-git.ts";
import { ControlledT3 } from "../../../apps/backend/test/support/controlled-t3.ts";
import { seedTemplateDatabase } from "../../../apps/backend/test/support/factory.ts";
import { requireSuccess } from "../../../scripts/dev/seed-support.ts";
import { proxyFixture, proxyFixtureUpgrade } from "../proxy.ts";
import type { Host } from "./host.ts";
import { FIXTURE_PREFIX, remoteBrowserPath } from "./seam.ts";

/** The desktop server's updater holding a downloaded beta; approved clients' requests are recorded. */
export function recordedServerUpdates() {
  const actions: ServerUpdateAction[] = [];
  return {
    actions,
    applicationUpdates: {
      status: () => ({
        channel: "beta" as const,
        update: {
          state: "downloaded" as const,
          version: "0.1.1-beta.3",
          progress: 100,
          downloadedBytes: null,
          totalBytes: null,
          checkedAt: null,
          releaseNotes: "<ul><li>Update the server from an approved client.</li></ul>",
          message: null,
        },
      }),
      run: (action: ServerUpdateAction) => {
        actions.push(action);
        return Promise.resolve({ ok: true as const, value: null });
      },
    },
  };
}

async function remoteFactory(protocol: { protocol: number; minimumPeerProtocol: number }) {
  const home = await mkdtemp(join(tmpdir(), "factory-remote-ui-"));
  const config = await loadConfiguration({
    FACTORY_HOME: home,
    FACTORY_PORT: "0",
    FACTORY_REMOTE_ACCESS: "1",
    FACTORY_REMOTE_HOST: "127.0.0.1",
    FACTORY_REMOTE_PORT: "0",
  });
  await seedTemplateDatabase(config.databasePath);
  // Host-side rechecks land quickly so the waiting screen can observe approval on its own.
  const server = await startServer(config, {
    t3: new ControlledT3(),
    git: new ControlledGit(),
    github: unavailableGitHub,
    connectionRetryMs: 1000,
    protocol,
    applicationVersion: "9.0.0",
  });
  return {
    server,
    anchor: server.remoteAccess.trustAnchor()!,
    async close() {
      await server.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}

/** The host opens T3 authorization for remote browsers at most this often (connection.ts). */
const authorizationOpenCooldownMs = 5_000;
/**
 * A server admits this many access requests per peer in a minute (server.ts). Every remote
 * browser reaches it through the fixture, so they all count as one peer.
 */
const accessRequestsPerMinute = 5;
const minuteMs = 60_000;
const sleep = async (ms: number) => {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
};

const remoteCookie = "fixture_remote=1";
const isRemote = (incoming: IncomingMessage) => !!incoming.headers.cookie?.includes(remoteCookie);

/**
 * Remote browsers reach a target server through this module: the host, an older release or a
 * release that no longer accepts this client. It also owns the host's controlled T3 connection
 * and the owner's decisions on device access.
 */
export async function remoteAccessFixture(
  host: Host,
  serverUpdates: ReturnType<typeof recordedServerUpdates>,
  /** How long newly opened live sockets hold back the server's frames. */
  snapshotDelayMs: () => number,
) {
  const { factory, t3 } = host;
  const current = { server: host.server, anchor: host.server.remoteAccess.trustAnchor()! };
  type RemoteFixtureServer = Awaited<ReturnType<typeof remoteFactory>>;
  let older: Promise<RemoteFixtureServer> | undefined;
  let newer: Promise<RemoteFixtureServer> | undefined;
  const ensureOlder = () => (older ??= remoteFactory({ protocol: 1, minimumPeerProtocol: 1 }));
  // A server a release ahead that no longer accepts this client's protocol.
  const ensureNewer = () =>
    (newer ??= remoteFactory({
      protocol: FACTORY_PROTOCOL + 1,
      minimumPeerProtocol: FACTORY_PROTOCOL + 1,
    }));

  let offline = false;
  let dropAccessRequest = false;
  let target: typeof current = current;
  /** Connection status reads the remote UI made since the last reset. */
  let connectionReads = 0;
  /** Remote live sockets end when the fixture drops the network or replaces the server. */
  const liveSockets = new Set<Duplex>();
  const dropLiveSockets = () => {
    for (const socket of liveSockets) socket.destroy();
    liveSockets.clear();
  };
  const retarget = (next: typeof current) => {
    target = next;
    dropLiveSockets();
  };
  // Every authorization a remote browser opens on the host first asks T3 to resume a pending one.
  let authorizationOpenedAt = -Infinity;
  /** When the fixture relayed each access request, per target server. */
  const accessRequests = new Map<typeof current, number[]>();
  const resumeAuthorization = t3.connection.resumeAuthorization.bind(t3.connection);
  t3.connection.resumeAuthorization = (target) => {
    authorizationOpenedAt = Date.now();
    return resumeAuthorization(target);
  };

  async function hostApi<A>(path: string, method = "GET"): Promise<Result<A>> {
    const response = await fetch(`http://127.0.0.1:${current.server.address.port}${path}`, {
      method,
      headers: method === "GET" ? {} : { "X-Factory-Request": "1" },
    });
    return (await response.json()) as Result<A>;
  }

  /** The owner's decision on the host panel for every request of one status. */
  async function decideAll(from: FactoryClient["status"], decision: "approve" | "revoke") {
    const clients = await hostApi<readonly FactoryClient[]>("/api/host/clients");
    if (!clients.ok) throw new Error("Client list unavailable");
    for (const client of clients.value.filter((entry) => entry.status === from))
      await hostApi(`/api/host/clients/${client.id}/${decision}`, "POST");
  }

  /** Approved on the server remote browsers currently reach. */
  async function approvedBrowserCookie() {
    const requested = await target.server.factory.requestClientAccess({
      label: "Approved journey browser",
      kind: "browser",
    });
    if (!requested.ok) throw new Error("Could not request journey browser access");
    const approved = await target.server.factory.approveClient(requested.value.client.id);
    if (!approved.ok) throw new Error("Could not approve the journey browser");
    return `factory_client=${requested.value.credential}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  }

  return {
    actions: {
      /** A device's access request, made through host operations like the approved journey browser. */
      async requestAccess({ label }: { label: string }) {
        assert(label, "A device label is required");
        requireSuccess(await factory.requestClientAccess({ label, kind: "browser" }));
      },
      approve: () => decideAll("pending", "approve"),
      revoke: () => decideAll("approved", "revoke"),
      offline() {
        offline = true;
        dropLiveSockets();
      },
      online() {
        offline = false;
      },
      dropAccessRequest() {
        dropAccessRequest = true;
      },
      compatible: () => retarget(current),
      olderServer: async () => retarget(await ensureOlder()),
      incompatible: async () => retarget(await ensureNewer()),
      /** The owner saved a T3 endpoint on the host; T3 approval happens in the host's browser. */
      async t3Endpoint() {
        t3.connection.authorized = false;
        await factory.configureConnection({ endpoint: "http://127.0.0.1:0/demo-only/mcp" });
      },
      /** T3 stops answering on the host; live connection status follows the recheck. */
      async t3Unavailable() {
        t3.connection.available = false;
        requireSuccess(await factory.recheckConnection());
      },
      async t3Available() {
        t3.connection.available = true;
        requireSuccess(await factory.recheckConnection());
      },
      t3Approve() {
        t3.connection.approve();
      },
      resetConnectionReads() {
        connectionReads = 0;
      },
      serverUpdateActions: () => serverUpdates.actions,
      t3Observations: () => ({
        authorizationStarts: t3.connection.authorizationStarts,
        reopenedApprovals: t3.connection.reopenedApprovals,
        connectionReads,
      }),
    },
    async reset() {
      if (offline || target !== current) dropLiveSockets();
      offline = false;
      target = current;
      dropAccessRequest = false;
      connectionReads = 0;
      t3.connection.authorizationStarts = 0;
      t3.connection.reopenedApprovals = 0;
      // The host ignores another open within its cooldown, so the next journey waits it out.
      await sleep(authorizationOpenedAt + authorizationOpenCooldownMs - Date.now());
      // A journey makes at most one access request, so each server keeps one free in its minute.
      for (const [server, times] of accessRequests) {
        const recent = times.filter((time) => Date.now() - time < minuteMs);
        accessRequests.set(server, recent);
        if (recent.length >= accessRequestsPerMinute)
          await sleep(
            recent[recent.length - accessRequestsPerMinute]! + minuteMs - Date.now() + 100,
          );
      }
      if (!t3.connection.available || !t3.connection.authorized || t3.connection.pendingApproval) {
        t3.connection.available = true;
        t3.connection.approve();
        requireSuccess(await factory.recheckConnection());
      }
    },
    /** Live sockets currently relayed for remote browsers. */
    liveSocketCount: () => liveSockets.size,
    /** Remote browsers reach `server` until `null` returns them to the host. */
    serve(server: typeof current.server | null) {
      retarget(server ? { server, anchor: server.remoteAccess.trustAnchor()! } : current);
    },
    /**
     * Serves the remote browser navigations and relays a remote browser's request to the target
     * server. Returns false for host traffic.
     */
    relay(incoming: IncomingMessage, outgoing: ServerResponse) {
      if (incoming.url === remoteBrowserPath) {
        outgoing.writeHead(302, {
          "set-cookie": `${remoteCookie}; Path=/; HttpOnly; SameSite=Strict`,
          location: "/",
        });
        outgoing.end();
        return true;
      }
      if (!isRemote(incoming)) return false;
      if (incoming.method === "GET" && incoming.url === "/api/connection") connectionReads++;
      // An already approved browser profile, issued through host operations so journeys that
      // are not about access do not spend the server's per-peer access-request limit.
      if (
        incoming.method === "GET" &&
        incoming.url?.startsWith(`${FIXTURE_PREFIX}/approved-browser`)
      ) {
        void approvedBrowserCookie().then((cookie) => {
          const next = new URL(incoming.url!, "http://fixture").searchParams.get("next") ?? "/";
          outgoing.writeHead(302, { "set-cookie": cookie, location: next });
          outgoing.end();
        });
        return true;
      }
      if (incoming.url?.startsWith(FIXTURE_PREFIX)) return false;
      if (dropAccessRequest && incoming.url === "/api/client-access/requests") {
        dropAccessRequest = false;
        outgoing.writeHead(503, { "x-factory-transport": "unreachable" });
        outgoing.end();
        return true;
      }
      // An unreachable server: the connection drops without any reply.
      if (offline) {
        incoming.socket.destroy();
        return true;
      }
      if (incoming.method === "POST" && incoming.url === "/api/client-access/requests")
        accessRequests.set(target, [...(accessRequests.get(target) ?? []), Date.now()]);
      proxyFixture(incoming, outgoing, target.server.remoteAddress()!.port, { ca: target.anchor });
      return true;
    },
    /** Relays a remote browser's live socket to the target server. Returns false for the host's. */
    relayUpgrade(incoming: IncomingMessage, socket: Duplex) {
      if (!isRemote(incoming)) return false;
      if (offline) {
        socket.destroy();
        return true;
      }
      liveSockets.add(socket);
      socket.on("close", () => liveSockets.delete(socket));
      proxyFixtureUpgrade(
        incoming,
        socket,
        target.server.remoteAddress()!.port,
        { ca: target.anchor },
        snapshotDelayMs(),
      );
      return true;
    },
    async close() {
      await Promise.all([
        older?.then((server) => server.close()),
        newer?.then((server) => server.close()),
      ]);
    },
  };
}
