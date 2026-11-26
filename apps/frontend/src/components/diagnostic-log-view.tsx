import { useState } from "react";
import { CircleCheck, CircleDashed, X, type LucideIcon } from "lucide-react";
import type {
  DiagnosticAttempt,
  DiagnosticAttemptOutcome,
  DiagnosticOperation,
  DiagnosticStepOutcome,
} from "@agent-easel/contracts";
import {
  describeDiagnosticEntry,
  diagnosticLogMarkdown,
  diagnosticAttemptName,
} from "@agent-easel/domain-validation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Surface } from "@/components/ui/surface";
import { TextLink } from "@/components/ui/text-link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MutationGate } from "@/client-gate";
import { diagnosticExportPath, useDiagnosticLog, type DiagnosticRetry } from "../diagnostic-log.ts";
import { clockTime, clockTimeWithSeconds } from "../time-format.ts";
import { CopyButton } from "./copy-button.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { StatusBadge, type SettingKind } from "./status-badge.tsx";

const succeeded: Record<DiagnosticOperation, string> = {
  backend_start: "Started",
  t3_detection: "Found",
  reporting_recheck: "Checked",
  reporting_install: "Installed",
};

function attemptBadge(
  operation: DiagnosticOperation,
  outcome: DiagnosticAttemptOutcome | null,
): { kind: SettingKind; label: string } {
  if (outcome === "ok") return { kind: "success", label: succeeded[operation] };
  if (outcome === "failed") return { kind: "error", label: "Failed" };
  if (outcome === "partial") return { kind: "attention", label: "Partly failed" };
  return { kind: "neutral", label: "Incomplete" };
}

const stepIcons: Record<DiagnosticStepOutcome, { icon: LucideIcon; label: string; tone: string }> =
  {
    ok: { icon: CircleCheck, label: "ok", tone: "text-success" },
    failed: { icon: X, label: "failed", tone: "text-destructive" },
    skipped: { icon: CircleDashed, label: "skipped", tone: "text-subtle-foreground" },
  };

const count = (n: number) => `${n} ${n === 1 ? "attempt" : "attempts"}`;

function DiagnosticStepLine({ at, outcome, name, detail, reason }: StepLineProps) {
  const { icon: Icon, label, tone } = stepIcons[outcome];
  return (
    <li className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1 text-sm leading-tight">
      <span className="font-mono text-label text-subtle-foreground">
        {clockTimeWithSeconds(at)}
      </span>
      <Icon aria-label={label} className={cn("mt-px size-4", tone)} strokeWidth={1.5} />
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-foreground">{name}</span>
        {detail && (
          <span className="font-mono text-label wrap-anywhere text-muted-foreground">{detail}</span>
        )}
      </span>
      <span
        className={cn(
          "text-right font-mono text-label",
          outcome === "failed" ? "text-destructive" : "text-subtle-foreground",
        )}
      >
        {reason}
      </span>
    </li>
  );
}

type StepLineProps = ReturnType<typeof describeDiagnosticEntry> & { at: string };

function DiagnosticAttemptSection({ attempt }: { attempt: DiagnosticAttempt }) {
  const name = diagnosticAttemptName(attempt);
  const badge = attemptBadge(attempt.operation, attempt.outcome);
  return (
    <section aria-label={`${name} at ${clockTime(attempt.startedAt)}`}>
      <header className="flex min-h-9 items-center gap-2 border-b bg-card px-3 py-1">
        <span className="text-sm font-medium text-foreground">{name}</span>
        <span className="text-sm text-muted-foreground">· {clockTime(attempt.startedAt)}</span>
        <StatusBadge kind={badge.kind} className="ml-auto">
          {badge.label}
        </StatusBadge>
        <CopyButton text={diagnosticLogMarkdown([attempt])} label={`Copy ${name} attempt`} />
      </header>
      {attempt.truncated && (
        <p className="px-3 pt-2 text-2xs text-muted-foreground">
          Earlier steps of this attempt were evicted from the log.
        </p>
      )}
      <ol className="grid py-2">
        {attempt.entries.map(({ at, entry }, index) => (
          <DiagnosticStepLine key={index} at={at} {...describeDiagnosticEntry(entry)} />
        ))}
      </ol>
    </section>
  );
}

export function DiagnosticAttemptList({
  attempts,
  missing,
}: {
  attempts: readonly DiagnosticAttempt[];
  missing: readonly string[];
}) {
  return (
    <Surface tone="group">
      {attempts.map((attempt) => (
        <DiagnosticAttemptSection key={attempt.id} attempt={attempt} />
      ))}
      {missing.length > 0 && (
        <p role="status" className="px-3 py-2.5 text-sm text-muted-foreground">
          {missing.length === 1
            ? "1 attempt is no longer in the log."
            : `${missing.length} attempts are no longer in the log.`}
        </p>
      )}
    </Surface>
  );
}

export function DiagnosticLogEmpty() {
  return (
    <EmptyState
      size="compact"
      title="Nothing recorded"
      body="Turn on Record diagnostic log, then repeat the step that failed. Recording turns itself off after 24 hours."
    />
  );
}

const reviewReminder = "Review it before posting publicly.";

export function DiagnosticExportButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" asChild>
          <a href={diagnosticExportPath} download="agenteasel-diagnostic-log.txt">
            Export
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Downloads the whole log as text. {reviewReminder}</TooltipContent>
    </Tooltip>
  );
}

export function DiagnosticCopyPreview({
  attempts,
  onClose,
}: {
  attempts: readonly DiagnosticAttempt[];
  onClose: () => void;
}) {
  const text = diagnosticLogMarkdown(attempts);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      onClose();
    } catch {
      setFailed(true);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="wide"
        title="Copy diagnostic log"
        description={`${reviewReminder} What you see here is exactly what gets copied.`}
        actions={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void copy()}>Copy to clipboard</Button>
          </>
        }
      >
        <pre
          aria-label="Diagnostic log excerpt"
          className="max-h-80 overflow-auto rounded-md border bg-card p-3 font-mono text-label whitespace-pre-wrap text-foreground"
        >
          {text}
        </pre>
        <p className="text-2xs text-muted-foreground">
          {count(attempts.length)} on screen · paths and identities already redacted
        </p>
        {failed && (
          <ProblemCard tone="error" density="compact" title="Copy unavailable here">
            This browser withholds the clipboard. Export the log instead.
          </ProblemCard>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DiagnosticLogViewer({ attempts }: { attempts: readonly string[] | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TextLink onClick={() => setOpen(true)}>View diagnostic log</TextLink>
      {open && <DiagnosticLogDialog attempts={attempts} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DiagnosticRetryAction({
  retry,
  recover,
  view = false,
}: {
  retry: DiagnosticRetry;
  recover: () => Promise<readonly string[]>;
  view?: boolean;
}) {
  if (retry.attempts) return view ? <DiagnosticLogViewer attempts={retry.attempts} /> : null;
  if (!retry.offer) return null;
  return (
    <MutationGate>
      <TextLink onClick={() => retry.start(recover)}>Record diagnostic log and try again</TextLink>
    </MutationGate>
  );
}

function DiagnosticLogDialog({
  attempts,
  onClose,
}: {
  attempts: readonly string[] | null;
  onClose: () => void;
}) {
  const [whole, setWhole] = useState(attempts === null);
  const log = useDiagnosticLog(whole ? null : attempts);
  const [copying, setCopying] = useState(false);
  const shown = log.view?.attempts ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="wide"
        title="Diagnostic log"
        description={
          whole
            ? "Newest first. Paths and identities are redacted."
            : "The attempts from your last retry. Paths and identities are redacted."
        }
        actions={
          <>
            {!whole && (
              <TextLink
                tone="neutral"
                className="mr-auto self-center"
                onClick={() => setWhole(true)}
              >
                Show whole log
              </TextLink>
            )}
            <DiagnosticExportButton />
            <Button disabled={shown.length === 0} onClick={() => setCopying(true)}>
              Copy
            </Button>
          </>
        }
      >
        {log.failure && (
          <ProblemCard tone="error" density="compact" title="Couldn’t read the Diagnostic log" />
        )}
        {log.view &&
          (shown.length || log.view.missing.length ? (
            <DiagnosticAttemptList attempts={shown} missing={log.view.missing} />
          ) : (
            <DiagnosticLogEmpty />
          ))}
      </DialogContent>
      {copying && <DiagnosticCopyPreview attempts={shown} onClose={() => setCopying(false)} />}
    </Dialog>
  );
}
