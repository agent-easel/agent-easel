import type { ReactNode } from "react";
import { Flag } from "lucide-react";
import type { RunDetail, RunResult } from "@t3-factory/contracts";
import { isSingleOutput } from "../block-kind.ts";
import { capturedExits } from "../flow-graph.ts";
import { blockName, capturedEnding, deliveryWorker, resultVisit } from "../run-evidence.ts";
import { runResultState } from "../run-status.ts";
import { dayAndTime } from "../time-format.ts";
import { AgentTextPreview } from "./agent-text.tsx";
import { InspectorHeading } from "./inspector-section.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { StatusBadge } from "./status-badge.tsx";

function fromText(run: RunDetail, result: RunResult) {
  const exit = capturedExits(run.definitions, result.sourceBlockId).find(
    (item) => item.id === result.exitId,
  );
  const exitName = exit && isSingleOutput(exit) ? null : (exit?.name ?? result.exitId);
  const visit = resultVisit(run, result);
  return [
    `${blockName(run, result.sourceBlockId)}${exitName ? ` → ${exitName}` : ""}`,
    visit?.blockId === result.sourceBlockId && `Visit ${visit.number}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function authorKind(run: RunDetail, result: RunResult) {
  return run.definitions.flow.graph.blocks.find((block) => block.id === result.authorBlockId)?.kind;
}

function resultWorker(run: RunDetail, result: RunResult) {
  if (result.origin) return deliveryWorker(run, result.origin);
  return authorKind(run, result) === "agent"
    ? run.blocks.find((block) => block.blockId === result.authorBlockId)
    : undefined;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-label">
      <dt className="w-13 shrink-0 text-subtle-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 break-words text-muted-foreground">
        {children}
      </dd>
    </div>
  );
}

function ResultFacts({ run, result }: { run: RunDetail; result: RunResult }) {
  const kind = authorKind(run, result);
  const author = blockName(run, result.authorBlockId);
  const worker = resultWorker(run, result);
  const visit = resultVisit(run, result);
  return (
    <dl className="flex min-w-0 flex-col gap-1">
      <Fact label="From">{fromText(run, result)}</Fact>
      {worker?.blockId !== result.authorBlockId && (
        <Fact label="By">{kind === "human" ? `${author} · Human step` : author}</Fact>
      )}
      {worker && (
        <Fact label="Worker">
          <span className="min-w-0">
            {blockName(run, worker.blockId)}
            {visit && visit.blockId !== result.sourceBlockId && ` · Visit ${visit.number}`}
          </span>
          {worker.link && <OpenInT3 href={worker.link} className="text-sm" />}
        </Fact>
      )}
      <Fact label="At">{dayAndTime(result.acceptedAt)}</Fact>
    </dl>
  );
}

function ResultOutput({ run, result }: { run: RunDetail; result: RunResult }) {
  if (!result.output) return null;
  if (authorKind(run, result) === "human")
    return (
      <p className="text-sm break-words whitespace-pre-wrap text-foreground">{result.output}</p>
    );
  return (
    <AgentTextPreview
      text={result.output}
      readLabel="Read result"
      heading={{
        kind: "result",
        title: `${result.endingName} · result`,
        provenance: fromText(run, result),
        t3Link: resultWorker(run, result)?.link ?? null,
      }}
    />
  );
}

export function ResultDetails({ run, result }: { run: RunDetail; result: RunResult }) {
  if (result.outputMissing) {
    const ending = capturedEnding(run, result.endingId);
    return (
      <>
        <StatusBadge kind="attention">Output missing</StatusBadge>
        <p className="text-sm text-muted-foreground">
          Ending {result.endingName} requires {ending?.outputDescription || "an output"};{" "}
          {blockName(run, result.authorBlockId)} sent no message.
        </p>
        <ResultFacts run={run} result={result} />
      </>
    );
  }
  return (
    <>
      <ResultOutput run={run} result={result} />
      <ResultFacts run={run} result={result} />
    </>
  );
}

const noResult = {
  "not-yet": ["No result yet", "The Run ends when a branch reaches an ending."],
  "not-reached": ["No result", "The Run ended without reaching an ending."],
} as const;

export function NoResult({ state }: { state: keyof typeof noResult }) {
  const [title, body] = noResult[state];
  return (
    <>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-label text-subtle-foreground">{body}</p>
    </>
  );
}

export function ResultSection({ run }: { run: RunDetail }) {
  const state = runResultState(run);
  if (state === "none") return null;
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label="Run result">
      <div className="flex min-w-0 items-center gap-1.5">
        <InspectorHeading title="Result" />
        {run.result && run.settlement?.state === "stopping" && (
          <StatusBadge kind="working" className="ml-auto">
            Stopping
          </StatusBadge>
        )}
      </div>
      {run.result ? (
        <>
          <p className="flex min-w-0 items-center gap-1.5 text-base font-semibold text-foreground">
            <Flag aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 break-words">{run.result.endingName}</span>
          </p>
          <ResultDetails run={run} result={run.result} />
        </>
      ) : (
        <NoResult state={state === "not-yet" ? "not-yet" : "not-reached"} />
      )}
    </section>
  );
}
