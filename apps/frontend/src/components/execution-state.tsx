import { StatusBadge, type StatusBadgeKind } from "./status-badge.tsx";

/** Recorded execution states in their canonical words: "error" reads as Problem, a sent
 * Continuation as Working and one that passed its response on as Finished. */
const states: Record<string, { readonly kind: StatusBadgeKind; readonly label: string }> = {
  working: { kind: "working", label: "Working" },
  waiting: { kind: "waiting", label: "Waiting" },
  queued: { kind: "waiting", label: "Queued" },
  pending: { kind: "waiting", label: "Pending" },
  sent: { kind: "working", label: "Working" },
  finished: { kind: "finished", label: "Finished" },
  "pass-through": { kind: "finished", label: "Finished" },
  settled: { kind: "finished", label: "Settled" },
  forwarded: { kind: "finished", label: "Forwarded" },
  acknowledged: { kind: "finished", label: "Acknowledged" },
  error: { kind: "problem", label: "Problem" },
  stopped: { kind: "stopped", label: "Stopped" },
  cancelled: { kind: "stopped", label: "Cancelled" },
  archived: { kind: "stopped", label: "Archived" },
  "not-started": { kind: "neutral", label: "Not started" },
};

const executionState = (state: string) =>
  states[state] ?? {
    kind: "neutral" as const,
    label: state.charAt(0).toUpperCase() + state.slice(1),
  };

export const executionStateLabel = (state: string) => executionState(state).label;

/** A recorded execution state as its status badge. */
export function ExecutionStateBadge({ state }: { state: string }) {
  const { kind, label } = executionState(state);
  return <StatusBadge kind={kind}>{label}</StatusBadge>;
}

/** Wall-clock time of a recorded observation, as the Figma timeline and blocks show it. */
export function clockTime(at: string) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/** "just now", then "12 min ago", "3 h ago" or "2 d ago", rounded down. */
export function timeAgo(at: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** "today 20:31" for today, otherwise "12 Oct 09:40". */
export function dayAndTime(at: string) {
  const date = new Date(at);
  const today = new Date().toDateString() === date.toDateString();
  const day = today ? "today" : date.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${day} ${clockTime(at)}`;
}
