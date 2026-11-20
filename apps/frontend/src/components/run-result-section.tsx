import type { ReactNode } from "react";
import { Flag } from "lucide-react";
import type { RunDetail, RunResult } from "@t3-factory/contracts";
import { isSingleOutput } from "../block-kind.ts";
import { capturedExits } from "../flow-graph.ts";
import { runResultState } from "../run-status.ts";
import { dayAndTime } from "../time-format.ts";
import { AgentTextPreview } from "./agent-text.tsx";
import { InspectorHeading } from "./inspector-section.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { StatusBadge } from "./status-badge.tsx";

export function blockName(run: RunDetail, blockId: string) {
  return run.definitions.flow.graph.blocks.find((block) => block.id === blockId)?.name ?? blockId;
}

function capturedEnding(run: RunDetail, endingId: string) {
  return run.definitions.flow.graph.finish.endings.find((ending) => ending.id === endingId);
}

/** "Implement change → PR opened · Visit 1": the source, its exit when named, and the visit that
 * delivered when the source is the worker that wrote it. */
function fromText(run: RunDetail, result: RunResult) {
  const exit = capturedExits(run.definitions, result.sourceBlockId).find(
    (item) => item.id === result.exitId,
  );
  const exitName = exit && isSingleOutput(exit) ? null : (exit?.name ?? result.exitId);
  const activation = run.activations.find((item) => item.id === result.origin?.activationId);
  const visit =
    activation?.blockId === result.sourceBlockId
      ? run.activations.filter((item) => item.blockId === activation.blockId).indexOf(activation) +
        1
      : 0;
  return [
    `${blockName(run, result.sourceBlockId)}${exitName ? ` → ${exitName}` : ""}`,
    visit > 0 && `Visit ${visit}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function authorKind(run: RunDetail, result: RunResult) {
  return run.definitions.flow.graph.blocks.find((block) => block.id === result.authorBlockId)?.kind;
}

/** The worker thread that wrote the result, when Factory knows it. */
function workerLink(run: RunDetail, result: RunResult) {
  const threadId = result.origin?.threadId;
  return (
    run.threadBindings.find((binding) => binding.threadId === threadId)?.link ??
    run.blocks.find((block) => block.blockId === result.authorBlockId)?.link ??
    null
  );
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

/** From, who wrote it and when: a worker with its thread, or you for a Human step's answer. */
function ResultFacts({ run, result }: { run: RunDetail; result: RunResult }) {
  const kind = authorKind(run, result);
  const link = kind === "agent" ? workerLink(run, result) : null;
  return (
    <dl className="flex min-w-0 flex-col gap-1">
      <Fact label="From">{fromText(run, result)}</Fact>
      {kind === "agent" ? (
        <Fact label="Worker">
          <span className="min-w-0">{blockName(run, result.authorBlockId)}</span>
          {link && <OpenInT3 href={link} className="text-sm" />}
        </Fact>
      ) : (
        <Fact label="By">
          {kind === "human" ? "You · Human step" : blockName(run, result.authorBlockId)}
        </Fact>
      )}
      <Fact label="At">{dayAndTime(result.acceptedAt)}</Fact>
    </dl>
  );
}

/** The delivered output: Agent-written Markdown, a Human answer as plain text, none for an ending
 * whose output is None or a blank optional output. */
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
        t3Link: workerLink(run, result),
      }}
    />
  );
}

/** A reached ending's output, or the Output missing flag, then its facts. */
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

/** Why there is no result: the Run can still reach an ending, or it ended without one. */
export function NoResult({ state }: { state: keyof typeof noResult }) {
  const [title, body] = noResult[state];
  return (
    <>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-label text-subtle-foreground">{body}</p>
    </>
  );
}

/**
 * Figma Run/ResultSection: the Run's result at the top of the overview, named by the ending it
 * reached, with Stopping while the Run stops its other workers. Absent when the captured Flow
 * declares no endings.
 */
export function ResultSection({ run }: { run: RunDetail }) {
  const state = runResultState(run);
  if (state === "none") return null;
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label="Run result">
      <div className="flex min-w-0 items-center gap-1.5">
        <InspectorHeading title="Result" />
        {run.result && run.settlement && (
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
