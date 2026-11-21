import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ConditionArrivalEvidence, RunDetail } from "@t3-factory/contracts";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { api } from "../api.ts";
import {
  arrivalsAfterWindow,
  arrivalWindowReducer,
  conditionOutputName,
  countText,
  emptyArrivalWindow,
} from "../condition-arrivals.ts";
import { ExecutionStateBadge } from "./execution-state.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { blockName, deliveryRecipientName, deliveryWorker } from "../run-evidence.ts";
import { clockTime, dayAndTime } from "../time-format.ts";
import { sectionLabelClass } from "./page.tsx";

/** One window of the Condition's arrivals from the bounded read. The first page opens on its own
 * once an arrival exists; later arrivals wait for an explicit refresh. */
function useArrivalWindow(runId: string, blockId: string, open: boolean) {
  const [arrivalWindow, dispatch] = useReducer(arrivalWindowReducer, emptyArrivalWindow);
  const requests = useRef(0);
  const read = useCallback(
    (page: "first" | "more", cursor = "") => {
      const request = ++requests.current;
      dispatch({ type: "requested", request, page });
      api.listConditionArrivals(runId, blockId, "", cursor).then(
        (value) => dispatch({ type: "loaded", request, page: value }),
        (caught: unknown) =>
          dispatch({
            type: "failed",
            request,
            message:
              caught instanceof Error
                ? caught.message
                : "Could not read this Condition's arrivals.",
          }),
      );
    },
    [runId, blockId],
  );
  const unopened =
    arrivalWindow.highWater === null && !arrivalWindow.loading && !arrivalWindow.error;
  useEffect(() => {
    if (unopened && open) read("first");
  }, [unopened, open, read]);
  return { arrivalWindow, read };
}

/** Where the arrival came from: the delivering block and the worker whose message it carries. */
function provenance(run: RunDetail, arrival: ConditionArrivalEvidence) {
  const source = arrival.sourceBlockId ? blockName(run, arrival.sourceBlockId) : "unknown block";
  const worker = arrival.origin && deliveryWorker(run, arrival.origin);
  const from = arrival.subflowReturn ? `${source} → ${arrival.subflowReturn.endingName}` : source;
  return `From ${from} · worker ${worker ? blockName(run, worker.blockId) : "unknown"}`;
}

const monoClass = "font-mono text-foreground";

function ArrivalItem({
  run,
  blockId,
  arrival,
}: {
  run: RunDetail;
  blockId: string;
  arrival: ConditionArrivalEvidence;
}) {
  const number = countText(arrival.arrivalNumber);
  const output = conditionOutputName(run, blockId, arrival.outputId);
  const ends = arrival.recipients.length === 0;
  return (
    <Surface tone="inset" asChild className="flex flex-col gap-1.5 px-3 py-2">
      <li aria-label={`Arrival ${number}, ${output}${ends ? ", ends here" : ""}`}>
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium">Arrival {number}</p>
          <time
            dateTime={arrival.acceptedAt}
            className="shrink-0 text-2xs tracking-label text-subtle-foreground"
          >
            accepted {dayAndTime(arrival.acceptedAt)}
          </time>
        </div>
        <p className="text-xs break-words text-muted-foreground">
          {arrival.rule ? (
            <>
              Matched rule{" "}
              <span className={monoClass}>{arrival.rule.name || "Unnamed output"}</span>
            </>
          ) : (
            <>No rule matched</>
          )}{" "}
          · selected <span className={monoClass}>{output}</span>
        </p>
        <p className="text-xs break-words text-subtle-foreground">{provenance(run, arrival)}</p>
        {ends ? (
          <p className="text-xs text-muted-foreground">
            Output not connected · this arrival ends here
          </p>
        ) : (
          <ul aria-label={`Arrival ${number} recipients`} className="flex flex-col gap-1">
            {arrival.recipients.map((recipient) => (
              <li
                key={JSON.stringify([recipient.blockId, recipient.targetEndingId])}
                className="flex items-center gap-2 text-xs"
              >
                <span className="min-w-0 flex-1 break-words text-foreground">
                  → {deliveryRecipientName(run, recipient)}
                </span>
                <ExecutionStateBadge state={recipient.disposition} />
              </li>
            ))}
          </ul>
        )}
      </li>
    </Surface>
  );
}

function UnvisitedCondition({ visible }: { visible: boolean }) {
  return visible ? (
    <p className="px-2 text-xs text-muted-foreground">Not visited · no arrival numbered yet.</p>
  ) : null;
}

function useConditionWindow(run: RunDetail, blockId: string, liveArrivals: number | undefined) {
  const runtime = run.blocks.find((block) => block.blockId === blockId);
  const { arrivalWindow, read } = useArrivalWindow(
    run.id,
    blockId,
    !!liveArrivals || !!runtime?.invocationId,
  );
  const arrivals = liveArrivals ?? arrivalWindow.highWater ?? 0;
  return { arrivalWindow, read, arrivals };
}

/**
 * A Condition's numbered arrivals in ascending order, read a page at a time within one window.
 * The live summary only counts arrivals; when it shows one after the window, the list offers a
 * refresh instead of mixing windows.
 */
export function ConditionArrivals({ run, blockId }: { run: RunDetail; blockId: string }) {
  const summary = run.conditions.find((item) => item.blockId === blockId);
  const { arrivalWindow, read, arrivals } = useConditionWindow(run, blockId, summary?.arrivals);
  const newer = arrivalsAfterWindow(arrivalWindow, arrivals);
  const latest = summary?.latest;
  return (
    <section className="flex flex-col gap-2" aria-label="Condition arrivals">
      <div className="flex items-center gap-2 px-2">
        <h3 className={cn(sectionLabelClass, "min-w-0 flex-1")}>
          Arrivals · {countText(arrivals)}
        </h3>
        {arrivalWindow.highWater !== null && (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={!!arrivalWindow.loading}
            onClick={() => read("first")}
          >
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        )}
      </div>
      {latest ? (
        <p className="px-2 text-xs text-muted-foreground">
          Latest selection: arrival {countText(latest.arrivalNumber)} →{" "}
          <span className={monoClass}>{conditionOutputName(run, blockId, latest.outputId)}</span> ·{" "}
          {clockTime(latest.acceptedAt)}. It is only the most recent route, not all downstream work.
        </p>
      ) : (
        <UnvisitedCondition visible={arrivals === 0 && !arrivalWindow.loading} />
      )}
      {!!summary?.pending && (
        <p className="px-2 text-xs text-muted-foreground">
          {countText(summary.pending)} waiting for an arrival number, not listed yet.
        </p>
      )}
      {newer > 0 && (
        <ProblemCard
          tone="info"
          density="compact"
          title={`${countText(newer)} newer ${newer === 1 ? "arrival" : "arrivals"} since this list was read`}
        >
          Refresh to read the list again with {newer === 1 ? "it" : "them"}.
        </ProblemCard>
      )}
      {arrivalWindow.arrivals.length > 0 && (
        <>
          <p className="px-2 text-xs text-subtle-foreground">
            A selection records the route only. Each recipient shows its delivery as pending,
            acknowledged or cancelled when its page was read.
          </p>
          <ol className="flex flex-col gap-1.5" aria-label="Arrivals in order">
            {arrivalWindow.arrivals.map((arrival) => (
              <ArrivalItem key={arrival.id} run={run} blockId={blockId} arrival={arrival} />
            ))}
          </ol>
        </>
      )}
      {arrivalWindow.loading && (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          Reading arrivals…
        </p>
      )}
      {arrivalWindow.error && (
        <ProblemCard
          tone="error"
          density="compact"
          title={arrivalWindow.error.message}
          action={
            <span className="flex gap-2">
              {arrivalWindow.error.during === "more" && (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => read("more", arrivalWindow.nextCursor ?? "")}
                >
                  Try again
                </Button>
              )}
              <Button type="button" size="xs" variant="outline" onClick={() => read("first")}>
                {arrivalWindow.error.during === "more" ? "Refresh from arrival 1" : "Try again"}
              </Button>
            </span>
          }
        />
      )}
      {arrivalWindow.nextCursor && (
        <div className="flex items-center gap-2 px-2">
          <p className="min-w-0 flex-1 text-xs text-subtle-foreground">
            {countText(arrivalWindow.arrivals.length)} of {countText(arrivalWindow.highWater ?? 0)}{" "}
            shown
          </p>
          {!arrivalWindow.loading && !arrivalWindow.error && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => read("more", arrivalWindow.nextCursor ?? "")}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
