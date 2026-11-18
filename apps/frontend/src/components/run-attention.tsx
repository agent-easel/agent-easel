import { MutationGate, useMutationsAllowed } from "@/client-gate";
import { bindingRole } from "./run-coordination.tsx";
import { useId, useState, type FormEvent } from "react";
import {
  attentionPresentation,
  awaitsReviewInT3,
  type HumanOccurrence,
  type RunAttention,
  type RunBlock,
  type RunDetail,
} from "@t3-factory/contracts";
import { TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../api.ts";
import { capturedExits, exitRecipients } from "../flow-graph.ts";
import { cn } from "../lib/utils.ts";
import { dayAndTime } from "./execution-state.tsx";
import { exitDisplayName } from "./flow-block.tsx";
import { InspectorDisclosure, InspectorHeading } from "./inspector-section.tsx";
import { OpenInT3 } from "./open-in-t3.tsx";
import { fieldLabelClass } from "./page.tsx";
import { StatusBadge } from "./status-badge.tsx";

const attentionLabel = (kind: RunAttention["kind"]) =>
  ({
    human: "Human steps",
    "native-request": "T3 questions and permissions",
    "conversation-waiting": "Agent questions",
    "missing-report": "Missing reports",
    "report-problem": "Report problems",
    "execution-failed": "Execution problems",
    "condition-integrity": "Condition integrity problems",
    "settlement-unresolved": "Settle could not stop workers",
  })[kind];

function attentionExplanation(kind: RunAttention["kind"]) {
  switch (kind) {
    case "human":
      return null;
    case "native-request":
      return "Respond in T3. Factory cannot answer or approve this request.";
    case "conversation-waiting":
      return "An Agent question recorded before questions in chat stopped needing a report.";
    case "missing-report":
      return "No report was accepted for this completed execution. Check any report rejection below before requesting a separate assessment turn.";
    case "report-problem":
      return "A report or its work evidence needs attention. Inspect the recorded reason and the worker in T3.";
    case "execution-failed":
      return "T3 execution did not complete successfully. Continue in T3 to investigate.";
    case "condition-integrity":
      return "This Condition cannot number its next arrival, so it accepts none until the Run is Settled or Archived.";
    case "settlement-unresolved":
      return "Settle could not stop this Run's workers. Settle again, remove queued work in T3, or Archive the Run.";
  }
}

/** What a matter is about: its Block, or the Run for a Run-level matter. */
const attentionSubject = (item: RunAttention) => item.blockName ?? "Run";

/** The workers a Settle could not resolve, each with what keeps it from finishing and its T3
 * thread, where queued work can be removed. */
function BlockedWorkers({ run }: { run: RunDetail }) {
  const blocked = (run.settlement?.workers ?? []).filter((worker) => worker.state === "unresolved");
  if (!blocked.length) return null;
  return (
    <ul aria-label="Blocked workers" className="flex flex-col gap-2">
      {blocked.map((worker) => (
        <li key={worker.threadId ?? worker.blockId} className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{worker.blockName}</p>
          {worker.problem && <p className="text-sm text-muted-foreground">{worker.problem}</p>}
          {worker.link && <OpenInT3 href={worker.link} className="text-sm" />}
        </li>
      ))}
    </ul>
  );
}

function recordedProblem(run: RunDetail, item: RunAttention) {
  return (
    run.executions.find(
      (execution) =>
        execution.blockId === item.blockId &&
        execution.executionId === item.executionId &&
        (!item.bindingId || execution.bindingId === item.bindingId),
    )?.problem ?? run.blocks.find((block) => block.blockId === item.blockId)?.problem
  );
}

function selectedExit(run: RunDetail, item: RunAttention) {
  const occurrence = run.humanOccurrences.find((entry) => entry.id === item.occurrenceId);
  if (!occurrence?.exitId) return;
  return capturedExits(run.definitions, occurrence.blockId).find(
    (exit) => exit.id === occurrence.exitId,
  )?.name;
}

/**
 * Run-local attention. Omit `blockId` for the whole Run. Pass a block id so a
 * later canvas selection can render the same responses, problem details and T3 links.
 */
type AttentionDetailsProps = {
  run: RunDetail;
  blockId?: string;
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

/** Whether anything is pending in `run`'s attention, so the Attention section shows. */
export function attentionPending(run: RunDetail) {
  return run.attention.some((item) => !item.settledAt) || reviewsInT3(run, undefined).length > 0;
}

/** Pending attention only; resolved matters wait in their own closed row below. */
function AttentionDetails({ run, blockId }: AttentionDetailsProps) {
  const pending = run.attention.filter(
    (item) => !item.settledAt && (blockId === undefined || item.blockId === blockId),
  );
  const reviews = reviewsInT3(run, blockId);
  const count = pending.length + reviews.length;
  if (!count) return null;
  const questions = pending.filter((item) => attentionPresentation(item.kind) === "needs-input");
  return (
    <section className="flex min-w-0 flex-col gap-3 wrap-anywhere" aria-label="Run attention">
      {blockId === undefined && <InspectorHeading title="Attention" count={`${count} pending`} />}
      {(questions.length > 0 || reviews.length > 0) && (
        <section aria-label="Needs input" className="space-y-3">
          {reviews.map((block) => (
            <ReviewInT3 key={block.blockId} block={block} />
          ))}
          {questions.map((item) => (
            <PendingMatter key={item.id} run={run} item={item} />
          ))}
        </section>
      )}
      <ProblemGroup
        items={pending.filter((item) => attentionPresentation(item.kind) === "problem")}
        run={run}
      />
    </section>
  );
}

/**
 * Figma RD19: an Agent idle with a working report. It may be asking in chat or have stopped
 * without reporting, so the card never says it waits for a reply; the owner reviews in T3.
 */
function ReviewInT3({ block }: { block: RunBlock }) {
  return (
    <article
      aria-label={`Review ${block.name} in T3`}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-attention/60 bg-card p-4"
    >
      <StatusBadge kind="needs-input" />
      <h3 className="text-sm font-medium text-foreground">Review {block.name} in T3</h3>
      {block.workingMessage && (
        <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
          {block.workingMessage}
        </p>
      )}
      {block.link && <OpenInT3 href={block.link} variant="button" />}
    </article>
  );
}

/** Resolved matters of the Run, or of one Block, in a closed row at the bottom. */
export function ResolvedAttention({ run, blockId }: { run: RunDetail; blockId?: string }) {
  const settled = run.attention.filter(
    (item) => !!item.settledAt && (blockId === undefined || item.blockId === blockId),
  );
  if (!settled.length) return null;
  return (
    <InspectorDisclosure label={`Resolved attention · ${settled.length}`}>
      <div aria-label="Resolved attention" role="group" className="flex flex-col gap-3">
        {settled.map((item) => (
          <SettledMatter key={item.id} run={run} item={item} />
        ))}
      </div>
    </InspectorDisclosure>
  );
}

function ProblemGroup({ items, run }: { items: readonly RunAttention[]; run: RunDetail }) {
  if (!items.length) return null;
  return (
    <section aria-label="Problem" className="space-y-3">
      {items.map((item) => (
        <PendingMatter key={item.id} run={run} item={item} />
      ))}
    </section>
  );
}

/** Figma RD50: where a pending Human occurrence came from, when its step has several pending. */
function occurrenceSource(run: RunDetail, occurrence: HumanOccurrence | undefined) {
  if (!occurrence) return null;
  const parallel = run.humanOccurrences.filter(
    (item) => item.blockId === occurrence.blockId && item.state === "pending",
  );
  if (parallel.length < 2) return null;
  const intent = run.intents.find((item) => item.id === occurrence.incomingIntentId);
  if (!intent?.sourceBlockId) return null;
  const source = run.blocks.find((block) => block.blockId === intent.sourceBlockId);
  const activationId = run.reports.find((report) => report.id === intent.reportId)?.activationId;
  const visit =
    run.activations
      .filter((activation) => activation.blockId === intent.sourceBlockId)
      .findIndex((activation) => activation.id === activationId) + 1;
  return `From ${source?.name ?? intent.sourceBlockId}${visit ? ` · Visit ${visit}` : ""}`;
}

function PendingMatter({ run, item }: { run: RunDetail; item: RunAttention }) {
  const presentation = attentionPresentation(item.kind);
  // A settling Run accepts no answers, so it shows no Needs input chip or explanation.
  const answerable = presentation !== "needs-input" || !run.settlement;
  const binding = run.threadBindings.find((b) => b.id === item.bindingId);
  const explanation = answerable && attentionExplanation(item.kind);
  const source = occurrenceSource(
    run,
    run.humanOccurrences.find((entry) => entry.id === item.occurrenceId),
  );
  const subject = attentionSubject(item);
  return (
    <article
      aria-label={[presentation === "needs-input" ? "Needs input" : "Problem", subject, source]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-4",
        presentation === "needs-input"
          ? "border-attention/60 bg-card"
          : "border-destructive/40 bg-destructive/8",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {answerable && <StatusBadge kind={presentation} />}
        <h3 className="truncate text-xs text-muted-foreground">{subject}</h3>
      </div>
      {source && <p className="text-xs text-muted-foreground">{source}</p>}
      {explanation && <p className="text-sm font-medium text-foreground">{explanation}</p>}
      <MatterKindDetail run={run} item={item} binding={binding} />
      {binding && <BindingDetail binding={binding} executionId={item.executionId} />}
      {item.kind === "human" && <PendingHuman run={run} item={item} />}
      {item.kind !== "human" && item.link && <OpenInT3 href={item.link} className="text-sm" />}
    </article>
  );
}

function MatterKindDetail({
  run,
  item,
  binding,
}: {
  run: RunDetail;
  item: RunAttention;
  binding: RunDetail["threadBindings"][number] | undefined;
}) {
  return (
    <>
      {item.kind === "native-request" && (
        <p className="text-sm text-muted-foreground">
          Thread-level observation; questions and permission approvals may be grouped.
        </p>
      )}
      {(item.kind === "report-problem" || item.kind === "condition-integrity") && item.message && (
        <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">
          {item.message}
        </p>
      )}
      {item.kind === "execution-failed" && binding?.role === "worker" && (
        <p className="text-sm">
          Worker failed. Report recovery cannot repeat or replace worker work.
        </p>
      )}
      {attentionPresentation(item.kind) === "problem" && <ProblemDetail run={run} item={item} />}
      {item.kind === "settlement-unresolved" && <BlockedWorkers run={run} />}
      {item.kind === "missing-report" && item.blockId !== null && (
        <RequestReport
          run={run}
          blockId={item.blockId}
          executionId={item.executionId}
          recovery={run.recoveries.find((r) => r.attentionId === item.id)}
        />
      )}
    </>
  );
}

function BindingDetail({
  binding,
  executionId,
}: {
  binding: RunDetail["threadBindings"][number];
  executionId: string;
}) {
  return (
    <dl className="flex flex-col gap-0.5 text-2xs leading-4 text-muted-foreground">
      <div className="flex gap-2">
        <dt className="w-14 shrink-0">{bindingRole[binding.role]}</dt>
        <dd className="min-w-0 font-mono break-all">{binding.threadId}</dd>
      </div>
      {executionId && (
        <div className="flex gap-2">
          <dt className="w-14 shrink-0">Execution</dt>
          <dd className="min-w-0 font-mono break-all">{executionId}</dd>
        </div>
      )}
    </dl>
  );
}

/** What resolves a Problem, by kind; Needs input kinds never reach a Problem's detail. */
function problemResolution(item: RunAttention) {
  switch (item.kind) {
    case "missing-report":
      return "This stays unresolved until an explicit report or successful linked recovery is accepted and confirmed. Recovery never starts automatically.";
    case "report-problem":
      return item.message
        ? "A corrected accepted report or confirmed linked recovery settles this rejection; execution progress alone does not."
        : "Inspect the recorded work evidence in T3.";
    case "condition-integrity":
      return "Waiting deliveries stay unnumbered. There is no Retry or repair: Settle or Archive the Run to abandon them; neither resets the count.";
    case "settlement-unresolved":
      return "This resolves when settlement succeeds or the Run is Archived.";
    case "execution-failed":
    case "human":
    case "native-request":
    case "conversation-waiting":
      return "Inspect the failed execution in T3; report recovery does not retry work.";
  }
}

function ProblemDetail({ run, item }: { run: RunDetail; item: RunAttention }) {
  const detail = item.kind === "report-problem" && item.message ? null : recordedProblem(run, item);
  return (
    <p className="text-sm text-muted-foreground">
      {attentionLabel(item.kind)}
      {item.executionId ? ` · execution ${item.executionId}` : ""}. {problemResolution(item)}
      {detail ? ` ${detail}` : ""}
    </p>
  );
}

function SettledMatter({ run, item }: { run: RunDetail; item: RunAttention }) {
  const exit = selectedExit(run, item);
  const reply = run.coordinationActions.questionReplies.find((r) => r.attentionId === item.id);
  return (
    <article className="flex flex-col gap-1.5 rounded-lg border bg-muted p-3 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <StatusBadge kind={attentionPresentation(item.kind)} />
        <h3 className="truncate text-2xs font-medium text-muted-foreground">
          {attentionSubject(item)}
        </h3>
      </div>
      {item.message && <p className="whitespace-pre-wrap">{item.message}</p>}
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
function decisionLabel(run: RunDetail, blockId: string, exit: { id: string; name: string }) {
  const recipients = exitRecipients(run.definitions.flow.graph, blockId, exit.id).filter(Boolean);
  return recipients.length
    ? `${exit.name} → ${recipients.join(", ")}`
    : `${exit.name} — ends this branch`;
}

/** Why Submit answer is unavailable, or null while it can be sent. */
function submitBlocker({
  online,
  decided,
  messageMissing,
}: {
  online: boolean;
  decided: boolean;
  messageMissing: boolean;
}) {
  if (!online) return "Factory offline";
  if (!decided) return "Choose a decision first";
  if (messageMissing) return "Add your changes";
  return null;
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
  const exits = capturedExits(run.definitions, occurrence.blockId);
  const selected = exits.find((exit) => exit.id === exitId);
  const messageRequired = !!selected?.messageRequired;
  const blocker = submitBlocker({
    online,
    decided: !!selected,
    messageMissing: messageRequired && !message.trim(),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (selected && !blocker) void send(selected.id, message, () => setMessage(""));
  }
  const locked = busy || !online;
  return (
    <form aria-label={`Answer ${blockName}`} className="flex flex-col gap-3" onSubmit={submit}>
      {occurrence.context && (
        <p className="text-sm whitespace-pre-wrap text-foreground">{occurrence.context}</p>
      )}
      <DecisionSelect
        value={exitId}
        disabled={locked}
        options={exits.map((exit) => ({
          id: exit.id,
          label: decisionLabel(run, occurrence.blockId, {
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
        <Alert variant="destructive">
          <TriangleAlert aria-hidden />
          <AlertTitle>Couldn’t submit your answer</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <NativeSelectOption value="" disabled>
          Choose a decision
        </NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
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

/** A Block's Request report still in flight: unsent, or its assessment turn not yet completed. */
export function pendingRecovery(run: RunDetail, block: RunBlock) {
  return run.recoveries.find(
    (r) =>
      r.blockId === block.blockId &&
      (r.sourceExecutionId === block.executionId ||
        (r.executionId === block.executionId && block.engineStatus !== "completed")),
  );
}

/**
 * Request report for an Agent Block idle after `executionId`. `recovery` is the request already
 * made for that idle run; Factory rechecks that the worker thread is finished in T3.
 */
export function RequestReport({
  run,
  blockId,
  executionId,
  recovery,
}: {
  run: RunDetail;
  blockId: string;
  executionId: string | null;
  recovery: RunDetail["recoveries"][number] | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (recovery)
    return (
      <p className="text-sm">
        Report requested · {recovery.executionId ?? "send pending or uncertain"}. Original
        execution: {recovery.sourceExecutionId}. Worker work is preserved; no automatic retry.
      </p>
    );
  const block = run.blocks.find((b) => b.blockId === blockId);
  if (!run.gateOpen || !executionId || block?.executionId !== executionId) return null;
  if (
    block.engineStatus !== "completed" ||
    block.freshness !== "fresh" ||
    block.pendingRequestCount !== 0
  )
    return (
      <p className="text-sm">
        Request report waits for fresh evidence that the worker thread is idle with no pending
        native request. No assessment turn has been started.
      </p>
    );
  async function submit() {
    setBusy(true);
    setError("");
    return await api
      .requestReport(run.id, { blockId })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not request report.");
      })
      .finally(() => {
        setBusy(false);
      });
  }
  return (
    <div className="grid gap-2">
      <p className="text-sm">
        Starts an additional Agent turn to assess existing work and report without repeating the
        task.
      </p>
      <MutationGate>
        <Button disabled={busy} onClick={() => void submit()}>
          {busy ? "Requesting…" : "Request report"}
        </Button>
      </MutationGate>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
