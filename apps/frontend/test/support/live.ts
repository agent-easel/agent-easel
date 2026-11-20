import {
  RUN_VIEW_LIMIT,
  type ConnectionLiveMessage,
  type RunDetail,
  type RunViewLiveMessage,
  type T3Connection,
} from "@t3-factory/contracts";
import { navigationScope } from "../../src/live/navigation.ts";
import { runScope } from "../../src/live/run.ts";
import {
  LiveOwner,
  type LiveDelivery,
  type LiveWatch,
  type SubscriptionEvents,
} from "../../src/live/owner.ts";
import { runDetail } from "./run.ts";

type FakeSession = {
  readonly connected: () => void;
  readonly disconnected: () => void;
  readonly subscriptions: SubscriptionEvents[];
  readonly watches: LiveWatch[];
  closed: boolean;
};

/** A live owner over scripted sockets and manual timers. */
export function liveHarness() {
  const sessions: FakeSession[] = [];
  const timers = new Set<{ run: () => void; ms: number }>();
  const classified: number[] = [];
  /** The number of sockets opened when each renegotiation was asked for. */
  const renegotiated: number[] = [];
  let delivery: LiveDelivery = "current";
  const owner = new LiveOwner({
    open(events) {
      const session: FakeSession = { ...events, subscriptions: [], watches: [], closed: false };
      sessions.push(session);
      return {
        subscribe(watch, subscription) {
          session.subscriptions.push(subscription);
          session.watches.push(watch);
          return () => undefined;
        },
        close() {
          session.closed = true;
        },
      };
    },
    setTimer(run, ms) {
      const timer = { run, ms };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    random: () => 1,
    classify: () => classified.push(sessions.length),
    renegotiate: () => renegotiated.push(sessions.length),
    publish(next) {
      delivery = next;
    },
  });
  return {
    owner,
    sessions,
    classified,
    renegotiated,
    delivery: () => delivery,
    openSockets: () => sessions.filter((session) => !session.closed).length,
    /** Runs every pending timer once, as if its delay elapsed. */
    elapse() {
      const due = [...timers];
      timers.clear();
      for (const timer of due) timer.run();
    },
  };
}

const connection = (state: T3Connection["state"]): T3Connection => ({
  endpoint: "http://127.0.0.1:0/mcp",
  state,
  explanation: "",
  checkedAt: null,
  authorizationContext: null,
  authorizationPending: false,
  authorizationOpenFailed: false,
  readyGeneration: state === "ready" ? "ready-generation-1" : null,
  contract: null,
});

export const envelope = <M>(messages: readonly M[], current = true) => ({ current, messages });

export const snapshot = (state: T3Connection["state"], current = true) =>
  envelope<ConnectionLiveMessage>([{ _tag: "snapshot", connection: connection(state) }], current);

export const changed = (state: T3Connection["state"]) =>
  envelope<ConnectionLiveMessage>([{ _tag: "changed", connection: connection(state) }]);

export const checked = (checkedAt: string) =>
  envelope<ConnectionLiveMessage>([{ _tag: "checked", checkedAt }]);

/** Current snapshots of navigation and `runs` in one view delivery. */
const viewSnapshots = (...runs: readonly RunDetail[]) =>
  envelope<RunViewLiveMessage>([
    { _tag: "navigation", message: { _tag: "snapshot", rows: [] } },
    ...runs.map((run) => ({
      _tag: "run" as const,
      runId: run.id,
      message: { _tag: "snapshot" as const, run },
    })),
  ]);

/** Navigation and Run `from` are held and current; `from` is then left for Run `to`, whose snapshot arrived. */
export function switchedRuns() {
  const live = liveHarness();
  const from = { ...runDetail(), id: "from" };
  const to = { ...runDetail(), id: "to" };
  live.owner.acquire(navigationScope);
  const releaseFrom = live.owner.acquire(runScope(from.id));
  live.sessions[0]?.connected();
  live.sessions[0]?.subscriptions.at(-1)?.message(viewSnapshots(from));
  releaseFrom();
  const releaseTo = live.owner.acquire(runScope(to.id));
  live.sessions[0]?.subscriptions.at(-1)?.message(viewSnapshots(from, to));
  return { live, from, to, releaseTo };
}

/** One more Run than the view follows, all held over a connected socket; the last is refused for capacity. */
export function overCapacityRuns() {
  const live = liveHarness();
  const runs = Array.from({ length: RUN_VIEW_LIMIT + 1 }, (_, index) => runScope(`run-${index}`));
  const releases = runs.map((scope) => live.owner.acquire(scope));
  live.sessions[0]?.connected();
  return { live, runs, releases };
}
