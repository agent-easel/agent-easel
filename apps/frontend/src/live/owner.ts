import {
  RUN_VIEW_LIMIT,
  type LiveEnvelope,
  type OperationError,
  type RunViewLiveMessage,
} from "@t3-factory/contracts";
import type { LiveSession, LiveWatch, OpenLiveSession } from "@t3-factory/contracts/live-session";

export type { LiveWatch, SubscriptionEvents } from "@t3-factory/contracts/live-session";

/**
 * `connecting`: no socket is open and none has failed since the window attached.
 * `offline`: the socket failed; a capped, jittered retry is scheduled or running.
 * `synchronizing`: the socket is open and some active scope is not current yet.
 * `live`: every active scope applied a current envelope.
 */
export type LiveState = "connecting" | "synchronizing" | "live" | "offline";

/** What mutation gating needs: product commands run only while delivery is `current`. */
export type LiveDelivery = "current" | "synchronizing" | "offline";

/** Which data a scope shows. Navigation and Runs share one subscription per window. */
export type LivePart =
  | { readonly kind: "connection" }
  | { readonly kind: "navigation" }
  | { readonly kind: "run"; readonly runId: string }
  | { readonly kind: "launchChoices" }
  /** Studio's saved Agents and Flows: read for the window's lifetime, gating while Studio is open. */
  | { readonly kind: "studio" };

type LiveMessage = { readonly _tag: string };
type Snapshot<M extends LiveMessage> = Extract<M, { readonly _tag: "snapshot" }>;

/** One scoped observation; `key` identifies it so equal scopes share one holder. */
export interface LiveScope<M extends LiveMessage, V> {
  readonly key: string;
  readonly part: LivePart;
  readonly snapshot: (message: Snapshot<M>) => V;
  /** Folds a change into the value its subscription's snapshot established. */
  readonly apply: (value: V, message: Exclude<M, Snapshot<M>>) => V;
}

/**
 * Cached values outlive reconnects; `synchronized` is true only while the scope's latest
 * applied envelope is current.
 */
export interface LiveScopeView<V> {
  readonly value: V | null;
  readonly synchronized: boolean;
  /**
   * The server refused this scope. Only `not_found` is final and stops blocking mutations;
   * any other error is retried while mutations stay disabled.
   */
  readonly error: OperationError | null;
}

export interface LiveEnvironment {
  open: OpenLiveSession;
  setTimer(run: () => void, ms: number): () => void;
  random(): number;
  /** Repeated open failures: classify through the HTTP handshake (incompatible, unauthorized). */
  classify(): void;
  /**
   * A later socket connected: the server may have been replaced by another release, so the
   * window re-reads the protocol it speaks.
   */
  renegotiate(): void;
  publish(delivery: LiveDelivery): void;
}

const baseDelayMs = 500;
const maxDelayMs = 10_000;
/** A browser cannot read why a WebSocket upgrade failed; ask HTTP after this many in a row. */
const openFailuresBeforeClassify = 2;
/** Covers an immediate remount (StrictMode, route swaps) without reopening the subscription. */
const releaseLingerMs = 250;

/** Equal jitter over a capped exponential: half the ceiling plus a random share of the rest. */
export function reconnectDelay(attempt: number, random: number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return ceiling / 2 + (random * ceiling) / 2;
}

const emptyView: LiveScopeView<never> = { value: null, synchronized: false, error: null };
/** A Run beyond the view's capacity is refused here instead of breaking the shared view. */
const overCapacity: OperationError = {
  code: "validation",
  message: `At most ${RUN_VIEW_LIMIT} Runs can be followed live in one window.`,
  issues: [],
};
/** No holder and no pending release: a Run the view keeps until it next subscribes again. */
const kept = (entry: Entry) => entry.refs === 0 && entry.linger === undefined;
/** Final for one scope: an unknown Run, or a Run refused for capacity. */
const terminal = (error: OperationError | null) =>
  error?.code === "not_found" || error === overCapacity;

/** Entries erase each scope's message and value types; a scope only sees its own messages. */
type AnyScope = {
  readonly key: string;
  readonly part: LivePart;
  readonly snapshot: (message: LiveMessage) => unknown;
  readonly apply: (value: unknown, message: LiveMessage) => unknown;
};

type Entry = {
  readonly scope: AnyScope;
  refs: number;
  /** Holders that gate mutations; a scope held only for reading never shows synchronizing. */
  gating: number;
  view: LiveScopeView<unknown>;
  linger: (() => void) | undefined;
  /** The current subscription delivered this scope's snapshot; changes apply only after it. */
  established: boolean;
};

/**
 * The connection status subscription, the one view subscription for navigation and Runs, the
 * composer's launch choices, Studio's saved definitions and theme colors.
 */
type Channel = "connection" | "view" | "launchChoices" | "studio";
const channels: readonly Channel[] = ["connection", "view", "launchChoices", "studio"];

type Subscription = {
  /** Fences events: only the subscription holding the current token may write. */
  token: number;
  /** The watch the open subscription serves; a different wanted watch resubscribes. */
  signature: string | undefined;
  stop: (() => void) | undefined;
  retry: (() => void) | undefined;
  failures: number;
};

type Session = { connected: boolean; handle: LiveSession | undefined };

function channelOf(part: LivePart): Channel {
  if (part.kind === "navigation" || part.kind === "run") return "view";
  return part.kind;
}

const idleSubscription = (): Subscription => ({
  token: 0,
  signature: undefined,
  stop: undefined,
  retry: undefined,
  failures: 0,
});

/** The window's single live connection and its ref-counted scopes. */
export class LiveOwner {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly subscriptions: Record<Channel, Subscription> = {
    connection: idleSubscription(),
    view: idleSubscription(),
    launchChoices: idleSubscription(),
    studio: idleSubscription(),
  };
  private session: Session | null = null;
  private retry: (() => void) | undefined;
  private attempts = 0;
  private openFailures = 0;
  /** Sockets that connected in this window's lifetime. */
  private connections = 0;
  private visible = true;
  private blocked = false;
  private readonly environment: LiveEnvironment;
  state: LiveState = "connecting";

  constructor(environment: LiveEnvironment) {
    this.environment = environment;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  view<V>(key: string): LiveScopeView<V> {
    return (this.entries.get(key)?.view ?? emptyView) as LiveScopeView<V>;
  }

  /**
   * Holds `scope` until the returned function is called. A holder that only reads (`gates:
   * false`) receives the same view, but the scope gates mutations only while a gating holder
   * holds it.
   */
  acquire<M extends LiveMessage, V>(
    scope: LiveScope<M, V>,
    { gates = true }: { readonly gates?: boolean } = {},
  ): () => void {
    const gating = gates ? 1 : 0;
    let entry = this.entries.get(scope.key);
    if (entry) {
      entry.linger?.();
      entry.linger = undefined;
      entry.refs++;
      entry.gating += gating;
      if (gates) this.changed();
    } else {
      entry = {
        scope: scope as unknown as AnyScope,
        refs: 1,
        gating,
        view: emptyView,
        linger: undefined,
        established: false,
      };
      this.entries.set(scope.key, entry);
      if (this.session) this.resubscribe();
      else this.ensureConnection();
      this.changed();
    }
    const held = entry;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held.gating -= gating;
      if (--held.refs === 0)
        held.linger = this.environment.setTimer(() => this.drop(held), releaseLingerMs);
      if (gates) this.changed();
    };
  }

  /** A hidden window detaches every scope; a visible one reattaches with fresh snapshots. */
  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.reattach();
  }

  /** The client gate owns access-lost and incompatible windows; no socket is opened meanwhile. */
  setBlocked(blocked: boolean) {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.reattach();
  }

  private reattach() {
    this.detach();
    this.ensureConnection();
    this.changed();
  }

  private wanted() {
    return this.entries.size > 0 && this.visible && !this.blocked;
  }

  private ensureConnection() {
    if (this.session || this.retry || !this.wanted()) return;
    const session: Session = { connected: false, handle: undefined };
    this.session = session;
    const handle = this.environment.open({
      connected: () => {
        if (this.session !== session) return;
        session.connected = true;
        this.openFailures = 0;
        if (this.connections++ > 0) this.environment.renegotiate();
        this.changed();
      },
      disconnected: () => this.lost(session),
    });
    if (this.session !== session) {
      handle.close();
      return;
    }
    session.handle = handle;
    this.resubscribe();
  }

  private entriesOf(channel: Channel) {
    return [...this.entries.values()].filter((entry) => channelOf(entry.scope.part) === channel);
  }

  /** Run scopes the view serves, held ones before lingering ones, and those over capacity. */
  private viewRuns() {
    const runs = this.entriesOf("view").filter((entry) => entry.scope.part.kind === "run");
    const ordered = [
      ...runs.filter((entry) => entry.refs > 0),
      ...runs.filter((entry) => entry.refs === 0),
    ];
    return { served: ordered.slice(0, RUN_VIEW_LIMIT), refused: ordered.slice(RUN_VIEW_LIMIT) };
  }

  /** The watch each channel needs for the scopes held now, or undefined when none is held. */
  private wantedWatch(channel: Channel): LiveWatch | undefined {
    const entries = this.entriesOf(channel);
    if (entries.length === 0) return undefined;
    if (channel === "connection") return { rpc: "WatchConnection" };
    if (channel === "launchChoices") return { rpc: "WatchLaunchChoices" };
    if (channel === "studio") return { rpc: "WatchStudio" };
    const runIds = this.viewRuns()
      .served.flatMap(({ scope: { part } }) => (part.kind === "run" ? [part.runId] : []))
      .sort();
    return {
      rpc: "WatchRunView",
      navigation: entries.some((entry) => entry.scope.part.kind === "navigation"),
      runIds,
    };
  }

  /** Opens, replaces or closes each channel's subscription to match the held scopes. */
  private resubscribe() {
    if (!this.session?.handle) return;
    for (const channel of channels) {
      let watch = this.wantedWatch(channel);
      const signature = watch && JSON.stringify(watch);
      const subscription = this.subscriptions[channel];
      if (signature === subscription.signature && (subscription.stop || subscription.retry))
        continue;
      if (channel === "view" && this.forgetKeptRuns()) watch = this.wantedWatch(channel);
      if (watch) this.start(channel, watch);
      else this.stop(channel);
    }
    for (const entry of this.viewRuns().refused)
      entry.view = { ...entry.view, synchronized: false, error: overCapacity };
  }

  private start(channel: Channel, watch: LiveWatch) {
    const handle = this.session?.handle;
    if (!handle) return;
    const session = this.session;
    this.stop(channel);
    const subscription = this.subscriptions[channel];
    subscription.signature = JSON.stringify(watch);
    // A new subscription starts from its own snapshot: nothing held is current until then.
    for (const entry of this.entriesOf(channel)) {
      entry.view = { ...entry.view, synchronized: false, error: null };
      entry.established = false;
    }
    const token = subscription.token;
    const current = () => subscription.token === token && this.session === session;
    subscription.stop = handle.subscribe(watch, {
      message: (envelope) => {
        if (!current()) return;
        this.receive(channel, envelope);
        this.changed();
      },
      failed: (error) => {
        if (!current()) return;
        this.stop(channel);
        subscription.signature = JSON.stringify(watch);
        for (const entry of this.entriesOf(channel))
          entry.view = { ...entry.view, synchronized: false, error };
        const delay = reconnectDelay(subscription.failures++, this.environment.random());
        subscription.retry = this.environment.setTimer(() => {
          subscription.retry = undefined;
          subscription.signature = undefined;
          this.resubscribe();
          this.changed();
        }, delay);
        this.changed();
      },
      lost: () => {
        if (current() && session) this.lost(session);
      },
    });
  }

  private stop(channel: Channel) {
    const subscription = this.subscriptions[channel];
    subscription.token++;
    subscription.stop?.();
    subscription.stop = undefined;
    subscription.retry?.();
    subscription.retry = undefined;
    subscription.signature = undefined;
  }

  /** Applies one envelope to every scope it addresses, in one notification. */
  private receive(channel: Channel, envelope: LiveEnvelope<LiveMessage>) {
    const entries = this.entriesOf(channel);
    if (envelope.current) this.subscriptions[channel].failures = 0;
    if (channel !== "view") {
      for (const entry of entries) this.applyMessages(entry, envelope.messages, envelope.current);
      return;
    }
    const routed = routeView(entries, envelope.messages as readonly RunViewLiveMessage[]);
    for (const [entry, { messages, missing }] of routed) {
      const error = missing ?? (terminal(entry.view.error) ? entry.view.error : null);
      if (!error) {
        this.applyMessages(entry, messages, envelope.current);
        continue;
      }
      entry.view = { ...entry.view, synchronized: false, error };
      entry.established = true;
    }
  }

  private applyMessages(entry: Entry, messages: readonly LiveMessage[], current: boolean) {
    const { scope } = entry;
    let { value } = entry.view;
    for (const message of messages)
      if (message._tag === "snapshot") {
        value = scope.snapshot(message);
        entry.established = true;
      } else if (entry.established && value !== null) value = scope.apply(value, message);
    // A change cannot apply to a value this subscription did not establish.
    if (!entry.established) return;
    entry.view = { value, synchronized: current, error: null };
  }

  /** A view that subscribes again leaves out the Runs it kept; returns whether any were kept. */
  private forgetKeptRuns() {
    const forgotten = [...this.entries].filter(([, entry]) => kept(entry));
    for (const [key] of forgotten) this.entries.delete(key);
    return forgotten.length > 0;
  }

  /**
   * A released Run stays in the view, still updated, until the view next subscribes again:
   * resubscribing now would put the Run opened in its place back to synchronizing just after it
   * showed live, and reopening the kept Run shows it live at once. A Run refused for capacity had
   * no slot to keep, and a held Run refused for capacity takes the freed slot instead.
   */
  private keepsReleased(entry: Entry) {
    if (entry.scope.part.kind !== "run" || entry.view.error === overCapacity) return false;
    const held = [...this.entries.values()].filter((other) => !kept(other));
    return held.length > 0 && !held.some((other) => other.view.error === overCapacity);
  }

  private drop(entry: Entry) {
    if (this.entries.get(entry.scope.key) !== entry) return;
    entry.linger = undefined;
    if (this.keepsReleased(entry)) return;
    this.entries.delete(entry.scope.key);
    if ([...this.entries.values()].some((other) => !kept(other))) this.resubscribe();
    else {
      this.entries.clear();
      this.detach();
    }
    this.changed();
  }

  private lost(session: Session) {
    if (this.session !== session) return;
    this.closeSession();
    if (!session.connected && ++this.openFailures >= openFailuresBeforeClassify)
      this.environment.classify();
    this.state = "offline";
    const delay = reconnectDelay(this.attempts++, this.environment.random());
    this.retry = this.environment.setTimer(() => {
      this.retry = undefined;
      this.ensureConnection();
      this.changed();
    }, delay);
    this.changed();
  }

  /** Closes the socket and any pending retry; cached values stay, unsynchronized. */
  private detach() {
    this.retry?.();
    this.retry = undefined;
    this.attempts = 0;
    this.openFailures = 0;
    this.closeSession();
    this.state = "connecting";
  }

  private closeSession() {
    const session = this.session;
    this.session = null;
    for (const channel of channels) {
      this.stop(channel);
      this.subscriptions[channel].failures = 0;
    }
    for (const entry of this.entries.values()) {
      entry.established = false;
      if (entry.view.synchronized || entry.view.error)
        entry.view = { ...entry.view, synchronized: false, error: null };
    }
    session?.handle?.close();
  }

  /** Scopes held only for reading neither gate mutations nor show synchronizing. */
  private settled() {
    for (const entry of this.entries.values())
      if (entry.gating > 0 && !entry.view.synchronized && !terminal(entry.view.error)) return false;
    return true;
  }

  private changed() {
    if (this.session?.connected) {
      this.state = this.settled() ? "live" : "synchronizing";
      if (this.state === "live") this.attempts = 0;
    }
    this.environment.publish(this.delivery());
    for (const listener of this.listeners) listener();
  }

  private delivery(): LiveDelivery {
    if (this.entries.size === 0) return "current";
    if (this.state === "offline") return "offline";
    return this.state === "live" ? "current" : "synchronizing";
  }
}

/** Each view scope's share of one envelope: its messages, or the error that ends it. */
function routeView(entries: readonly Entry[], messages: readonly RunViewLiveMessage[]) {
  const routed = new Map<Entry, { messages: LiveMessage[]; missing: OperationError | null }>(
    entries.map((entry) => [entry, { messages: [], missing: null }]),
  );
  for (const message of messages) {
    const entry = entries.find((candidate) => addresses(candidate.scope.part, message));
    const share = entry && routed.get(entry);
    if (!share) continue;
    if (message._tag === "missing") share.missing = message.error;
    else share.messages.push(message.message);
  }
  return routed;
}

function addresses(part: LivePart, message: RunViewLiveMessage) {
  if (message._tag === "navigation") return part.kind === "navigation";
  return part.kind === "run" && part.runId === message.runId;
}
