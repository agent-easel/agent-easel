import {
  attentionPresentation,
  type RunAttention,
  type RunBlock,
  type RunDetail,
} from "@t3-factory/contracts";

/** The one Run-level status the Run header shows; block states stay on the canvas. */
export type RunStatus =
  /** `at` is null for Runs settled or archived by an upgrade, which recorded no such event. */
  | { readonly kind: "archived" | "settled"; readonly at: string | null }
  | { readonly kind: "problem" | "needs-input" | "working"; readonly blocks: readonly string[] }
  | { readonly kind: "idle" };

/** Active blocks; a `sent` Continuation's work already shows on its `working` Agent. */
const activeStates = new Set<RunBlock["state"]>(["working", "waiting"]);

/** The blocks `items` are about; a Run-level settlement Problem is about the workers its
 * settlement could not resolve. */
function blockNames(run: RunDetail, items: readonly RunAttention[]) {
  const ids = new Set(items.map((item) => item.blockId));
  const blocked = items.some((item) => item.kind === "settlement-unresolved")
    ? (run.settlement?.workers ?? []).filter((worker) => worker.state === "unresolved")
    : [];
  const names = run.blocks.filter((block) => ids.has(block.blockId)).map((block) => block.name);
  return [...new Set([...names, ...blocked.map((worker) => worker.blockName)])];
}

/** When the Run last entered `kind`. */
function lifecycleAt(run: RunDetail, kind: "run-settled" | "run-archived") {
  return run.events.findLast((event) => event.kind === kind)?.observedAt ?? null;
}

/**
 * Lifecycle first (Archived, then Settled), then Problem before Needs input, then any active
 * block, then idle.
 */
export function runStatus(run: RunDetail): RunStatus {
  if (run.lifecycle === "archived")
    return { kind: "archived", at: lifecycleAt(run, "run-archived") };
  if (run.lifecycle === "settled") return { kind: "settled", at: lifecycleAt(run, "run-settled") };
  const pending = run.attention.filter((item) => !item.settledAt);
  const problems = pending.filter((item) => attentionPresentation(item.kind) === "problem");
  if (problems.length)
    return {
      kind: "problem",
      blocks: blockNames(run, problems),
    };
  // As in Run navigation: a confirmed Settle answers nothing, so its questions no longer ask.
  const questions = run.settlement
    ? []
    : pending.filter((item) => attentionPresentation(item.kind) === "needs-input");
  if (questions.length)
    return {
      kind: "needs-input",
      blocks: blockNames(run, questions),
    };
  const active = run.blocks.filter((block) => activeStates.has(block.state));
  if (active.length) return { kind: "working", blocks: active.map((block) => block.name) };
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
