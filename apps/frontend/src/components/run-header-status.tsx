import type { RunFreshness } from "../run-status.ts";
import { clockTime } from "../time-format.ts";
import { StatusBadge } from "./status-badge.tsx";

const statusClass = "flex min-w-0 shrink items-center gap-1.5 text-xs leading-4 whitespace-nowrap";

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
