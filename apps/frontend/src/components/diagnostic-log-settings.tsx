import { useId, useState } from "react";
import type { DiagnosticAttempt } from "@agent-easel/contracts";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { TextLink } from "@/components/ui/text-link";
import { MutationGate } from "../client-gate.tsx";
import { useClientScope } from "../client-scope.ts";
import { useDiagnosticLog, type DiagnosticLogView } from "../diagnostic-log.ts";
import { clockTime } from "../time-format.ts";
import {
  DiagnosticAttemptList,
  DiagnosticCopyPreview,
  DiagnosticExportButton,
  DiagnosticLogEmpty,
} from "./diagnostic-log-view.tsx";
import { ProblemCard } from "./problem-card.tsx";
import { SettingsGroup, SettingsPage, SettingsRow } from "./settings-page.tsx";
import { StatusBadge } from "./status-badge.tsx";

const recordingHelp = "Setup and integration steps only, kept on the AgentEasel host.";

const untilTime = (until: string) =>
  new Date(until).toDateString() === new Date().toDateString()
    ? clockTime(until)
    : `${clockTime(until)} tomorrow`;

function deletionSummary({ status, attempts, more }: DiagnosticLogView) {
  const removed = more
    ? "Every attempt is removed now."
    : attempts.length === 1
      ? "The recorded attempt is removed now."
      : `All ${attempts.length} attempts are removed now.`;
  return status.until ? `${removed} Recording stays on until ${untilTime(status.until)}.` : removed;
}

type DiagnosticLog = ReturnType<typeof useDiagnosticLog>;

export function DiagnosticLogSettings() {
  const host = useClientScope() === "host";
  const log = useDiagnosticLog(null);
  const [copying, setCopying] = useState<readonly DiagnosticAttempt[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { view } = log;
  const recorded = !!view && (view.status.enabled || view.status.hasEntries);
  return (
    <SettingsPage
      title="Diagnostic log"
      badge={<RecordingBadge log={log} />}
      action={
        recorded && (
          <>
            <Button variant="outline" onClick={() => setCopying(view.attempts)}>
              Copy
            </Button>
            <DiagnosticExportButton />
            {host && (
              <MutationGate>
                <Button variant="destructive" onClick={() => setDeleting(true)}>
                  Delete
                </Button>
              </MutationGate>
            )}
          </>
        )
      }
    >
      <DiagnosticLogProblems log={log} />
      {view && (
        <>
          <RecordingGroup log={log} view={view} host={host} />
          <LogSection log={log} view={view} onCopy={setCopying} />
          {copying && <DiagnosticCopyPreview attempts={copying} onClose={() => setCopying(null)} />}
          <DeleteConfirmation log={log} view={view} open={deleting} onOpenChange={setDeleting} />
        </>
      )}
    </SettingsPage>
  );
}

function RecordingBadge({ log }: { log: DiagnosticLog }) {
  if (log.view) return log.view.status.enabled && <StatusBadge kind="info">Recording</StatusBadge>;
  return !log.failure && <StatusBadge kind="checking">Checking</StatusBadge>;
}

function DiagnosticLogProblems({ log }: { log: DiagnosticLog }) {
  return (
    <>
      {log.failure && (
        <ProblemCard
          tone="error"
          title="Couldn’t read the Diagnostic log"
          action={<Button onClick={() => void log.refresh()}>Try again</Button>}
        >
          Check that the AgentEasel server is running.
        </ProblemCard>
      )}
      {log.error && (
        <ProblemCard tone="error" title="Couldn’t change the Diagnostic log" details={log.error}>
          Try again in a moment.
        </ProblemCard>
      )}
    </>
  );
}

function RecordingGroup({
  log,
  view,
  host,
}: {
  log: DiagnosticLog;
  view: DiagnosticLogView;
  host: boolean;
}) {
  const { until } = view.status;
  return (
    <SettingsGroup label="Recording">
      <SettingsRow
        title="Record diagnostic log"
        description={
          <>
            <span className="block">{recordingHelp}</span>
            {until && (
              <span className="block">
                Recording until {untilTime(until)}
                {host && (
                  <>
                    {" · "}
                    <MutationGate>
                      <TextLink disabled={log.busy} onClick={() => void log.setRecording(false)}>
                        Turn off now
                      </TextLink>
                    </MutationGate>
                  </>
                )}
              </span>
            )}
          </>
        }
        control={(text) =>
          host ? (
            <MutationGate>
              <Switch
                aria-labelledby={text.title}
                aria-describedby={text.description}
                checked={view.status.enabled}
                disabled={log.busy}
                onCheckedChange={(enabled) => void log.setRecording(enabled)}
              />
            </MutationGate>
          ) : (
            <StatusBadge kind="neutral" icon={Lock}>
              Managed on the AgentEasel host
            </StatusBadge>
          )
        }
      />
    </SettingsGroup>
  );
}

function LogSection({
  log,
  view,
  onCopy,
}: {
  log: DiagnosticLog;
  view: DiagnosticLogView;
  onCopy: (attempts: readonly DiagnosticAttempt[]) => void;
}) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="grid gap-2">
      <h3 id={heading} className="pl-0.5 text-sm font-medium text-muted-foreground">
        Log · newest first
      </h3>
      {view.attempts.length ? (
        <DiagnosticAttemptList attempts={view.attempts} missing={[]} onCopy={onCopy} />
      ) : (
        <DiagnosticLogEmpty />
      )}
      {log.showOlder && (
        <TextLink tone="neutral" className="w-fit" disabled={log.pending} onClick={log.showOlder}>
          Show older attempts
        </TextLink>
      )}
    </section>
  );
}

function DeleteConfirmation({
  log,
  view,
  open,
  onOpenChange,
}: {
  log: DiagnosticLog;
  view: DiagnosticLogView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <AlertDialogContent
          title="Delete the diagnostic log?"
          description={deletionSummary(view)}
          closeDisabled={log.busy}
          actions={
            <>
              <AlertDialogCancel disabled={log.busy}>Cancel</AlertDialogCancel>
              <MutationGate>
                <Button
                  variant="danger"
                  disabled={log.busy}
                  onClick={() => void log.deleteLog().then(() => onOpenChange(false))}
                >
                  Delete log
                </Button>
              </MutationGate>
            </>
          }
        />
      )}
    </AlertDialog>
  );
}
