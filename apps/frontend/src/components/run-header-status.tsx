import type { ComponentProps } from "react";
import type { RunFreshness, RunHeaderStatus as HeaderStatus } from "../run-status.ts";
import { clockTime, dayAndTime } from "./execution-state.tsx";
import { StatusBadge } from "./status-badge.tsx";

const statusClass = "flex min-w-0 shrink items-center gap-1.5 text-xs leading-4 whitespace-nowrap";

const badges = {
  settled: { kind: "finished", children: "Settled" },
  archived: { kind: "stopped", children: "Archived" },
  idle: { kind: "neutral", children: "Idle" },
} as const satisfies Record<HeaderStatus["kind"], ComponentProps<typeof StatusBadge>>;

/** A Settled or Archived Run's lifecycle with its time, or Idle; an Active Run's work states stay
 * on its row and Blocks. */
export function RunHeaderStatus({ status }: { status: HeaderStatus | null }) {
  if (!status) return null;
  const detail = status.kind !== "idle" && status.at ? dayAndTime(status.at) : null;
  return (
    <span role="status" aria-label="Run status" className={statusClass}>
      <StatusBadge {...badges[status.kind]} />
      {detail && <span className="truncate text-muted-foreground">· {detail}</span>}
    </span>
  );
}

/** Shown only while the screen may be out of date, with Factory's latest observation. */
export function NotLiveMarker({ freshness }: { freshness: RunFreshness }) {
  if (freshness.live) return null;
  return (
    <span role="status" aria-label="Observation freshness" className={statusClass}>
      <StatusBadge kind="attention">Not live</StatusBadge>
      <span className="text-muted-foreground">
        ·{" "}
        {freshness.lastObservedAt
          ? `last observed ${clockTime(freshness.lastObservedAt)}`
          : "not yet observed"}
      </span>
    </span>
  );
}
