import type { ComponentProps } from "react";
import type { RunFreshness, RunStatus } from "../run-status.ts";
import { clockTime, dayAndTime } from "./execution-state.tsx";
import { StatusBadge } from "./status-badge.tsx";

const statusClass = "flex min-w-0 shrink items-center gap-1.5 text-xs leading-4 whitespace-nowrap";

const badges = {
  working: { kind: "working" },
  "needs-input": { kind: "needs-input" },
  problem: { kind: "problem" },
  settled: { kind: "finished", children: "Settled" },
  archived: { kind: "stopped", children: "Archived" },
  idle: { kind: "neutral", children: "Idle" },
} as const satisfies Record<RunStatus["kind"], ComponentProps<typeof StatusBadge>>;

function statusDetail(status: RunStatus) {
  if (status.kind === "idle") return null;
  if ("at" in status) return status.at ? dayAndTime(status.at) : null;
  return status.blocks.join(", ") || null;
}

/** The one Run status in the Run header: its badge, then what it is about. */
export function RunHeaderStatus({ status }: { status: RunStatus }) {
  const detail = statusDetail(status);
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
