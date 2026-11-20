import type { ReactNode } from "react";
import { Flag } from "lucide-react";
import type { FlowEnding } from "@t3-factory/contracts";
import { cn } from "@/lib/utils";

export type FinishBlockState =
  | { readonly kind: "authoring"; readonly unconnected: ReadonlySet<string> }
  | { readonly kind: "pending" }
  | { readonly kind: "reached"; readonly endingId: string; readonly time: string }
  | { readonly kind: "none-reached" };

export function finishShowsRows(state: FinishBlockState, endings: number) {
  return endings > 0 || state.kind === "authoring";
}

function finishSummary(state: FinishBlockState, endings: number) {
  if (endings === 0) return "No endings";
  if (state.kind === "none-reached") return "No ending reached";
  return endings === 1 ? "1 ending" : `${endings} endings`;
}

export function finishIdentity(state: FinishBlockState, endings: number, trailing?: ReactNode) {
  return {
    header: (
      <span className="flex flex-1 items-center gap-1.5 pt-1.5 pr-2 pl-3">
        <Flag aria-hidden className="size-3 text-muted-foreground" />
        <span className="text-2xs font-semibold tracking-section text-muted-foreground">
          FINISH
        </span>
        <span className="flex-1" />
        {trailing}
      </span>
    ),
    title: (
      <span className="flex flex-1 flex-col gap-1 px-3 pt-0.5">
        <span className="truncate text-sm font-semibold text-foreground">Finish</span>
        <span className="truncate text-2xs tracking-label text-muted-foreground">
          {finishSummary(state, endings)}
        </span>
      </span>
    ),
  };
}

export function finishRowClass(state: FinishBlockState, ending: FlowEnding) {
  return cn(state.kind === "reached" && state.endingId === ending.id && "bg-muted");
}

export function FinishEndingRow({
  ending,
  state,
}: {
  ending: FlowEnding;
  state: FinishBlockState;
}) {
  const name = ending.name || "Unnamed ending";
  const reached = state.kind === "reached" && state.endingId === ending.id;
  const unconnected = state.kind === "authoring" && state.unconnected.has(ending.id);
  return (
    <>
      <span
        className={cn(
          "truncate text-xs font-medium text-muted-foreground",
          reached && "font-semibold text-foreground",
          unconnected && "text-destructive",
        )}
      >
        {name}
      </span>
      <span className="flex-1" />
      {state.kind === "reached" &&
        (reached ? (
          <span className="shrink-0 text-2xs font-medium text-foreground">
            Reached · {state.time}
          </span>
        ) : (
          <span className="shrink-0 text-2xs text-muted-foreground">Not reached</span>
        ))}
      {unconnected && <span className="sr-only">Not connected</span>}
    </>
  );
}

export function FinishHint() {
  return (
    <span className="truncate text-xs font-medium text-muted-foreground">
      Add endings in its settings
    </span>
  );
}
