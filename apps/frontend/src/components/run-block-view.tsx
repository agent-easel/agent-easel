import { useEffect, useRef } from "react";
import {
  attentionPresentation,
  awaitsReviewInT3,
  type ContinuationVisit,
  type FlowBlock,
  type RunBlock,
  type RunDetail,
} from "@t3-factory/contracts";
import { CONTINUATION_EXIT } from "@t3-factory/domain-validation";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KeyChip } from "@/components/ui/key-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pendingRecovery } from "../attention-copy.ts";
import { BLOCK_KINDS, blockReference } from "../block-kind.ts";
import { blockStateKind } from "../run-block-state.ts";
import { capturedExits, exitRecipients } from "../flow-graph.ts";
import {
  blockVisits,
  continuationPromptVisit,
  threadOwnerName,
  waitingText,
} from "./execution-canvas.tsx";
import { ExecutionStateBadge } from "./execution-state.tsx";
import { clockTime } from "../time-format.ts";
import { exitDisplayName } from "./flow-block.tsx";
import { DetailRow, InspectorSection } from "./inspector-section.tsx";
import { RequestReport, ResolvedAttention, RunAttentionDetails } from "./run-attention.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { StatusBadge } from "./status-badge.tsx";
import { TechnicalDetails } from "./technical-details.tsx";
import { CoordinatorActivations } from "./run-coordination.tsx";
import { ResultCard, RunTextReaderLink } from "./run-result.tsx";
import { WaitArrivals } from "./wait-arrivals.tsx";
import { ConditionArrivals } from "./condition-arrivals.tsx";

type Visits = ReturnType<typeof blockVisits>;

/** The current visit, or a waiting Wait's nearest deadline. */
export function currentVisitText(run: RunDetail, block: FlowBlock, visits: Visits) {
  const waiting = block.kind === "wait" && waitingText(run, block.id);
  if (waiting) return waiting;
  const latest = visits[visits.length - 1];
  if (!latest) return "Not visited";
  return `Visit ${visits.length}${latest.start ? ` · since ${clockTime(latest.start)}` : ""}`;
}

export const activeStates: readonly RunBlock["state"][] = ["working", "waiting", "sent"];

function visitSpan(visit: Visits[number]) {
  return `${visit.start ? clockTime(visit.start) : "—"} → ${visit.end ? clockTime(visit.end) : "now"}`;
}

/** The current report of a working visit; a sent Continuation reports like an Agent. An Agent
 * idle with it can be asked to report. */
function WorkingReport({ run, recorded }: { run: RunDetail; recorded: RunBlock }) {
  if (recorded.state !== "working" && recorded.state !== "sent") return null;
  if (!recorded.workingMessage) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm break-words whitespace-pre-wrap text-foreground">
        {recorded.workingMessage}
      </p>
      <RunTextReaderLink
        label="Read working report"
        title={`${recorded.name} · working report`}
        metadata={recorded.observedAt ? clockTime(recorded.observedAt) : ""}
        text={recorded.workingMessage}
        link={recorded.link}
      />
      {(awaitsReviewInT3(recorded) || pendingRecovery(run, recorded)) && (
        <RequestReport run={run} block={recorded} />
      )}
    </div>
  );
}

/** Where the block is now: its current visit and working report, earlier visits only when repeated. */
function BlockNow({
  run,
  block,
  recorded,
}: {
  run: RunDetail;
  block: FlowBlock;
  recorded: RunBlock;
}) {
  const visits = blockVisits(run, block);
  return (
    <>
      <WorkingReport run={run} recorded={recorded} />
      {block.kind === "wait" && <WaitArrivals run={run} blockId={block.id} />}
      {block.kind === "condition" && (
        <ConditionArrivals key={`${run.id}:${block.id}`} run={run} blockId={block.id} />
      )}
      {block.kind !== "wait" && visits.length > 1 && (
        <InspectorSection title={`Visits · ${visits.length}`}>
          <ul className="flex flex-col gap-1.5">
            {visits
              .map((visit, index) => ({ visit, number: index + 1 }))
              .reverse()
              .map(({ visit, number }) => (
                <li
                  key={visit.id}
                  className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Visit {number}</p>
                    <p className="truncate text-xs text-subtle-foreground">{visitSpan(visit)}</p>
                  </div>
                  <ExecutionStateBadge
                    state={
                      block.kind === "agent" && number === visits.length
                        ? recorded.state
                        : visit.status
                    }
                  />
                </li>
              ))}
          </ul>
        </InspectorSection>
      )}
    </>
  );
}

/** Figma RD14 Received: the results handed off to an Agent block, read from the recipient. */
function ReceivedResults({ run, block }: { run: RunDetail; block: FlowBlock }) {
  if (block.kind !== "agent") return null;
  const received = run.intents.flatMap((intent) => {
    const report =
      intent.blockId === block.id &&
      intent.state !== "cancelled" &&
      run.reports.find((item) => item.id === intent.reportId);
    return report ? [{ intent, report }] : [];
  });
  if (!received.length) return null;
  return (
    <InspectorSection title="Received" label="Received results">
      {received.map(({ intent, report }) => (
        <ResultCard key={intent.id} run={run} report={report} received={intent} />
      ))}
    </InspectorSection>
  );
}

/** What reached the block and the results it reported, each as a result card. */
function BlockResults({ run, block }: { run: RunDetail; block: FlowBlock }) {
  return (
    <>
      <ReceivedResults run={run} block={block} />
      <CoordinatorActivations run={run} blockId={block.id} />
    </>
  );
}

function ExitRow({
  name,
  recipients,
}: {
  name: string;
  recipients: readonly (string | undefined)[];
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 shrink truncate text-sm text-foreground">{name}</span>
      <span className="min-w-0 flex-1 truncate text-right text-label text-subtle-foreground">
        {recipients.length ? `→ ${recipients.join(", ")}` : "ends branch"}
      </span>
    </li>
  );
}

function BlockExits({ run, block }: { run: RunDetail; block: FlowBlock }) {
  const recipients = exitRecipients(run.definitions.flow.graph);
  if (block.kind === "continuation")
    return (
      <InspectorSection title="Output">
        <ul className="flex flex-col gap-2.5">
          <ExitRow
            name="response, then pass-through"
            recipients={recipients(block.id, CONTINUATION_EXIT.id)}
          />
        </ul>
      </InspectorSection>
    );
  return (
    <InspectorSection title="Exits">
      <ul className="flex flex-col gap-2.5">
        {capturedExits(run.definitions, block.id).map((exit) => (
          <ExitRow
            key={exit.id}
            name={exitDisplayName(exit, "Output")}
            recipients={recipients(block.id, exit.id)}
          />
        ))}
      </ul>
    </InspectorSection>
  );
}

/** The Revisit instruction captured with the Run's Flow revision; the composed turn stays in the
 * worker thread. */
function CapturedRevisitInstruction({ block }: { block: FlowBlock }) {
  if (block.kind !== "agent" || !block.revisitInstruction) return null;
  return (
    <InspectorSection title="Revisit instruction" label="Revisit instruction">
      <div className="flex flex-col gap-1.5 rounded-md border bg-muted px-3 py-2">
        <p className="text-sm break-words whitespace-pre-wrap text-foreground">
          {block.revisitInstruction}
        </p>
        <p className="text-xs text-subtle-foreground">
          Captured at Start · sent on every visit after the first
        </p>
      </div>
    </InspectorSection>
  );
}

type ContinuationBlock = Extract<FlowBlock, { kind: "continuation" }>;

function sourceName(run: RunDetail, visit: ContinuationVisit) {
  if (!visit.sourceBlockId) return "the Flow input";
  return (
    run.definitions.flow.graph.blocks.find((block) => block.id === visit.sourceBlockId)?.name ||
    visit.sourceBlockId
  );
}

/** The worker's finished response to the prompt, reported against the prompt visit's activation. */
function continuationResponse(run: RunDetail, prompt: ContinuationVisit | undefined) {
  if (!prompt?.activationId) return null;
  return (
    run.reports.findLast(
      (report) => report.activationId === prompt.activationId && report.status === "finished",
    )?.resultMessage ?? null
  );
}

/** A Continuation's prompt, its response and every message that reached it, oldest first. */
function ContinuationHistory({
  run,
  block,
  recorded,
}: {
  run: RunDetail;
  block: ContinuationBlock;
  recorded: RunBlock;
}) {
  const visits = run.continuationVisits.filter((visit) => visit.blockId === block.id);
  const prompt = visits.find((visit) => visit.kind === "prompt");
  const ordered = [...(prompt ? [prompt] : []), ...visits.filter((visit) => visit !== prompt)];
  const queued = visits.filter((visit) => visit.state === "queued").length;
  const owner = prompt?.state === "sent" ? threadOwnerName(run, prompt.bindingId) : null;
  return (
    <>
      <InspectorSection title={activeStates.includes(recorded.state) ? "Now" : "Execution"}>
        <dl className="flex flex-col gap-2">
          <DetailRow label="Prompt">
            {prompt ? `sent ${clockTime(prompt.arrivedAt)} · once in this Run` : "not sent"}
          </DetailRow>
          {owner && <DetailRow label="Work">{owner}&apos;s thread</DetailRow>}
          <DetailRow label="Queued">
            {queued ? `${queued} waiting behind the response` : "none"}
          </DetailRow>
        </dl>
        <WorkingReport run={run} recorded={recorded} />
      </InspectorSection>
      <ContinuationExchange run={run} block={block} prompt={prompt} />
      {ordered.length > 0 && (
        <InspectorSection title={`Visits · ${ordered.length}`}>
          <ul className="flex flex-col gap-1.5">
            {ordered.map((visit, index) => (
              <ContinuationVisitItem key={visit.id} run={run} visit={visit} number={index + 1} />
            ))}
          </ul>
        </InspectorSection>
      )}
    </>
  );
}

const exchangeCardClass = "flex flex-col gap-0.5 rounded-md border bg-muted px-3 py-2";
const exchangeTextClass = "line-clamp-3 text-xs break-words text-subtle-foreground";

/** Input → prompt → response of the prompt visit; the prompt is the captured revision's. */
function ContinuationExchange({
  run,
  block,
  prompt,
}: {
  run: RunDetail;
  block: ContinuationBlock;
  prompt: ContinuationVisit | undefined;
}) {
  const response = continuationResponse(run, prompt);
  const owner = prompt ? threadOwnerName(run, prompt.bindingId) : null;
  return (
    <InspectorSection title="Input → prompt → response">
      <div className="flex flex-col gap-1.5">
        <div className={exchangeCardClass}>
          <p className="text-sm font-medium">
            Input{prompt ? ` · from ${sourceName(run, prompt)}` : ""}
          </p>
          <p className={exchangeTextClass}>
            {prompt ? `arrived ${clockTime(prompt.arrivedAt)}` : "no message yet"}
          </p>
        </div>
        <div className={exchangeCardClass}>
          <p className="text-sm font-medium">
            {prompt ? `Prompt sent${owner ? ` to ${owner}'s thread` : ""}` : "Prompt · not sent"}
          </p>
          <p className={exchangeTextClass} title={block.prompt}>
            {block.prompt || "No prompt in the captured revision"}
          </p>
        </div>
        <div className={exchangeCardClass}>
          <p className="text-sm font-medium">Response</p>
          <p className={exchangeTextClass} title={response ?? undefined}>
            {response ?? "not yet"}
          </p>
        </div>
      </div>
    </InspectorSection>
  );
}

/** Visit pills say what the message did: sent the prompt, passed through, or still waits. */
function visitPill(visit: ContinuationVisit) {
  if (visit.state === "queued" || visit.state === "cancelled") return visit.state;
  return visit.kind === "prompt" ? "sent" : "pass-through";
}

function visitLine(run: RunDetail, visit: ContinuationVisit) {
  const source = sourceName(run, visit);
  if (visit.kind === "prompt") {
    const end = visit.forwardedAt ? clockTime(visit.forwardedAt) : "now";
    return `${clockTime(visit.arrivedAt)}–${end} · from ${source}`;
  }
  if (visit.state === "queued")
    return `${clockTime(visit.arrivedAt)} · ${source}'s message waits behind the prompt`;
  return `${clockTime(visit.arrivedAt)} · ${source}'s message, unchanged · no prompt`;
}

function ContinuationVisitItem({
  run,
  visit,
  number,
}: {
  run: RunDetail;
  visit: ContinuationVisit;
  number: number;
}) {
  const link = run.threadBindings.find((binding) => binding.id === visit.bindingId)?.link;
  return (
    <li className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">
          Visit {number} · {visit.kind}
        </p>
        <p className="text-xs break-words text-subtle-foreground">{visitLine(run, visit)}</p>
        {link && <OpenInT3 href={link} className="text-xs" />}
      </div>
      <ExecutionStateBadge state={visitPill(visit)} />
    </li>
  );
}

/** Figma RD04: the Block's raw T3 references, its pending Problem reasons and observation
 * freshness, for diagnosis only. */
function BlockTechnicalDetails({
  run,
  block,
  recorded,
  threadId,
  observationUnavailable,
}: {
  run: RunDetail;
  block: FlowBlock;
  recorded: RunBlock;
  threadId: string | null | undefined;
  observationUnavailable: boolean;
}) {
  const { references, freshness } = BLOCK_KINDS[block.kind].observed;
  const reasons = run.attention
    .filter(
      (item) =>
        item.blockId === block.id &&
        !item.settledAt &&
        attentionPresentation(item.kind) === "problem",
    )
    .map((item) => item.kind);
  return (
    <TechnicalDetails
      details={[
        ["Thread", references ? (threadId ?? "unresolved") : null],
        ["Execution", references ? (recorded.executionId ?? "unresolved") : null],
        ["Reason", [...new Set(reasons)].join(" · ")],
        [
          "Observed",
          freshness
            ? `${observationUnavailable ? "stale" : recorded.freshness}${recorded.observedAt ? ` · ${clockTime(recorded.observedAt)}` : ""}`
            : null,
        ],
      ]}
    />
  );
}

/** Figma RD14: the selected block in the docked inspector, attention first and raw ids last. */
export function RunBlockView({
  run,
  block,
  recorded,
  observationUnavailable,
  onBack,
}: {
  run: RunDetail;
  block: FlowBlock;
  recorded: RunBlock;
  observationUnavailable: boolean;
  onBack: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.focus();
  }, [block.id]);
  const KindIcon = BLOCK_KINDS[block.kind].Icon;
  const reference = blockReference(block, {
    graph: run.definitions.flow.graph,
    agents: run.definitions.agents,
  }).header;
  // A block without a worker thread of its own shows the thread its Continuation prompt ran on.
  const promptBinding = BLOCK_KINDS[block.kind].workerThread
    ? undefined
    : run.threadBindings.find(
        (binding) => binding.id === continuationPromptVisit(run, block.id)?.bindingId,
      );
  const threadId = recorded.threadId ?? promptBinding?.threadId;
  return (
    <>
      <div
        ref={content}
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-4 pt-3 pb-3 outline-none"
      >
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label="Back to Run overview"
          onClick={onBack}
          className="-ml-1.5 w-fit text-label font-medium"
        >
          <ChevronLeft aria-hidden />
          Overview
          <KeyChip className="ml-1">Esc</KeyChip>
        </Button>
        <header className="flex min-w-0 items-center gap-2">
          <KindIcon
            aria-hidden
            strokeWidth={1.5}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 className="truncate text-base leading-4 font-semibold">{block.name}</h2>
            <p className="truncate text-xs leading-3.5 text-subtle-foreground">{reference}</p>
          </div>
          <BlockStateBadge run={run} recorded={recorded} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close block details"
                onClick={onBack}
              >
                <X aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent shortcut="Esc">Close</TooltipContent>
          </Tooltip>
        </header>
        <RunAttentionDetails run={run} blockId={block.id} />
        {block.kind === "continuation" ? (
          <ContinuationHistory run={run} block={block} recorded={recorded} />
        ) : (
          <BlockNow run={run} block={block} recorded={recorded} />
        )}
        <BlockResults run={run} block={block} />
        <CapturedRevisitInstruction block={block} />
        <BlockExits run={run} block={block} />
        <div aria-hidden className="flex-1" />
        <ResolvedAttention run={run} blockId={block.id} />
        <BlockTechnicalDetails
          run={run}
          block={block}
          recorded={recorded}
          threadId={threadId}
          observationUnavailable={observationUnavailable}
        />
      </div>
    </>
  );
}

/** The Block's canonical state, as its canvas card shows it. */
function BlockStateBadge({ run, recorded }: { run: RunDetail; recorded: RunBlock }) {
  const kind = blockStateKind(run, recorded);
  return kind ? <StatusBadge kind={kind} /> : <ExecutionStateBadge state={recorded.state} />;
}
