import type { RunBlock, RunDetail } from "@t3-factory/contracts";

const activeStates = new Set<RunBlock["state"]>(["working", "waiting", "sent"]);

/**
 * What the Run header still states: a Settled or Archived lifecycle, or Idle for an Active Run with
 * no active Block and nothing pending. Work states live on the Run's sidebar row and its Blocks.
 */
export type RunHeaderStatus =
  /** `at` is null for Runs settled or archived by an upgrade, which recorded no such event. */
  { readonly kind: "archived" | "settled"; readonly at: string | null } | { readonly kind: "idle" };

/** When the Run last entered `kind`. */
function lifecycleAt(run: RunDetail, kind: "run-settled" | "run-archived") {
  return run.events.findLast((event) => event.kind === kind)?.observedAt ?? null;
}

/** Archived, then Settled; Idle only when no Block works or waits and nothing is pending. */
export function runHeaderStatus(run: RunDetail): RunHeaderStatus | null {
  if (run.lifecycle === "archived")
    return { kind: "archived", at: lifecycleAt(run, "run-archived") };
  if (run.lifecycle === "settled") return { kind: "settled", at: lifecycleAt(run, "run-settled") };
  if (run.attention.some((item) => !item.settledAt)) return null;
  if (run.blocks.some((block) => activeStates.has(block.state))) return null;
  return { kind: "idle" };
}

/**
 * Whether the screen shows what Factory observes now. An Active Run is Not live while its live
 * delivery is unavailable or any block that ran has a stale observation; `lastObservedAt` is the
 * latest observation of those blocks or the Run coordinator.
 */
export type RunFreshness =
  | { readonly live: true }
  | { readonly live: false; readonly lastObservedAt: string | null };

export function runFreshness(run: RunDetail, observationsUnavailable: boolean): RunFreshness {
  // Factory no longer observes a Settled or Archived Run, so its last facts are its history.
  if (run.lifecycle !== "active") return { live: true };
  const started = run.blocks.filter((block) => block.state !== "not-started");
  const stale = started.some((block) => block.freshness === "stale");
  if (!observationsUnavailable && !stale) return { live: true };
  const lastObservedAt =
    started
      .map((block) => block.observedAt)
      .concat(run.runCoordinator?.observedAt ?? null)
      .filter((at): at is string => !!at)
      .sort()
      .at(-1) ?? null;
  return { live: false, lastObservedAt };
}
