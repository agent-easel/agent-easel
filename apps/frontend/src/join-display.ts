import type { JoinDetail, JoinSummary, RunDetail } from "@t3-factory/contracts";
import { clockTime } from "./time-format.ts";

export const joinSummaryOf = (run: RunDetail, blockId: string) =>
  run.joins.find((join) => join.blockId === blockId);

type JoinPhase = "not-started" | "waiting" | "forwarded" | "cancelled";

function joinPhase(summary: JoinSummary | undefined): JoinPhase {
  if (!summary) return "not-started";
  if (summary.arrived > 0) return "waiting";
  return summary.latest?.outcome ?? "not-started";
}

const sourceCount = (sources: number) => (sources === 1 ? "1 source" : `${sources} sources`);

export function joinReferenceText(summary: JoinSummary | undefined, sources: number) {
  const phase = joinPhase(summary);
  if (!summary || phase === "not-started") return `Join · ${sourceCount(sources)}`;
  if (phase === "waiting" || !summary.latest) return `Join · round ${summary.round}`;
  const { round, outcome, at } = summary.latest;
  return outcome === "forwarded"
    ? `Join · round ${round} forwarded ${clockTime(at)}`
    : `Join · round ${round} cancelled`;
}

export function joinActivityText(summary: JoinSummary | undefined, recipients: readonly string[]) {
  const phase = joinPhase(summary);
  if (!summary || phase === "not-started") return "Not visited";
  if (phase === "waiting") return `Waiting · ${summary.arrived}/${summary.sources} sources`;
  if (phase === "forwarded")
    return recipients.length ? `Passed on to ${recipients.join(", ")}` : "Passed on";
  return `Cancelled · ${clockTime(summary.latest!.at)}`;
}

export const isCancelledJoin = (summary: JoinSummary | undefined) =>
  joinPhase(summary) === "cancelled";

export function joinSourceText(
  summary: JoinSummary | undefined,
  detail: JoinDetail | null | undefined,
  slot: number,
) {
  const phase = joinPhase(summary);
  if (phase === "not-started") return "—";
  const source = detail?.sources[slot];
  if (!source) return "";
  if (phase === "waiting")
    return source.arrived
      ? `${source.arrived.exitName}${source.queued ? ` +${source.queued}` : ""}`
      : "pending";
  return source.latestArrival?.exitName ?? "pending";
}

export const joinDetailKey = (summary: JoinSummary) =>
  [summary.round, summary.arrived, summary.queued, summary.latest?.round, summary.latest?.outcome]
    .map(String)
    .join(":");
