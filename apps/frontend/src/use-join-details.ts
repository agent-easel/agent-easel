import { useEffect, useRef, useState } from "react";
import type { JoinDetail, JoinSummary } from "@agent-easel/contracts";
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
  const signature = JSON.stringify(
    summaries
      .filter((summary) => summary.arrived > 0 || summary.latest)
      .map((summary) => [summary.blockId, JSON.stringify([runId, joinDetailKey(summary)])]),
  );
  useEffect(() => {
    let current = true;
    const requests = requested.current;
    const inFlight = new Set<string>();
    for (const [blockId, key] of JSON.parse(signature) as [string, string][]) {
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
          if (!current) return;
          requests.delete(blockId);

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
