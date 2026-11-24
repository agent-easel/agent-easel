import type { EffectiveExit } from "@agent-easel/domain-validation";
import { isSingleOutput } from "./block-kind.ts";
import type { CanvasBlock } from "./flow-graph.ts";

export function exitDisplayName(
  exit: Pick<EffectiveExit, "name" | "source">,
  singleOutputLabel = "",
) {
  if (isSingleOutput(exit)) return singleOutputLabel;
  return exit.name || (exit.source === "condition" ? "Unnamed output" : "Unnamed exit");
}

type LabelExit = Pick<CanvasBlock["exits"][number], "id" | "name" | "source" | "unavailable">;

export function studioExitLabel(exit: Pick<LabelExit, "name" | "source">) {
  const singleOutputLabel =
    exit.source === "wait"
      ? "after the wait"
      : exit.source === "continuation"
        ? "response"
        : "output";
  return exitDisplayName(exit, singleOutputLabel);
}

export function connectionLabel(exit: LabelExit): { text: string; struck: boolean };
export function connectionLabel(exit: LabelExit | null): { text: string; struck: boolean } | null;
export function connectionLabel(exit: LabelExit | null) {
  if (!exit) return null;
  return {
    text: exit.unavailable === "removed" ? exit.id : studioExitLabel(exit),
    struck: exit.unavailable !== undefined,
  };
}
