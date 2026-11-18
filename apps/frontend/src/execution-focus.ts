import type { ContinuationVisit, RunBlock, RunThreadBinding } from "@t3-factory/contracts";

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
