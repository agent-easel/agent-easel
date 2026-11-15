import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { proxyFixtureUpgrade } from "../proxy.ts";

/** What browsers sent through the fixture and the live sockets it relays for them. */
export function liveFixture(
  hostPort: number,
  /** Live sockets currently relayed for remote browsers. */
  remoteSocketCount: () => number,
) {
  /** HTTP requests the browser sent through the fixture since the last reset, as `METHOD /path`. */
  let browserRequests: string[] = [];
  /** Live sockets currently relayed for host-surface browsers. */
  const hostSockets = new Set<Duplex>();
  /** Holds back the server's first live frames, so a reconnect stays visibly synchronizing. */
  let snapshotDelayMs = 0;
  return {
    actions: {
      resetRequests() {
        browserRequests = [];
      },
      requests: () => browserRequests,
      sockets: () => ({ host: hostSockets.size, remote: remoteSocketCount() }),
      snapshotDelay({ ms }: { ms: number }) {
        snapshotDelayMs = ms;
      },
    },
    reset() {
      browserRequests = [];
      snapshotDelayMs = 0;
    },
    snapshotDelayMs: () => snapshotDelayMs,
    /** Records a browser's API request, on either surface. */
    record(incoming: IncomingMessage, pathname: string) {
      if (pathname.startsWith("/api/") && incoming.headers["user-agent"]?.includes("Mozilla"))
        browserRequests.push(`${incoming.method} ${pathname}`);
    },
    /** Relays a host-surface browser's live socket to the host. */
    relayHostUpgrade(incoming: IncomingMessage, socket: Duplex) {
      hostSockets.add(socket);
      socket.on("close", () => hostSockets.delete(socket));
      proxyFixtureUpgrade(incoming, socket, hostPort, undefined, snapshotDelayMs);
    },
  };
}
