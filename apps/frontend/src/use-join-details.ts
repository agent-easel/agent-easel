import { useEffect, useRef, useState } from "react";
import type { JoinDetail, JoinSummary } from "@t3-factory/contracts";
import { api } from "./api.ts";
import { joinDetailKey } from "./join-display.ts";

type JoinRead =
  | { readonly key: string; readonly detail: JoinDetail; readonly error: null }
  | { readonly key: string; readonly detail: JoinDetail | null; readonly error: string };

export type JoinReads = ReadonlyMap<string, JoinRead>;

const readMessage = (caught: unknown) =>
  caught instanceof Error ? caught.message : "Could not read this Join's sources.";

export function useJoinDetails(runId: string, summaries: readonly JoinSummary[]): JoinReads {
  const [reads, setReads] = useState<JoinReads>(new Map());
  const requested = useRef(new Map<string, string>());
  const signature = summaries
    .filter((summary) => summary.arrived > 0 || summary.latest)
    .map((summary) => `${summary.blockId}=${runId}:${joinDetailKey(summary)}`)
    .join(",");
  useEffect(() => {
    let current = true;
    const requests = requested.current;
    const inFlight = new Set<string>();
    for (const entry of signature ? signature.split(",") : []) {
      const [blockId = "", key = ""] = entry.split("=");
      if (requests.get(blockId) === key) continue;
      requests.set(blockId, key);
      inFlight.add(blockId);
      api.getRunJoin(runId, blockId).then(
        (detail) => {
          inFlight.delete(blockId);
          if (current)
            setReads((previous) => new Map(previous).set(blockId, { key, detail, error: null }));
        },
        (caught: unknown) => {
          inFlight.delete(blockId);
          requests.delete(blockId);
          if (current)
            setReads((previous) =>
              new Map(previous).set(blockId, {
                key,
                detail: previous.get(blockId)?.detail ?? null,
                error: readMessage(caught),
              }),
            );
        },
      );
    }
    return () => {
      current = false;
      for (const blockId of inFlight) requests.delete(blockId);
    };
  }, [runId, signature]);
  return reads;
}
