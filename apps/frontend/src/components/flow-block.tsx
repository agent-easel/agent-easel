import type { ReactNode } from "react";
import { TextCursorInput } from "lucide-react";
import type { FlowBlock } from "@t3-factory/contracts";
import type { EffectiveExit } from "@t3-factory/domain-validation";
import { cn } from "@/lib/utils";
import { BLOCK_KINDS, isSingleOutput } from "../block-kind.ts";

const KIND_ICON_COLORS: Record<FlowBlock["kind"], string> = {
  agent: "text-link",
  human: "text-muted-foreground",
  wait: "text-muted-foreground",
  continuation: "text-brand-cyan",
  condition: "text-muted-foreground",
};

/** An exit's name as rows show it; a Wait's or Continuation's single output has none, so it shows
 * `singleOutputLabel`. */
export function exitDisplayName(
  exit: Pick<EffectiveExit, "name" | "source">,
  singleOutputLabel = "",
) {
  if (isSingleOutput(exit)) return singleOutputLabel;
  return exit.name || (exit.source === "condition" ? "Unnamed output" : "Unnamed exit");
}

/**
 * When a Condition output is selected, as its canvas row reads before the output name: from its
 * rule's arrival onward, or Otherwise's fallback.
 */
export function conditionRoute(block: FlowBlock, exitId: string) {
  const rule = block.kind === "condition" && block.rules.find((item) => item.id === exitId);
  if (!rule) return "when no rule matches";
  return rule.fromArrival === null
    ? "no arrival number yet"
    : `from arrival ${rule.fromArrival.toLocaleString("en-US")} onward`;
}

/** The content of an authoring block's header and title rows: kind, name and what it runs. */
export function blockIdentity({
  kind,
  name,
  label,
  value,
  valueClassName = "text-emphasis-foreground",
  trailing,
}: {
  kind: FlowBlock["kind"];
  name: string;
  label: string;
  value: string;
  valueClassName?: string;
  trailing?: ReactNode;
}) {
  const { Icon, label: kindLabel } = BLOCK_KINDS[kind];
  return {
    header: (
      <span className="flex flex-1 items-center gap-1.5 pt-1.5 pr-2 pl-3">
        <Icon aria-hidden className={cn("size-3", KIND_ICON_COLORS[kind])} />
        <span className="text-2xs font-semibold tracking-section text-muted-foreground">
          {kindLabel}
        </span>
        <span className="flex-1" />
        {trailing}
      </span>
    ),
    title: (
      <span className="flex flex-1 flex-col gap-1 px-3 pt-0.5">
        <span className="truncate text-sm font-semibold text-foreground">{name}</span>
        <span className="flex min-w-0 gap-1.5 text-2xs tracking-label">
          {label && <span className="text-muted-foreground">{label}</span>}
          <span className={cn("truncate", valueClassName)}>{value}</span>
        </span>
      </span>
    ),
  };
}

/** The content of the Flow input block's header and title rows on either canvas. */
export function flowInputIdentity(trailing: ReactNode) {
  return {
    header: (
      <span className="flex flex-1 items-center gap-1.5 pt-1.5 pr-2 pl-3">
        <TextCursorInput aria-hidden className="size-3 text-link" />
        <span className="text-2xs font-semibold tracking-section text-muted-foreground">
          FLOW INPUT
        </span>
        <span className="flex-1" />
        {trailing}
      </span>
    ),
    title: (
      <span className="flex flex-1 flex-col gap-1 px-3 pt-0.5">
        <span className="truncate text-sm font-semibold text-foreground">Flow input</span>
        <span className="truncate text-2xs tracking-label text-muted-foreground">Run prompt</span>
      </span>
    ),
  };
}
