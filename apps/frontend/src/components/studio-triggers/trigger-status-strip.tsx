import type {
  TriggerCheckReply,
  TriggerDefinition,
  TriggerRepository,
} from "@agent-easel/contracts";
import { MutationGate } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { clockTime, dayAndTime } from "../../time-format.ts";
import { TriggerHealth } from "./trigger-health.tsx";
import { problemHeadline } from "./trigger-text.ts";
import { StartedRuns } from "./started-runs.tsx";
import { TriggerGuidance } from "./trigger-notices.tsx";

function nextCheck(trigger: TriggerDefinition) {
  if (!trigger.enabled) return "Off";
  if (!trigger.schedule.enabled) return "manual checks";
  return trigger.nextCheckAt ? `next check ${clockTime(trigger.nextCheckAt)}` : "next check soon";
}

function LatestCheck({
  trigger,
  checked,
}: {
  trigger: TriggerDefinition;
  checked: TriggerCheckReply | undefined;
}) {
  const check = checked?.latestCheck ?? trigger.latestCheck;
  if (!check) return <>No check yet · {nextCheck(trigger)}</>;
  const runs = checked?.startedRuns;
  return (
    <>
      Last check {clockTime(check.checkedAt)} ·{" "}
      {runs?.length ? (
        <StartedRuns runs={runs} />
      ) : (
        `Started ${check.started} ${check.started === 1 ? "Run" : "Runs"}`
      )}
      {check.waiting > 0 && ` · ${check.waiting} waiting for a free slot`} · {nextCheck(trigger)}
    </>
  );
}

/** The most recent check or the problem and its repair guidance. */
export function TriggerStatusStrip({
  trigger,
  checked,
  checking,
  disabled,
  moved,
  onCheck,
}: {
  trigger: TriggerDefinition;
  checked: TriggerCheckReply | undefined;
  checking: boolean;
  disabled: boolean;
  moved: TriggerRepository | null;
  onCheck: () => void;
}) {
  const { error } = trigger;
  return (
    <section
      aria-label="Trigger status"
      className="grid gap-1 rounded-lg border px-4 py-3 text-sm leading-tight"
    >
      <div className="flex min-h-7 flex-wrap items-center gap-2.5">
        <TriggerHealth trigger={trigger} />
        <p className="min-w-0 flex-1 text-muted-foreground">
          {error ? (
            <span className="text-foreground">
              {moved ? "Repository changed" : problemHeadline(error)} · since{" "}
              {dayAndTime(error.firstSeenAt)},{" "}
              {error.count === 1 ? "1 check" : `${error.count} checks`}
            </span>
          ) : (
            <LatestCheck trigger={trigger} checked={checked} />
          )}
        </p>
        <MutationGate>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !trigger.enabled}
            onClick={onCheck}
          >
            {checking ? "Checking…" : "Check now"}
          </Button>
        </MutationGate>
      </div>
      {moved ? (
        <p id="trigger-status-detail" role="status" className="text-muted-foreground">
          The Project now points to {moved.nameWithOwner}. Choose Confirm under Repository to use
          it.
        </p>
      ) : error ? (
        <div className="text-muted-foreground">
          <TriggerGuidance message={error.message} />
          <p>Nothing starts until this is fixed. The Trigger keeps checking.</p>
        </div>
      ) : (
        (checked?.latestCheck ?? trigger.latestCheck)?.notStarted.map((missed) => (
          <p key={missed.issue} className="text-muted-foreground">
            {missed.issue} didn&apos;t start: {missed.reason} · retried while it keeps{" "}
            {trigger.github.readyLabel}.
          </p>
        ))
      )}
    </section>
  );
}
