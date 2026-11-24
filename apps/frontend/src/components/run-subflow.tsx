import { useState } from "react";
import type { RunDetail, SubflowInvocation, SubflowInvocationPage } from "@agent-easel/contracts";
import { api } from "../api.ts";
import { useMutationsAllowed } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { clockTime } from "../time-format.ts";
import type { RunSubflows } from "../run-subflows.ts";
import { blockName, deliveryRecipientName, deliveryWorker, resultVisit } from "../run-evidence.ts";
import type { CanvasBlockSelection } from "../flow-graph.ts";
import { InspectorHeading } from "./inspector-section.tsx";
import { ResultDetails } from "./run-result-section.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { ExecutionStateBadge } from "./execution-state.tsx";
import { StatusBadge } from "./status-badge.tsx";

type Placement = NonNullable<ReturnType<RunSubflows["placements"]["get"]>>;

export function invocationOutcome(invocation: SubflowInvocation) {
  if (invocation.ending) return invocation.ending.endingName;
  switch (invocation.state) {
    case "nothing-returned":
      return "Nothing returned";
    case "cancelled":
      return "Cancelled";
    case "queued":
      return "Queued";
    case "active":
      return "Running";
    case "stopping":
      return "Stopping";
    case "returned":
      return "Returned";
  }
}

function invocationDelivery(invocation: SubflowInvocation) {
  switch (invocation.ending?.delivery) {
    case "held":
      return "Release pending";
    case "released":
      return "Released";
    case "cancelled":
      return "Delivery cancelled";
    case undefined:
      return null;
  }
}

function invocationSummary(run: RunDetail, invocation: SubflowInvocation) {
  const { ending } = invocation;
  const delivery = invocationDelivery(invocation);
  const worker = ending?.origin && deliveryWorker(run, ending.origin);
  const visit = ending && resultVisit(run, ending);
  const output = ending?.outputMissing
    ? "Output missing"
    : ending?.output === ""
      ? "Empty output"
      : null;
  return [
    `Invocation ${invocation.number}`,
    invocationOutcome(invocation),
    delivery,
    output,
    worker && `Worker ${blockName(run, worker.blockId)}`,
    visit && `Visit ${visit.number}`,
    ending?.recipients
      .map((item) => `${deliveryRecipientName(run, item)} ${item.disposition}`)
      .join(", "),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function inspectedInvocationSummary(
  subflows: RunSubflows,
  selected: CanvasBlockSelection | null,
) {
  const path = typeof selected === "string" ? subflows.byBlock.get(selected)?.path : undefined;
  if (!path) return undefined;
  const placement = subflows.placements.get(path);
  const inspected = placement?.invocation
    ? placement
    : subflows.placements.get(path.slice(0, path.lastIndexOf("/")));
  return inspected?.invocation
    ? invocationSummary(inspected.parent.run, inspected.invocation)
    : undefined;
}

export function SubflowInvocationHeader({
  placement,
  onInspect,
}: {
  placement: Placement;
  onInspect: (invocation: SubflowInvocation) => void;
}) {
  const { invocation, summary } = placement;
  return (
    <div className="flex min-w-0 shrink items-center gap-2 text-xs text-muted-foreground">
      {invocation && (
        <>
          <TextLink
            aria-label={`Inspect Subflow invocation ${invocation.number}`}
            title={invocationSummary(placement.parent.run, invocation)}
            onClick={() => onInspect(invocation)}
          >
            Invocation {invocation.number} · {invocationOutcome(invocation)}
          </TextLink>
          {invocation.state === "active" && <StatusBadge kind="working" />}
          {invocation.state === "stopping" && <StatusBadge kind="waiting">Stopping</StatusBadge>}
          {invocationDelivery(invocation) && <span>{invocationDelivery(invocation)}</span>}
        </>
      )}
      {summary ? <span className="shrink-0 tabular-nums">{summary.queued} queued</span> : null}
    </div>
  );
}

function InvocationHistory({
  runId,
  placement,
  onSelect,
}: {
  runId: string;
  placement: Placement;
  onSelect: (invocation: SubflowInvocation) => void;
}) {
  const [page, setPage] = useState<SubflowInvocationPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function load(cursor: string) {
    setLoading(true);
    setError("");
    try {
      setPage(await api.listSubflowInvocations(runId, placement.id, "10", cursor));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read invocation history.");
    }
    setLoading(false);
  }
  return (
    <section aria-label="Invocation history" className="space-y-2 border-t pt-3">
      <InspectorHeading title="Invocation history" />
      {page && (
        <ul className="space-y-2">
          {page.invocations.map((entry) => {
            const selected = placement.invocation?.id === entry.id;
            const invocation = selected ? placement.invocation : entry;
            return (
              <li key={invocation.id} className="flex flex-wrap items-center gap-x-2 text-sm">
                <TextLink
                  onClick={() => onSelect(invocation)}
                  aria-current={selected ? "true" : undefined}
                >
                  Invocation {invocation.number} · {invocationOutcome(invocation)}
                </TextLink>
                <span className="text-xs text-muted-foreground">
                  {invocationDelivery(invocation)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load("")}>
          {page ? "Newest invocations" : "Show history"}
        </Button>
        {page?.nextCursor && (
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void load(page.nextCursor!)}
          >
            Older invocations
          </Button>
        )}
      </div>
    </section>
  );
}

function InvocationStops({ run, invocation }: { run: RunDetail; invocation: SubflowInvocation }) {
  const allowed = useMutationsAllowed();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const unresolved = run.attention.some(
    (item) =>
      item.kind === "subflow-stop-unresolved" &&
      item.invocationId === invocation.id &&
      !item.settledAt,
  );
  async function retry() {
    setPending(true);
    setError("");
    try {
      await api.retrySubflowStop(run.id, invocation.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retry Stop.");
    }
    setPending(false);
  }
  if (!invocation.stops.length && !unresolved) return null;
  return (
    <section aria-label="Worker stops" className="space-y-2">
      <InspectorHeading title="Worker stops" />
      <ul className="space-y-1 text-sm">
        {invocation.stops.map(({ blockId, threadId, outcome, requestedAt }) => {
          const binding = run.threadBindings.find((worker) => worker.threadId === threadId);
          const block =
            invocation.blocks.find((worker) => worker.blockId === blockId) ??
            run.blocks.find((worker) => worker.blockId === blockId);
          return (
            <li key={threadId} className="flex flex-wrap items-center gap-x-1">
              <span>
                {block?.name ?? blockId}
                {" · "}
                {outcome === "acknowledged"
                  ? "Stop acknowledged"
                  : outcome === "failed"
                    ? "Stop failed"
                    : "Stopping"}
                {" · "}
                {clockTime(requestedAt)}
              </span>
              {invocation.ending?.releasedAt && (
                <StatusBadge kind="finished">Verified ended</StatusBadge>
              )}
              {binding?.link && <OpenInT3 href={binding.link} />}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {unresolved && (
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || pending}
          onClick={() => void retry()}
        >
          Retry Stop
        </Button>
      )}
    </section>
  );
}

export function RunSubflowView({
  run,
  scoped,
  placement,
  onBack,
  onSelect,
}: {
  run: RunDetail;
  scoped: RunDetail | undefined;
  placement: Placement;
  onBack: () => void;
  onSelect: (invocation: SubflowInvocation) => void;
}) {
  const { invocation, summary } = placement;
  const ending = invocation?.ending;
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <TextLink onClick={onBack}>Run overview</TextLink>
      <h2 className="text-lg font-semibold">{placement.name}</h2>
      {summary && <p className="text-sm text-muted-foreground">{summary.queued} queued</p>}
      {invocation ? (
        <section aria-label="Selected invocation" className="space-y-3">
          <InspectorHeading
            title={`Invocation ${invocation.number} · ${invocationOutcome(invocation)}`}
          />
          <div>
            <p className="text-xs text-muted-foreground">Flow input</p>
            <p className="text-sm wrap-anywhere whitespace-pre-wrap">
              {invocation.input || "Empty text"}
            </p>
          </div>
          {ending && scoped && (
            <>
              <p className="text-sm font-medium">{invocationDelivery(invocation)}</p>
              {ending.output === "" && !ending.outputMissing && (
                <p className="text-sm">Empty output</p>
              )}
              <ResultDetails run={scoped} result={ending} />
              {ending.recipientCount > 0 && (
                <section aria-label="Recipients" className="space-y-1">
                  <InspectorHeading title="Recipients" count={String(ending.recipientCount)} />
                  <ul className="text-sm">
                    {ending.recipients.map((recipient) => (
                      <li
                        key={JSON.stringify([recipient.blockId, recipient.targetEndingId])}
                        className="flex items-center justify-between gap-2"
                      >
                        {deliveryRecipientName(placement.parent.run, recipient)}
                        <ExecutionStateBadge state={recipient.disposition} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
          <InvocationStops key={invocation.id} run={run} invocation={invocation} />
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No invocation yet</p>
      )}
      <InvocationHistory
        key={placement.id}
        runId={run.id}
        placement={placement}
        onSelect={onSelect}
      />
    </div>
  );
}
