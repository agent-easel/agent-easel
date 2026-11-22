import type {
  FlowBlock,
  JoinDetail,
  JoinSourceDetail,
  JoinSummary,
  RunDetail,
} from "@t3-factory/contracts";
import { Surface } from "@/components/ui/surface";
import { blockExitRecipients } from "../flow-graph.ts";
import { joinSummaryOf } from "../join-display.ts";
import { clockTime } from "../time-format.ts";
import { useJoinDetails } from "../use-join-details.ts";
import { joinSources } from "./join-block.tsx";
import { DetailRow, InspectorSection } from "./inspector-section.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { StatusBadge } from "./status-badge.tsx";

type JoinBlock = Extract<FlowBlock, { kind: "join" }>;

const earliest = (times: readonly string[]) => times.toSorted()[0];

function roundText(summary: JoinSummary | undefined, detail: JoinDetail | null | undefined) {
  if (!summary || (summary.arrived === 0 && !summary.latest)) return "1 · not started";
  if (summary.arrived > 0) {
    const since = earliest(
      detail?.sources.flatMap((source) => (source.arrived ? [source.arrived.arrivedAt] : [])) ?? [],
    );
    return `${summary.round} · waiting${since ? ` since ${clockTime(since)}` : ""}`;
  }
  const latest = summary.latest!;
  return latest.outcome === "cancelled"
    ? `${latest.round} · cancelled ${clockTime(latest.at)}`
    : `${summary.round} · no source yet`;
}

function sourcesText(
  summary: JoinSummary | undefined,
  detail: JoinDetail | null | undefined,
  captured: number,
) {
  if (summary && summary.arrived === 0 && summary.latest?.outcome === "cancelled") {
    const collected = detail?.sources.filter((source) => source.latestArrival).length;
    return collected === undefined
      ? "cancelled before every source arrived"
      : `${collected}/${summary.sources} had arrived`;
  }
  return `${summary?.arrived ?? 0}/${summary?.sources ?? captured} arrived`;
}

function heldFor(round: number, queued: number) {
  return queued === 1
    ? `held for round ${round + 1}`
    : `held for rounds ${round + 1}–${round + queued}`;
}

function queuedText(summary: JoinSummary | undefined, detail: JoinDetail | null | undefined) {
  if (!summary?.queued) return "none";
  const sources = detail?.sources.filter((source) => source.queued > 0) ?? [];
  if (!sources.length) return String(summary.queued);
  return sources
    .map((source) => `${source.name} +${source.queued} · ${heldFor(summary.round, source.queued)}`)
    .join(", ");
}

type SourceState = {
  readonly status: "arrived" | "pending" | "not arrived";
  readonly line: string;
  readonly badge: { readonly kind: "finished" | "working" | "stopped"; readonly label: string };
};

function pendingLine(run: RunDetail, sourceBlockId: string) {
  const source = run.blocks.find((block) => block.blockId === sourceBlockId);
  return source?.state === "working" && source.workingMessage
    ? `pending · ${source.workingMessage}`
    : "pending";
}

function sourceState(run: RunDetail, source: JoinSourceDetail, waiting: boolean): SourceState {
  const shown = waiting ? source.arrived : source.latestArrival;
  if (shown) {
    const queued = waiting && source.queued ? ` · +${source.queued} queued` : "";
    return {
      status: "arrived",
      line: `arrived ${clockTime(shown.arrivedAt)} · ${shown.exitName}${queued}`,
      badge: { kind: "finished", label: "Arrived" },
    };
  }
  if (waiting)
    return {
      status: "pending",
      line: pendingLine(run, source.sourceBlockId),
      badge: { kind: "working", label: "Pending" },
    };
  return {
    status: "not arrived",
    line: "did not arrive",
    badge: { kind: "stopped", label: "Not arrived" },
  };
}

function queuedArrivals(source: JoinSourceDetail) {
  const listed = source.extras.map((extra) => `${extra.exitName} ${clockTime(extra.arrivedAt)}`);
  const more = source.queued - listed.length;
  return `Queued: ${listed.join(" · ")}${more > 0 ? ` · ${more} more` : ""}`;
}

function SourceCard({
  run,
  source,
  waiting,
}: {
  run: RunDetail;
  source: JoinSourceDetail;
  waiting: boolean;
}) {
  const state = sourceState(run, source, waiting);
  const exit = waiting ? source.arrived?.exitName : source.latestArrival?.exitName;
  return (
    <Surface tone="inset" asChild className="flex items-center gap-2 px-3 py-2">
      <li aria-label={`${source.name}, ${exit ? `arrived ${exit}` : state.status}`}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm font-medium">{source.name}</p>
          <p className="text-xs break-words text-subtle-foreground">{state.line}</p>
          {waiting && source.extras.length > 0 && (
            <p className="text-xs break-words text-subtle-foreground">{queuedArrivals(source)}</p>
          )}
        </div>
        <StatusBadge kind={state.badge.kind}>{state.badge.label}</StatusBadge>
      </li>
    </Surface>
  );
}

function LatestRound({
  summary,
  detail,
  recipients,
}: {
  summary: JoinSummary;
  detail: JoinDetail | null | undefined;
  recipients: readonly string[];
}) {
  const latest = summary.latest!;
  const forwarded = latest.outcome === "forwarded";
  const arrived = detail?.sources.filter((source) => source.latestArrival).length;
  const counted = forwarded
    ? `${summary.sources}/${summary.sources} sources`
    : arrived === undefined
      ? null
      : `${arrived}/${summary.sources} sources had arrived`;
  const target = forwarded && recipients.length ? ` → ${recipients.join(", ")}` : "";
  return (
    <Surface tone="inset" asChild className="flex items-center gap-2 px-3 py-2">
      <li>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-medium">
            Round {latest.round} {latest.outcome}
          </p>
          <p className="text-xs break-words text-subtle-foreground">
            {clockTime(latest.at)}
            {counted ? ` · ${counted}` : ""}
            {target}
          </p>
        </div>
        {forwarded ? (
          <StatusBadge kind="finished" />
        ) : (
          <StatusBadge kind="stopped">Cancelled</StatusBadge>
        )}
      </li>
    </Surface>
  );
}

export function JoinInspection({ run, block }: { run: RunDetail; block: JoinBlock }) {
  const summary = joinSummaryOf(run, block.id);
  const read = useJoinDetails(run.id, summary ? [summary] : []).get(block.id);
  const detail = read?.detail;
  const waiting = !!summary && summary.arrived > 0;
  const showsLatest = !!summary?.latest && !waiting;
  const sources = detail?.sources;
  const names = joinSources(run.definitions.flow.graph, block.id);
  const recipients = blockExitRecipients(
    run.definitions.flow.graph,
    block.id,
  )("output").filter((name): name is string => !!name);
  const round = showsLatest && summary.latest ? summary.latest.round : (summary?.round ?? 1);
  return (
    <>
      <InspectorSection title="Execution">
        <dl className="flex flex-col gap-2">
          <DetailRow label="Round">{roundText(summary, detail)}</DetailRow>
          <DetailRow label="Sources">{sourcesText(summary, detail, names.length)}</DetailRow>
          <DetailRow label="Queued">{queuedText(summary, detail)}</DetailRow>
        </dl>
      </InspectorSection>
      <InspectorSection title={`Sources · round ${round}`} label="Join sources">
        {read?.error && (
          <ProblemCard tone="error" density="compact" title={read.error}>
            The source details update with the Join&apos;s next change.
          </ProblemCard>
        )}
        <ul className="flex flex-col gap-1.5">
          {sources
            ? sources.map((source) => (
                <SourceCard
                  key={source.sourceBlockId}
                  run={run}
                  source={source}
                  waiting={waiting}
                />
              ))
            : names.map((source) => (
                <Surface
                  key={source.sourceBlockId}
                  tone="inset"
                  asChild
                  className="flex flex-col gap-0.5 px-3 py-2"
                >
                  <li>
                    <p className="truncate text-sm font-medium">{source.name}</p>
                    <p className="text-xs text-subtle-foreground">—</p>
                  </li>
                </Surface>
              ))}
          {summary?.latest && (
            <LatestRound summary={summary} detail={detail} recipients={recipients} />
          )}
        </ul>
      </InspectorSection>
    </>
  );
}

export function WorkerlessNote() {
  return (
    <p className="text-xs text-subtle-foreground">
      Workerless · no T3 thread. Settle or Archive ends a round that never completes.
    </p>
  );
}
