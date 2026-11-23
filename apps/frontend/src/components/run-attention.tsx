import { targetsBlock } from "../run-evidence.ts";
import { AgentMarkdown, AgentTextPreview, WorkingReport } from "./agent-text.tsx";
import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  attentionPresentation,
  awaitsReviewInT3,
  type HumanOccurrence,
  type RunAttention,
  type RunBlock,
  type RunDetail,
} from "@t3-factory/contracts";
import { ChoiceMenu } from "./choice-menu.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Surface } from "@/components/ui/surface";
import { TextLink } from "@/components/ui/text-link";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../api.ts";
import {
  blockedWorkers,
  matterCopy,
  worktreeFixHref,
  pendingRecovery,
  reportCopy,
  reportReasonCode,
  reportRecoveryState,
  requestReportBlocker,
  settlementCopy,
  settlementPrimary,
} from "../attention-copy.ts";
import { blockExitRecipients, capturedExits } from "../flow-graph.ts";
import { reviewInT3Since } from "../run-block-state.ts";
import { useLiveNavigation } from "../live/navigation.ts";
import { cn } from "../lib/utils.ts";
import { clockTime, dayAndTime } from "../time-format.ts";
import { exitDisplayName } from "../connection-label.ts";
import { Disclosure } from "./disclosure.tsx";
import { InspectorHeading } from "./inspector-section.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { fieldLabelClass } from "./page.tsx";
import { runActions, useRunActions } from "./run-actions.tsx";
import { useSettleRun } from "./settle-run.tsx";
import { RUN_STATE_LABELS, StatusBadge } from "./status-badge.tsx";
import { TechnicalDetails, type TechnicalDetail } from "./technical-details.tsx";

/** What a matter is about: its Block, or the Run for a Run-level matter. */
const attentionSubject = (item: RunAttention) => item.blockName ?? "Run";

function selectedExit(run: RunDetail, item: RunAttention) {
  const occurrence = run.humanOccurrences.find((entry) => entry.id === item.occurrenceId);
  if (!occurrence?.exitId) return;
  return capturedExits(run.definitions, occurrence.blockId).find(
    (exit) => exit.id === occurrence.exitId,
  )?.name;
}

/**
 * Run-local attention. Omit `blockId` for the whole Run. Pass a block id for the selected Block's
 * cards, which drop their status row and Technical details: the Block view shows both itself.
 */
type AttentionDetailsProps = {
  run: RunDetail;
  blockId?: string;
  onInspect?: (attention: RunAttention) => void;
};

export function RunAttentionDetails(props: AttentionDetailsProps) {
  return <AttentionDetails key={JSON.stringify([props.run.id, props.blockId])} {...props} />;
}

/** Agent Blocks to review in T3, which ask without an attention matter; none while settling. */
function reviewsInT3(run: RunDetail, blockId: string | undefined) {
  if (run.settlement) return [];
  return run.blocks.filter(
    (block) => awaitsReviewInT3(block) && (blockId === undefined || block.blockId === blockId),
  );
}

/** Figma RD40: an Active Run whose worktree T3 could not create; no worker was launched into it. */
function workspaceFailed(run: RunDetail) {
  return (
    run.lifecycle === "active" &&
    run.workspace.mode === "worktree" &&
    run.workspace.state === "failed"
  );
}

/** Whether anything is pending in `run`'s attention, so the Attention section shows. */
export function attentionPending(run: RunDetail) {
  return (
    run.attention.some((item) => !item.settledAt) ||
    reviewsInT3(run, undefined).length > 0 ||
    workspaceFailed(run)
  );
}

/** A missing report and the report rejections of the same execution are one matter. */
function reportGroups(items: readonly RunAttention[]) {
  const groups = new Map<string, RunAttention[]>();
  for (const item of items)
    if (item.kind === "missing-report" || item.kind === "report-problem") {
      const key = `${item.blockId}\u0000${item.executionId}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
  return [...groups.values()];
}

/** Pending attention only; resolved matters wait in their own closed row below. */
function AttentionDetails({ run, blockId, onInspect }: AttentionDetailsProps) {
  const compact = blockId !== undefined;
  const pending = run.attention.filter(
    (item) => !item.settledAt && (blockId === undefined || item.blockId === blockId),
  );
  const reviews = reviewsInT3(run, blockId);
  const workspace = !compact && workspaceFailed(run);
  const problems = pending.filter((item) => attentionPresentation(item.kind) === "problem");
  const reports = reportGroups(problems);
  const others = problems.filter(
    (item) => item.kind !== "missing-report" && item.kind !== "report-problem",
  );
  const questions = pending.filter((item) => attentionPresentation(item.kind) === "needs-input");
  const count =
    questions.length + reviews.length + reports.length + others.length + (workspace ? 1 : 0);
  if (!count) return null;
  return (
    <section className="flex min-w-0 flex-col gap-3 wrap-anywhere" aria-label="Run attention">
      {!compact && <InspectorHeading title="Attention" count={`${count} pending`} />}
      {onInspect &&
        pending
          .filter((item) => item.invocationId && item.blockId)
          .map((item) => (
            <TextLink key={item.id} className="self-start text-sm" onClick={() => onInspect(item)}>
              {item.kind === "subflow-stop-unresolved"
                ? "Inspect unresolved Stop"
                : `Inspect ${attentionSubject(item)} · ${item.executionId ? "worker visit" : "invocation"}`}
            </TextLink>
          ))}
      {(questions.length > 0 || reviews.length > 0) && (
        <section aria-label="Needs input" className="space-y-3">
          {reviews.map((block) => (
            <ReviewInT3 key={block.blockId} run={run} block={block} compact={compact} />
          ))}
          {questions.map((item) => (
            <QuestionMatter key={item.id} run={run} item={item} compact={compact} />
          ))}
        </section>
      )}
      {(workspace || reports.length > 0 || others.length > 0) && (
        <section aria-label="Problem" className="space-y-3">
          {workspace && <WorkspaceProblem run={run} />}
          {others.map((item) =>
            item.kind === "settlement-unresolved" ? (
              <SettlementProblem key={item.id} run={run} item={item} />
            ) : (
              <ProblemMatter key={item.id} run={run} item={item} compact={compact} />
            ),
          )}
          {reports.map((items) => (
            <ReportProblem key={items[0]!.id} run={run} items={items} compact={compact} />
          ))}
        </section>
      )}
    </section>
  );
}

/**
 * Figma Attention card: one tone, a sentence that names the Block and what happened, one sentence
 * with the next action, at most one primary action, and raw facts folded in Technical details.
 * In the Block view (`compact`) it has no status row and no Technical details.
 */
function AttentionCard({
  tone,
  subject,
  label,
  compact,
  title,
  next,
  actions,
  details,
  children,
}: {
  tone: "needs-input" | "problem";
  subject: string;
  /** The card's accessible name; by default its tone and subject, as "Problem · Implement change". */
  label?: string;
  compact: boolean;
  title?: string | undefined;
  next?: ReactNode;
  actions?: ReactNode;
  details?: readonly TechnicalDetail[];
  children?: ReactNode;
}) {
  return (
    <Surface
      asChild
      tone="raised"
      className={cn(
        "flex min-w-0 flex-col gap-2.5 p-4",
        tone === "needs-input" ? "border-attention/75" : "border-destructive/75",
      )}
    >
      <article aria-label={label ?? `${RUN_STATE_LABELS[tone]} · ${subject}`}>
        {!compact && (
          <div className="flex min-w-0 items-center gap-2">
            <StatusBadge kind={tone} />
            <span className="truncate text-xs text-muted-foreground">{subject}</span>
          </div>
        )}
        {title && <h3 className="text-sm leading-5 font-semibold text-foreground">{title}</h3>}
        {next && <p className="text-sm text-muted-foreground">{next}</p>}
        {children}
        {actions && <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{actions}</div>}
        {!compact && details && <TechnicalDetails details={details} />}
      </article>
    </Surface>
  );
}

/**
 * Figma RD19: an Agent idle with a working report. It may be asking in chat or have stopped
 * without reporting, so its title never says it waits for a reply; the owner reviews in T3. The
 * report's reader states the wait (RD45). RD43: without a report, only the title and Open in T3
 * remain.
 */
function ReviewInT3({
  run,
  block,
  compact,
}: {
  run: RunDetail;
  block: RunBlock;
  compact: boolean;
}) {
  const visit = run.activations.filter((activation) => activation.blockId === block.blockId).length;
  const waitingSince = reviewInT3Since(run, block);
  const delayed = block.progressOverdue;
  const since = waitingSince ? ` · since ${clockTime(waitingSince)}` : "";
  return (
    <AttentionCard
      tone="needs-input"
      subject={block.name}
      label={`Review ${block.name} in T3`}
      compact={compact}
      title={`Review ${block.name} in T3`}
      actions={block.link && <OpenInT3 href={block.link} variant="button" />}
    >
      {delayed && <p>No progress report for at least three hours.</p>}
      {block.workingMessage && (
        <WorkingReport
          text={block.workingMessage}
          blockName={block.name}
          provenance={
            delayed ? `Visit ${visit}` : `Visit ${visit} · waiting for your reply${since}`
          }
          t3Link={block.link}
          size="needs-input"
        />
      )}
    </AttentionCard>
  );
}

/** Resolved matters of the Run, or of one Block, in a closed row at the bottom. */
export function ResolvedAttention({ run, blockId }: { run: RunDetail; blockId?: string }) {
  const settled = run.attention.filter(
    (item) => !!item.settledAt && (blockId === undefined || item.blockId === blockId),
  );
  if (!settled.length) return null;
  return (
    <Disclosure label={`Resolved attention · ${settled.length}`}>
      <div aria-label="Resolved attention" role="group" className="flex flex-col gap-3">
        {settled.map((item) => (
          <SettledMatter key={item.id} run={run} item={item} />
        ))}
      </div>
    </Disclosure>
  );
}

/** The Block and thread binding a matter is about. */
function matterFacts(run: RunDetail, item: RunAttention) {
  const block = run.blocks.find((entry) => entry.blockId === item.blockId);
  const binding = run.threadBindings.find((entry) => entry.id === item.bindingId);
  return { block, binding };
}

/** "fresh · 22:16": how current Factory's last look at the Block's thread is. */
function observed(item: RunAttention, block: RunBlock | undefined) {
  return `${item.freshness}${block?.observedAt ? ` · ${clockTime(block.observedAt)}` : ""}`;
}

/** Reason, Execution, Thread and Observed of a matter about one Block's thread. */
function matterDetails(
  run: RunDetail,
  item: RunAttention,
  reason: string = item.kind,
): TechnicalDetail[] {
  const { block, binding } = matterFacts(run, item);
  return [
    ["Reason", reason],
    ["Execution", item.executionId],
    ["Thread", binding?.threadId ?? block?.threadId],
    ["Observed", item.blockId ? observed(item, block) : null],
  ];
}

function QuestionMatter({
  run,
  item,
  compact,
}: {
  run: RunDetail;
  item: RunAttention;
  compact: boolean;
}) {
  const subject = attentionSubject(item);
  // A settling Run accepts no answers, so its question cards show no Needs input chip.
  const answerable = !run.settlement;
  if (item.kind === "human") {
    const source = parallelSource(
      run,
      run.humanOccurrences.find((entry) => entry.id === item.occurrenceId),
    );
    return (
      <AttentionCard
        tone="needs-input"
        subject={subject}
        label={["Needs input", subject, source].filter(Boolean).join(" · ")}
        compact={compact || !answerable}
      >
        {source && <p className="text-xs text-muted-foreground">{source}</p>}
        <PendingHuman run={run} item={item} />
      </AttentionCard>
    );
  }
  const { title, next } = matterCopy(item);
  return (
    <AttentionCard
      tone="needs-input"
      subject={subject}
      compact={compact || !answerable}
      title={title}
      next={next}
      actions={item.link && <OpenInT3 href={item.link} variant="button" />}
    />
  );
}

/** Execution failed and Condition integrity: one Block's Problem and its one action. */
function ProblemMatter({
  run,
  item,
  compact,
}: {
  run: RunDetail;
  item: RunAttention;
  compact: boolean;
}) {
  const { title, next } = matterCopy(item);
  const { block } = matterFacts(run, item);
  const recorded =
    run.executions.find(
      (execution) =>
        execution.blockId === item.blockId &&
        execution.executionId === item.executionId &&
        (!item.bindingId || execution.bindingId === item.bindingId),
    )?.problem ?? block?.problem;
  const action =
    item.kind === "condition-integrity" || item.kind === "join-integrity" ? (
      <SettleRunAction run={run} />
    ) : (
      item.link && <OpenInT3 href={item.link} variant="button" />
    );
  return (
    <AttentionCard
      tone="problem"
      subject={attentionSubject(item)}
      compact={compact}
      title={title}
      next={next}
      actions={action}
      details={[
        ...matterDetails(run, item),
        // A failure that recorded only its kind adds nothing to the Reason row.
        [
          "Detail",
          item.kind === "condition-integrity" || item.kind === "join-integrity"
            ? item.message
            : recorded !== item.kind
              ? recorded
              : null,
        ],
      ]}
    />
  );
}

/**
 * Figma RD33–RD36 and RD55: a missing report and the rejected reports of the same execution are
 * one card. Request report leads while it can be sent; after a request the card says so and
 * offers nothing until the Agent's assessment turn ends.
 */
function ReportProblem({
  run,
  items,
  compact,
}: {
  run: RunDetail;
  items: readonly RunAttention[];
  compact: boolean;
}) {
  const first = items[0]!;
  const rejection = items.findLast((item) => item.kind === "report-problem");
  const { block } = matterFacts(run, first);
  const recovery = reportRecoveryState(
    run,
    block,
    items.map((item) => item.id),
  );
  const subject = attentionSubject(first);
  const copy = reportCopy(subject, rejection, recovery.state);
  const link = items.find((item) => item.link)?.link;
  const reasons = items.map((item) =>
    item.kind === "report-problem" ? (reportReasonCode(item.message) ?? item.kind) : item.kind,
  );
  const details: TechnicalDetail[] = [
    ...matterDetails(run, first, [...new Set(reasons)].join(" · ")),
    ["Report", rejection?.message],
  ];
  if (recovery.state === "requested")
    return (
      <AttentionCard
        tone="problem"
        subject={subject}
        compact={compact}
        title={copy.title}
        next={`Report requested at ${clockTime(recovery.recovery.requestedAt)}. The Agent is checking its work.`}
        actions={link && <OpenInT3 href={link} />}
        details={details}
      />
    );
  return (
    <AttentionCard
      tone="problem"
      subject={subject}
      compact={compact}
      title={copy.title}
      next={copy.next}
      details={details}
    >
      <RequestReport run={run} block={block} link={link} />
    </AttentionCard>
  );
}

/**
 * Figma RD31 and RD32: Settle could not stop the Run's workers. When T3 cannot stop worker threads
 * the owner stops them in T3, so Open in T3 leads and Retry settlement is a link; otherwise a retry
 * can succeed and leads. Archive stays in the Run's ··· menu.
 */
function SettlementProblem({ run, item }: { run: RunDetail; item: RunAttention }) {
  const blocked = blockedWorkers(run);
  const { title, next } = settlementCopy(run);
  return (
    <AttentionCard
      tone="problem"
      subject="Run"
      compact={false}
      title={title}
      next={next}
      actions={<SettlementActions run={run} />}
      details={[
        ["Reason", item.kind],
        ["Attempt", run.settlement ? String(run.settlement.attempt) : null],
        ...blocked.map((worker): TechnicalDetail => [
          worker.blockName,
          [
            worker.threadId ?? "not launched yet",
            worker.stopOutcome && `stop ${worker.stopOutcome}`,
            worker.problem,
          ]
            .filter(Boolean)
            .join("\n"),
        ]),
      ]}
    />
  );
}

/** Retry settlement, the Run's only settlement retry, with Open in T3 for the first blocked worker. */
function SettlementActions({ run }: { run: RunDetail }) {
  const { settle, dialog } = useSettleRun();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const link = blockedWorkers(run).find((worker) => worker.link)?.link;
  const primary = settlementPrimary(run);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError("");
    return await settle(run.id, true)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not retry settlement.");
      })
      .finally(() => setBusy(false));
  }
  const retryButton = (
    <MutationGate>
      {busy || primary === "retry" ? (
        <Button
          size="sm"
          variant={busy ? "outline" : "default"}
          disabled={busy}
          onClick={() => void retry()}
        >
          {busy ? "Retrying settlement…" : "Retry settlement"}
        </Button>
      ) : (
        <TextLink className="text-xs" onClick={() => void retry()}>
          Retry settlement
        </TextLink>
      )}
    </MutationGate>
  );
  return (
    <>
      {primary === "open-in-t3" && !busy && link ? (
        <>
          <OpenInT3 href={link} variant="button" />
          {retryButton}
        </>
      ) : (
        <>
          {retryButton}
          {link && <OpenInT3 href={link} />}
        </>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
      {dialog}
    </>
  );
}

/** Figma RD40: T3 could not create the Run's worktree, so no worker was launched into it.
 * Open in T3 when a thread holds the fix; otherwise Settle. */
function WorkspaceProblem({ run }: { run: RunDetail }) {
  const workspace = run.workspace;
  const fix = worktreeFixHref(run);
  return (
    <AttentionCard
      tone="problem"
      subject="Run"
      compact={false}
      title="T3 couldn’t create this Run’s worktree"
      next={
        fix
          ? "Fix it in T3, then start the Run again."
          : "Settle this Run, then start it again once T3 can create the worktree."
      }
      actions={fix ? <OpenInT3 href={fix} variant="button" /> : <SettleRunAction run={run} />}
      details={[
        ["Reason", "worktree-failed"],
        ["Base", workspace.mode === "worktree" ? workspace.baseRef : null],
        ["Detail", workspace.mode === "worktree" ? workspace.problem : null],
      ]}
    />
  );
}

/** Settle… opens the Run's one Settle confirmation, as the Run actions do. */
function SettleRunAction({ run }: { run: RunDetail }) {
  const { value } = useLiveNavigation();
  const entry = value?.find((candidate) => candidate.id === run.id);
  const { available, busy } = useRunActions({ entry, detail: run });
  return (
    <MutationGate>
      <Button
        size="sm"
        disabled={!available.settle}
        onClick={() => void runActions.run({ entry, detail: run }, "settle")}
      >
        {busy ? "Settling…" : "Settle…"}
      </Button>
    </MutationGate>
  );
}

/** Figma RD50: where a pending Human occurrence came from, when its step has several pending. */
function parallelSource(run: RunDetail, occurrence: HumanOccurrence | undefined) {
  if (!occurrence) return null;
  const parallel = run.humanOccurrences.filter(
    (item) => item.blockId === occurrence.blockId && item.state === "pending",
  );
  return parallel.length < 2 ? null : occurrenceSource(run, occurrence);
}

/** "From Review implementation · Visit 1": the Block, and an Agent's visit, that wrote the
 * occurrence's message. */
function occurrenceSource(run: RunDetail, occurrence: HumanOccurrence) {
  const intent = run.intents.find((item) => item.id === occurrence.incomingIntentId);
  if (!intent?.sourceBlockId) return null;
  const { blockId, activationId } = messageAuthor(run, intent, new Map()) ?? sender(intent);
  const source = run.blocks.find((block) => block.blockId === blockId);
  const visit =
    run.activations
      .filter((activation) => activation.blockId === blockId)
      .findIndex((activation) => activation.id === activationId) + 1;
  return `From ${source?.name ?? blockId}${visit ? ` · Visit ${visit}` : ""}`;
}

type Delivery = RunDetail["intents"][number];
type MessageAuthor = { blockId: string | null; activationId: string | null };
/** Each relayed message's author by relay Block, message and worker origin; null while it is being
 * resolved. */
type RelayAuthors = Map<string, MessageAuthor | null>;

const sender = (intent: Delivery): MessageAuthor => ({
  blockId: intent.sourceBlockId,
  activationId: null,
});

/**
 * Who wrote `intent`'s message, following Wait, Condition and Continuation pass-through relays back
 * to the delivery that produced it: an Agent's or a Continuation prompt's report names its visit, a
 * person's answer or any other delivery its sender, and a missing link the relay that sent it. The
 * delivery's `origin` cannot name the author: a Human answer repeats the reviewed worker's origin
 * to route later work, and relays forward it unchanged. Null for a relayed message met again while
 * it is being resolved (a loop).
 */
function messageAuthor(
  run: RunDetail,
  intent: Delivery,
  relays: RelayAuthors,
): MessageAuthor | null {
  if (intent.waitArrivalId) {
    const arrival = run.waitArrivals.find((item) => item.id === intent.waitArrivalId);
    const incoming = run.intents.find((item) => item.id === arrival?.incomingIntentId);
    return incoming ? messageAuthor(run, incoming, relays) : sender(intent);
  }
  const received = receivedMessage(run, intent);
  if (received) {
    const key = JSON.stringify([
      intent.sourceBlockId,
      intent.fingerprint,
      intent.origin?.activationId,
      intent.origin?.threadId,
    ]);
    if (!relays.has(key)) {
      relays.set(key, null);
      relays.set(key, sharedAuthor(run, received, relays) ?? sender(intent));
    }
    return relays.get(key) ?? null;
  }
  const activationId = run.reports.find((report) => report.id === intent.reportId)?.activationId;
  const activation = run.activations.find((item) => item.id === activationId);
  return activation ? { blockId: activation.blockId, activationId: activation.id } : sender(intent);
}

/**
 * The deliveries a Condition, or a Continuation passing messages through, received with
 * `intent`'s message; null when `intent` is neither relay's output. Run detail does not link these
 * outputs to the delivery they forward, but both relays forward the message and its worker origin
 * unchanged, and a released delivery's fingerprint is its `{ message }` payload's, so the received
 * deliveries carry the same fingerprint and origin.
 */
function receivedMessage(run: RunDetail, intent: Delivery) {
  const forwarded = (item: Delivery) =>
    item.fingerprint === intent.fingerprint &&
    item.origin?.activationId === intent.origin?.activationId &&
    item.origin?.threadId === intent.origin?.threadId;
  if (intent.conditionArrivalId)
    return run.intents.filter(
      (item) =>
        targetsBlock(item, intent.sourceBlockId) &&
        item.state === "acknowledged" &&
        forwarded(item),
    );
  if (intent.reportId) return null;
  const passed = new Set(
    run.continuationVisits
      .filter((visit) => visit.blockId === intent.sourceBlockId && visit.kind === "pass-through")
      .map((visit) => visit.incomingIntentId),
  );
  return passed.size ? run.intents.filter((item) => passed.has(item.id) && forwarded(item)) : null;
}

/** The author every one of `deliveries` resolves to; null when they differ or none resolves. */
function sharedAuthor(run: RunDetail, deliveries: readonly Delivery[], relays: RelayAuthors) {
  const authors = deliveries
    .map((item) => messageAuthor(run, item, relays))
    .filter((author) => author !== null);
  const [first] = authors;
  return first &&
    authors.every(
      (author) => author.blockId === first.blockId && author.activationId === first.activationId,
    )
    ? first
    : null;
}

function SettledMatter({ run, item }: { run: RunDetail; item: RunAttention }) {
  const exit = selectedExit(run, item);
  const reply = run.coordinationActions.questionReplies.find((r) => r.attentionId === item.id);
  return (
    <Surface asChild tone="raised" className="flex flex-col gap-1.5 p-3 text-sm">
      <article>
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge kind={attentionPresentation(item.kind)} />
          <h3 className="truncate text-2xs font-medium text-muted-foreground">
            {attentionSubject(item)}
          </h3>
        </div>
        {item.message &&
          // Only a conversation-waiting message is the Agent's own question; other kinds record
          // Factory's reason.
          (item.kind === "conversation-waiting" ? (
            <AgentMarkdown text={item.message} density="card" />
          ) : (
            <p className="whitespace-pre-wrap">{item.message}</p>
          ))}
        {exit && <p>Decision: {exit}</p>}
        <p>Resolved: {item.settlementReason}</p>
        {reply && (
          <p className="whitespace-pre-wrap">
            Recorded answer: {reply.message} · {reply.state}
          </p>
        )}
        {item.settledAt && (
          <p className="text-xs text-subtle-foreground">{dayAndTime(item.settledAt)}</p>
        )}
        {item.link && <OpenInT3 href={item.link} className="text-sm" />}
      </article>
    </Surface>
  );
}

function PendingHuman({ run, item }: { run: RunDetail; item: RunAttention }) {
  const occurrence = run.humanOccurrences.find((entry) => entry.id === item.occurrenceId);
  if (!occurrence || occurrence.state !== "pending")
    return <p className="text-sm text-muted-foreground">This occurrence is no longer pending.</p>;
  if (run.settlement)
    return (
      <p className="text-sm text-muted-foreground">
        Factory is settling this Run and stopping its workers, so it accepts no answers.
      </p>
    );
  return <HumanResponseForm run={run} blockName={attentionSubject(item)} occurrence={occurrence} />;
}

/** Figma RD18: each decision names where it leads, or that it ends the branch. */
function decisionLabel(
  recipientsOf: ReturnType<typeof blockExitRecipients>,
  exit: { id: string; name: string },
) {
  const recipients = recipientsOf(exit.id).filter(Boolean);
  return recipients.length
    ? `${exit.name} → ${recipients.join(", ")}`
    : `${exit.name} — ends this branch`;
}

/** Why Submit answer is unavailable, or null while it can be sent. */
function submitBlocker({
  online,
  confirming,
  decided,
  messageMissing,
}: {
  online: boolean;
  confirming: boolean;
  decided: boolean;
  messageMissing: boolean;
}) {
  if (!online) return "Factory offline";
  if (confirming) return "A Discord confirmation is waiting";
  if (!decided) return "Choose a decision first";
  if (messageMissing) return "Add your changes";
  return null;
}

/** Whether `until` has not passed yet; it turns false at that moment without another Run update. */
function useStillBefore(until: string | null) {
  const [passed, setPassed] = useState<string | null>(null);
  useEffect(() => {
    if (!until) return;
    const timer = window.setTimeout(
      () => setPassed(until),
      Math.max(0, Date.parse(until) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [until]);
  return until !== null && passed !== until;
}

/** Sends one answer; a refusal keeps the chosen decision and the typed text for another try. */
function useHumanAnswer(occurrenceId: string) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(exitId: string, message: string, onSent: () => void) {
    setBusy(true);
    setError("");
    return await api
      .answerHumanOccurrence(occurrenceId, { exitId, message })
      .then(onSent)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not submit this answer.");
      })
      .finally(() => {
        setBusy(false);
      });
  }
  return { error, busy, send };
}

/** A Human step answers with one of its exits; an exit with Message required needs a message. */
function HumanResponseForm({
  run,
  blockName,
  occurrence,
}: {
  run: RunDetail;
  blockName: string;
  occurrence: HumanOccurrence;
}) {
  const [exitId, setExitId] = useState("");
  const [message, setMessage] = useState("");
  const { error, busy, send } = useHumanAnswer(occurrence.id);
  const online = useMutationsAllowed();
  const confirming = useStillBefore(occurrence.chatConfirmationUntil);
  const exits = capturedExits(run.definitions, occurrence.blockId);
  const recipients = useMemo(
    () => blockExitRecipients(run.definitions.flow.graph, occurrence.blockId),
    [run.definitions.flow.graph, occurrence.blockId],
  );
  const selected = exits.find((exit) => exit.id === exitId);
  const messageRequired = !!selected?.messageRequired;
  const blocker = submitBlocker({
    online,
    confirming,
    decided: !!selected,
    messageMissing: messageRequired && !message.trim(),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected && !blocker) void send(selected.id, message, () => setMessage(""));
  }
  const locked = busy || !online || confirming;
  return (
    <form aria-label={`Answer ${blockName}`} className="flex flex-col gap-3" onSubmit={submit}>
      {occurrence.context && (
        <div className="flex min-w-0 flex-col gap-1.5">
          <AgentTextPreview
            text={occurrence.context}
            readLabel="Read full context"
            variant="needs-input"
            heading={{
              kind: "text",
              title: `${blockName} · context`,
              provenance: [occurrenceSource(run, occurrence), clockTime(occurrence.appearedAt)]
                .filter(Boolean)
                .join(" · "),
              t3Link: null,
            }}
          />
        </div>
      )}
      <DecisionSelect
        value={exitId}
        disabled={locked}
        options={exits.map((exit) => ({
          id: exit.id,
          label: decisionLabel(recipients, {
            id: exit.id,
            name: exitDisplayName(exit),
          }),
        }))}
        onChange={setExitId}
      />
      <ResponseField
        messageRequired={messageRequired}
        disabled={locked}
        value={message}
        onChange={setMessage}
      />
      {error && (
        <ProblemCard tone="error" density="compact" title="Couldn’t submit your answer">
          {error}
        </ProblemCard>
      )}
      <SubmitAnswer busy={busy} blocker={blocker} />
    </form>
  );
}

/** Submit answer: filled only when it can be sent, otherwise neutral with the reason beside it;
 * while sending it reads Submitting… with no reason. */
function SubmitAnswer({ busy, blocker }: { busy: boolean; blocker: string | null }) {
  const reasonId = useId();
  const reason = busy ? null : blocker;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button
        type="submit"
        variant={busy || blocker ? "outline" : "default"}
        disabled={busy || !!blocker}
        aria-describedby={reason ? reasonId : undefined}
      >
        {busy ? "Submitting…" : "Submit answer"}
      </Button>
      {reason && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {reason}
        </p>
      )}
    </div>
  );
}

function DecisionSelect({
  value,
  disabled,
  options,
  onChange,
}: {
  value: string;
  disabled: boolean;
  options: readonly { id: string; label: string }[];
  onChange: (exitId: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className={fieldLabelClass}>
        Decision
      </Label>
      <ChoiceMenu
        id={id}
        label="Decision"
        value={value}
        choices={options}
        disabled={disabled}
        placeholder="Choose a decision"
        className="h-8 border-input bg-background"
        required
        onChange={onChange}
      />
    </div>
  );
}

function ResponseField({
  messageRequired,
  disabled,
  value,
  onChange,
}: {
  messageRequired: boolean;
  disabled: boolean;
  value: string;
  onChange: (message: string) => void;
}) {
  const label = messageRequired ? "Requested changes (required)" : "Response (optional)";
  const ariaLabel = messageRequired ? "Requested changes" : "Response";
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className={fieldLabelClass}>
        {label}
      </Label>
      <Textarea
        id={id}
        placeholder="Type your response…"
        aria-label={ariaLabel}
        required={messageRequired}
        disabled={disabled}
        maxLength={100000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * Request report for an Agent Block idle after its turn: Factory starts one more turn in which the
 * Agent assesses its existing work and reports, without repeating it. While T3 has not confirmed
 * the worker idle the button stays neutral with that reason; after a request it says so instead.
 */
export function RequestReport({
  run,
  block,
  link,
}: {
  run: RunDetail;
  block: RunBlock | undefined;
  link?: string | null | undefined;
}) {
  const requested = block && pendingRecovery(run, block);
  if (requested)
    return (
      <p className="text-sm text-muted-foreground">
        Report requested at {clockTime(requested.requestedAt)}. The Agent is checking its work.
      </p>
    );
  const blocker = requestReportBlocker(run, block);
  if (!block || blocker === "unavailable") return link ? <OpenInT3 href={link} /> : null;
  return (
    <RequestReportButton runId={run.id} blockId={block.blockId} waiting={!!blocker} link={link} />
  );
}

/** Request report, neutral with its reason while T3 has not confirmed the Agent idle, with Open in
 * T3 beside it, or below that reason. */
function RequestReportButton({
  runId,
  blockId,
  waiting,
  link,
}: {
  runId: string;
  blockId: string;
  waiting: boolean;
  link: string | null | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reasonId = useId();
  async function submit() {
    setBusy(true);
    setError("");
    return await api
      .requestReport(runId, { blockId })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not request report.");
      })
      .finally(() => {
        setBusy(false);
      });
  }
  const openInT3 = link && <OpenInT3 href={link} />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MutationGate>
          <Button
            size="sm"
            variant={waiting ? "outline" : "default"}
            disabled={busy || waiting}
            aria-describedby={waiting ? reasonId : undefined}
            onClick={() => void submit()}
          >
            {busy ? "Requesting…" : "Request report"}
          </Button>
        </MutationGate>
        {!waiting && openInT3}
      </div>
      {waiting && (
        <>
          <p id={reasonId} className="text-xs text-muted-foreground">
            Waiting for T3 to confirm the Agent is idle
          </p>
          {openInT3}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
