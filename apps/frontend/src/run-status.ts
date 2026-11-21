import type { RunDetail, RunNavigationEntry } from "@t3-factory/contracts";

/** Null for history that predates the corresponding lifecycle event. */
export function lifecycleAt(run: RunDetail, kind: "run-settled" | "run-archived") {
  return run.events.findLast((event) => event.kind === kind)?.observedAt ?? null;
}

export function stoppedVisitAt(run: RunDetail, end: string | null | undefined) {
  return end ?? lifecycleAt(run, run.lifecycle === "archived" ? "run-archived" : "run-settled");
}

export function waitsForWorkerConfirmation(run: RunNavigationEntry) {
  return (
    run.lifecycle === "active" &&
    run.settlement === null &&
    !run.attention.needsInput &&
    !run.attention.problem &&
    !run.pendingWork &&
    run.blocks.some((block) => block.state === "finished") &&
    run.blocks.every(
      ({ state }) => state === "not-started" || state === "finished" || state === "pass-through",
    )
  );
}

/**
 * Sidebar activity, never a Run status. A spinner while an Agent works, a pause while a Block
 * waits, and the neutral Idle ring when nothing is working or waiting — including a finished
 * Block whose handoff is still pending. Idle is the icon only.
 */
export type RunActivity = "settled" | "finished" | "stale" | "working" | "waiting" | "idle";

export function runActivity(run: RunNavigationEntry): RunActivity {
  if (run.lifecycle === "settled") return "settled";
  if (waitsForWorkerConfirmation(run)) return "finished";
  if (run.blocks.some((block) => block.state !== "not-started" && block.freshness !== "fresh"))
    return "stale";
  if (run.blocks.some((block) => block.state === "working" || block.state === "sent"))
    return "working";
  if (run.blocks.some((block) => block.state === "waiting")) return "waiting";
  return "idle";
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

export function runResultState(run: RunDetail) {
  if (run.result) return "reached";
  if (!run.definitions.flow.graph.finish?.endings.length) return "none";
  return run.lifecycle === "active" && run.gateOpen ? "not-yet" : "not-reached";
}
