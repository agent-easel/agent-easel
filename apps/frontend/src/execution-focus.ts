import type {
  ContinuationVisit,
  RunBlock,
  RunDetail,
  RunThreadBinding,
} from "@t3-factory/contracts";

/**
 * Empty targets mean no active work. Active work takes precedence over failure. A `sent`
 * Continuation is a target while its prompt is worked on, in place of the Agent whose thread
 * works on it; once it has passed its response on, the focus moves to the next active Block.
 */
export function selectExecutionTargets(run: {
  readonly blocks: readonly Pick<RunBlock, "blockId" | "state">[];
  readonly continuationVisits: readonly Pick<ContinuationVisit, "blockId" | "kind" | "bindingId">[];
  readonly threadBindings: readonly Pick<RunThreadBinding, "id" | "blockId">[];
}): string[] {
  const sent = new Set(
    run.blocks.filter((block) => block.state === "sent").map((block) => block.blockId),
  );
  const owners = new Set(
    run.continuationVisits
      .filter((visit) => visit.kind === "prompt" && sent.has(visit.blockId))
      .map(
        (visit) => run.threadBindings.find((binding) => binding.id === visit.bindingId)?.blockId,
      ),
  );
  const active = run.blocks.filter(
    (block) =>
      block.state === "sent" ||
      ((block.state === "working" || block.state === "waiting") && !owners.has(block.blockId)),
  );
  const targets = active.length ? active : run.blocks.filter((block) => block.state === "error");
  return targets.map((block) => block.blockId);
}

/** Events that end a finished or stopped visit. A later observation or attention resolution on
 * an already finished Block is not another visit. */
const VISIT_ENDS = new Set([
  "report-accepted",
  "human-answered",
  "human-cancelled",
  "wait-forwarded",
  "wait-continued",
  "wait-cancelled",
  "continuation-forwarded",
  "continuation-passed",
  "condition-selected",
  "worker-stopped",
]);

/** The latest recorded visit is an entry target only. It does not resume following. */
export function selectEntryTargets(run: RunDetail, targets: readonly string[]): readonly string[] {
  if (
    targets.some((id) =>
      run.blocks.some((block) => block.blockId === id && block.state !== "error"),
    )
  )
    return targets;
  const terminal = new Set(
    run.blocks
      .filter(
        ({ state }) => state === "finished" || state === "pass-through" || state === "stopped",
      )
      .map(({ blockId }) => blockId),
  );
  const latest = run.events.findLast(
    (event) => event.blockId && terminal.has(event.blockId) && VISIT_ENDS.has(event.kind),
  );
  return latest?.blockId ? [latest.blockId] : targets;
}

export type AutoFollowAction = "animate" | "jump" | "indicate" | "nothing";

/** Hidden canvases never move; `returned` is the first evaluation after the canvas is shown again. */
export function decideAutoFollow(input: {
  /** Targets the view last followed or indicated. */
  seen: readonly string[];
  targets: readonly string[];
  following: boolean;
  visibility: "visible" | "hidden" | "returned";
  reducedMotion: boolean;
}): AutoFollowAction {
  if (!input.targets.length) return "nothing";
  if (input.following && input.visibility === "returned") return "jump";
  if (sameTargets(input.seen, input.targets)) return "nothing";
  if (!input.following) return "indicate";
  if (input.visibility === "hidden") return "nothing";
  return input.reducedMotion ? "jump" : "animate";
}

function sameTargets(left: readonly string[], right: readonly string[]) {
  const known = new Set(left);
  return left.length === right.length && right.every((id) => known.has(id));
}
