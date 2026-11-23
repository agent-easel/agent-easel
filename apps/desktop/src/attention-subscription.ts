import { Layer } from "effect";
import { Socket } from "effect/socket";
import { LIVE_PATH, type RunNavigationEntry, type RunViewLiveMessage } from "@t3-factory/contracts";
import { rpcSessions, type LiveSession } from "@t3-factory/contracts/live-session";
import { FACTORY_MINIMUM_SERVER_PROTOCOL, FACTORY_PROTOCOL } from "@t3-factory/domain-validation";
import type { AttentionCoordinator, AttentionFeed, Selected } from "./attention-coordinator.ts";
import { openLiveSocket } from "./live-relay.ts";
import type { ApiTarget } from "./protocol.ts";

/**
 * The server the installation follows: its ledger identity and how to reach it. A null target
 * (the server role's backend is not running) keeps the selection without connecting.
 */
export interface AttentionSelection extends Selected {
  readonly target: ApiTarget;
}

const liveQuery = new URLSearchParams({
  protocol: String(FACTORY_PROTOCOL),
  minimum: String(FACTORY_MINIMUM_SERVER_PROTOCOL),
}).toString();

const navigationWatch = { rpc: "WatchRunView", navigation: true, runIds: [] } as const;

/** Folds navigation messages into the complete rows; true when a new snapshot replaced them. */
function applyNavigation(
  rows: Map<string, RunNavigationEntry>,
  messages: readonly RunViewLiveMessage[],
): boolean {
  let snapshot = false;
  for (const message of messages) {
    if (message._tag !== "navigation") continue;
    const navigation = message.message;
    if (navigation._tag === "snapshot") {
      rows.clear();
      snapshot = true;
    } else for (const id of navigation.removals) rows.delete(id);
    for (const row of navigation._tag === "snapshot" ? navigation.rows : navigation.upserts)
      rows.set(row.id, row);
  }
  return snapshot;
}

/** Capped exponential retry; an incompatible server is retried as well. */
const retryDelay = (failures: number) => Math.min(10_000, 500 * 2 ** failures);

/**
 * The installation's own navigation subscription in the main process, independent of every
 * window. It is the only source of the coordinator's readiness: an accepted (approved and
 * compatible) connection whose navigation snapshot is applied and current. Any loss clears
 * readiness and reconnects; the next snapshot runs catch-up. A refused credential is a
 * revocation: it ends the selection's feed, and only a later accepted connection (a new
 * credential, or a pending one the owner approved) selects the server again.
 */
export class AttentionSubscription {
  private generation = 0;
  private session: LiveSession | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private feed: AttentionFeed | null = null;

  constructor(private readonly coordinator: AttentionCoordinator) {}

  /**
   * Replaces the subscription after a server, role, credential or backend change; null (no role
   * or no server) follows nothing.
   */
  follow(selection: AttentionSelection | null) {
    this.stop();
    this.feed = this.coordinator.select(selection);
    if (selection?.target)
      this.connect({ ...selection, target: selection.target }, this.generation, 0);
  }

  /** Quit: nothing later reaches the coordinator. */
  stop() {
    this.generation++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.session?.close();
    this.session = null;
  }

  private connect(
    selection: Selected & { readonly target: NonNullable<ApiTarget> },
    generation: number,
    failures: number,
  ) {
    const current = () => generation === this.generation;
    let lostOnce = false;
    let unauthorized = false;
    const lost = () => {
      if (!current() || lostOnce) return;
      lostOnce = true;
      this.session?.close();
      this.session = null;
      if (unauthorized) {
        void this.feed?.revoked();
        this.feed = null;
      } else void this.feed?.notReady();
      this.retry = setTimeout(
        () => this.connect(selection, generation, failures + 1),
        retryDelay(failures),
      );
    };
    // The socket follows the captured target: a selection change replaces this subscription.
    const constructor = Layer.succeed(Socket.WebSocketConstructor, () => {
      const socket = openLiveSocket(selection.target, liveQuery)!;
      // With this listener ws leaves the refused handshake to us; terminating it reports loss.
      socket.once("unexpected-response", (_request, response) => {
        unauthorized = response.statusCode === 401;
        socket.terminate();
      });
      return socket;
    });
    const session = rpcSessions(
      `${LIVE_PATH}?${liveQuery}`,
      constructor,
    )({
      connected: () => undefined,
      disconnected: lost,
    });
    this.session = session;
    const rows = new Map<string, RunNavigationEntry>();
    let established = false;
    let fresh = false;
    let ready = false;
    session.subscribe(navigationWatch, {
      message: (envelope) => {
        if (!current()) return;
        if (applyNavigation(rows, envelope.messages as readonly RunViewLiveMessage[]))
          established = fresh = true;
        if (!established) return;
        // A raced snapshot or a failed re-read is a delivery gap until a current envelope.
        if (!envelope.current) {
          if (ready) void this.feed?.notReady();
          ready = false;
          return;
        }
        ready = true;
        failures = 0;
        this.feed ??= this.coordinator.select(selection);
        void this.feed.deliver({ fresh, rows: [...rows.values()] });
        fresh = false;
      },
      failed: lost,
      lost,
    });
  }
}
