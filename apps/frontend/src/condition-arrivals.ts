import type {
  ConditionArrivalEvidence,
  ConditionArrivalPage,
  RunDetail,
} from "@agent-easel/contracts";
import { exitDisplayName } from "./connection-label.ts";
import { capturedExits } from "./flow-graph.ts";

/** Arrival numbers and counts can reach 9,007,199,254,740,991, so they read with separators. */
export const countText = (value: number) => value.toLocaleString("en-US");

/** The name of the Condition output `outputId` in the Run's captured revision. */
export function conditionOutputName(run: RunDetail, blockId: string, outputId: string) {
  const exit = capturedExits(run.definitions, blockId).find((item) => item.id === outputId);
  return exit ? exitDisplayName(exit) : outputId;
}

/**
 * A Condition's routing so far, from the Run's summary: not visited before anything reached it,
 * then its arrival total and the latest selection, which is only the most recent route.
 */
export function conditionActivityText(run: RunDetail, blockId: string) {
  const summary = run.conditions.find((item) => item.blockId === blockId);
  if (!summary || (summary.arrivals === 0 && summary.pending === 0)) return "Not visited";
  const parts = [
    `${countText(summary.arrivals)} ${summary.arrivals === 1 ? "arrival" : "arrivals"}`,
  ];
  if (summary.pending) parts.push(`${countText(summary.pending)} waiting for a number`);
  if (summary.latest)
    parts.push(`latest → ${conditionOutputName(run, blockId, summary.latest.outputId)}`);
  return parts.join(" · ");
}

/**
 * The arrivals the inspector shows: pages of one window from the bounded read, in arrival order.
 * `request` names the only read whose answer may still change it, so an answer to a superseded
 * read (a Load more overtaken by a refresh) is dropped instead of mixing windows.
 */
export interface ArrivalWindow {
  readonly request: number;
  readonly loading: "first" | "more" | null;
  readonly arrivals: readonly ConditionArrivalEvidence[];
  /** The window's highest arrival number, fixed by its first page; null before one is read. */
  readonly highWater: number | null;
  readonly nextCursor: string | null;
  readonly error: { readonly message: string; readonly during: "first" | "more" } | null;
}

export type ArrivalWindowAction =
  | { readonly type: "requested"; readonly request: number; readonly page: "first" | "more" }
  | { readonly type: "loaded"; readonly request: number; readonly page: ConditionArrivalPage }
  | { readonly type: "failed"; readonly request: number; readonly message: string };

export const emptyArrivalWindow: ArrivalWindow = {
  request: 0,
  loading: null,
  arrivals: [],
  highWater: null,
  nextCursor: null,
  error: null,
};

export function arrivalWindowReducer(
  window: ArrivalWindow,
  action: ArrivalWindowAction,
): ArrivalWindow {
  if (action.type === "requested")
    return { ...window, request: action.request, loading: action.page, error: null };
  if (action.request !== window.request || !window.loading) return window;
  if (action.type === "failed")
    return { ...window, loading: null, error: { message: action.message, during: window.loading } };
  const { arrivals, highWater, nextCursor } = action.page;
  return {
    ...window,
    loading: null,
    // A first page opens a new window; a later page continues the current one.
    arrivals: window.loading === "first" ? arrivals : [...window.arrivals, ...arrivals],
    highWater: window.loading === "first" ? highWater : window.highWater,
    nextCursor,
  };
}

/** Arrivals numbered after the window was opened, which only a refresh shows. */
export function arrivalsAfterWindow(window: ArrivalWindow, arrivals: number) {
  return window.highWater === null ? 0 : Math.max(0, arrivals - window.highWater);
}
