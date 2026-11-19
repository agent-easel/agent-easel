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
