import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ConditionArrivalEvidence, RunDetail } from "@t3-factory/contracts";
import { RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../api.ts";
import {
  arrivalsAfterWindow,
  arrivalWindowReducer,
  conditionOutputName,
  countText,
  emptyArrivalWindow,
} from "../condition-arrivals.ts";
import { clockTime, dayAndTime, StatePill } from "./execution-state.tsx";
import { sectionLabelClass } from "./page.tsx";

/** One window of the Condition's arrivals from the bounded read. The first page opens on its own
 * once an arrival exists; later arrivals wait for an explicit refresh. */
function useArrivalWindow(runId: string, blockId: string, arrivals: number) {
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
    if (unopened && arrivals > 0) read("first");
  }, [unopened, arrivals, read]);
  return { arrivalWindow, read };
}

function blockName(run: RunDetail, blockId: string) {
  return run.definitions.flow.graph.blocks.find((block) => block.id === blockId)?.name || blockId;
}

/** Where the arrival came from: the delivering block and the worker whose message it carries. */
function provenance(run: RunDetail, arrival: ConditionArrivalEvidence) {
  const source = arrival.sourceBlockId ? blockName(run, arrival.sourceBlockId) : "unknown block";
  const activation = run.activations.find((item) => item.id === arrival.origin?.activationId);
  const worker = activation ? blockName(run, activation.blockId) : "unknown";
  return `From ${source} · worker ${worker}`;
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
    <li
      aria-label={`Arrival ${number}, ${output}${ends ? ", ends here" : ""}`}
      className="flex flex-col gap-1.5 rounded-md border bg-muted px-3 py-2"
    >
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
            Matched rule <span className={monoClass}>{arrival.rule.name || "Unnamed output"}</span>
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
            <li key={recipient.blockId} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-foreground">
                → {blockName(run, recipient.blockId)}
              </span>
              <StatePill state={recipient.disposition} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * A Condition's numbered arrivals in ascending order, read a page at a time within one window.
 * The live summary only counts arrivals; when it shows one after the window, the list offers a
 * refresh instead of mixing windows.
 */
export function ConditionArrivals({ run, blockId }: { run: RunDetail; blockId: string }) {
  const summary = run.conditions.find((item) => item.blockId === blockId);
  const arrivals = summary?.arrivals ?? 0;
  const { arrivalWindow, read } = useArrivalWindow(run.id, blockId, arrivals);
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
        <p className="px-2 text-xs text-muted-foreground">Not visited · no arrival numbered yet.</p>
      )}
      {!!summary?.pending && (
        <p className="px-2 text-xs text-muted-foreground">
          {countText(summary.pending)} waiting for an arrival number, not listed yet.
        </p>
      )}
      {newer > 0 && (
        <Alert variant="info" role="status" className="px-3 py-2">
          <AlertDescription>
            <p className="text-xs">
              {countText(newer)} newer {newer === 1 ? "arrival" : "arrivals"} since this list was
              read. Refresh to read the list again with {newer === 1 ? "it" : "them"}.
            </p>
          </AlertDescription>
        </Alert>
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
        <Alert variant="destructive" className="px-3 py-2">
          <AlertDescription className="flex w-full flex-col gap-1.5">
            <p className="text-xs">{arrivalWindow.error.message}</p>
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
          </AlertDescription>
        </Alert>
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
