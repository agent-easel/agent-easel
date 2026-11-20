import type { ReactNode } from "react";
import { Flag } from "lucide-react";
import type { FlowEnding } from "@t3-factory/contracts";
import { cn } from "@/lib/utils";

/**
 * What the Finish block shows (Figma Studio/FinishBlock). `authoring` is the Flow editor, where
 * an unconnected ending reads in the error colour. A Run's Finish block is `pending` while no
 * ending is reached (endings stay neutral), then `reached` with the ending and its time, or
 * `none-reached` once the Run ended without one.
 */
export type FinishBlockState =
  | { readonly kind: "authoring"; readonly unconnected: ReadonlySet<string> }
  | { readonly kind: "pending" }
  | { readonly kind: "reached"; readonly endingId: string; readonly time: string }
  | { readonly kind: "none-reached" };

/** Whether the block draws its ending rows: every state with endings, and the authoring hint
 * without any. A Run's Finish block without endings is its header only. */
export function finishShowsRows(state: FinishBlockState, endings: number) {
  return endings > 0 || state.kind === "authoring";
}

function finishSummary(state: FinishBlockState, endings: number) {
  if (endings === 0) return "No endings";
  if (state.kind === "none-reached") return "No ending reached";
  return endings === 1 ? "1 ending" : `${endings} endings`;
}

/** The Finish block's header and title rows: the Flag kind icon, FINISH, Finish and a summary. */
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

/** The row class of one ending; the reached ending is filled. */
export function finishRowClass(state: FinishBlockState, ending: FlowEnding) {
  return cn(state.kind === "reached" && state.endingId === ending.id && "bg-muted");
}

/** One ending row: its name, and in a Run with a reached ending whether this one was reached. */
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

/** The one row of an authoring Finish block without endings. */
export function FinishHint() {
  return (
    <span className="truncate text-xs font-medium text-muted-foreground">
      Add endings in its settings
    </span>
  );
}
