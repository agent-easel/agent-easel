import type { TriggerDefinition } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Button } from "@/components/ui/button";
import { clockTime, dayAndTime } from "../execution-state.tsx";
import { TriggerHealth } from "./trigger-health.tsx";
import { problemHeadline } from "./trigger-text.ts";

/** When the Trigger checks next, as the end of the status line. */
function nextCheck(trigger: TriggerDefinition) {
  if (!trigger.enabled) return "off · turn it on in the Triggers list to check";
  if (!trigger.schedule.enabled) return "checks only when you choose Run";
  return trigger.nextCheckAt ? `next check ${clockTime(trigger.nextCheckAt)}` : "next check soon";
}

function latestCheckLine(trigger: TriggerDefinition) {
  const check = trigger.latestCheck;
  if (!check) return `No check yet · ${nextCheck(trigger)}`;
  const waiting = check.waiting ? ` · ${check.waiting} waiting for a free slot` : "";
  return `Last check ${clockTime(check.checkedAt)} · started ${check.started}${waiting} · ${nextCheck(trigger)}`;
}

/**
 * Figma T05/T08: the latest check and the next one, or the problem that stops every check with
 * its repair guidance. There is no issue list or history.
 */
export function TriggerStatusStrip({
  trigger,
  running,
  onRun,
}: {
  trigger: TriggerDefinition;
  running: boolean;
  onRun: () => void;
}) {
  const { error } = trigger;
  return (
    <section
      aria-label="Trigger status"
      className="grid gap-2 rounded-lg border bg-card px-4 py-3 text-sm leading-tight"
    >
      <div className="flex min-h-7 items-center gap-2.5">
        <TriggerHealth trigger={trigger} />
        <p className="min-w-0 flex-1 text-muted-foreground">
          {error ? (
            <span className="text-foreground">
              {problemHeadline(error)} · since {dayAndTime(error.firstSeenAt)},{" "}
              {error.count === 1 ? "1 check" : `${error.count} checks`}
            </span>
          ) : (
            latestCheckLine(trigger)
          )}
        </p>
        {error && trigger.enabled && (
          <MutationGate>
            <Button variant="outline" size="sm" disabled={running} onClick={onRun}>
              {running ? "Running…" : "Run"}
            </Button>
          </MutationGate>
        )}
      </div>
      {error ? (
        <p className="text-subtle-foreground">
          {error.message} Nothing starts until this is fixed; the Trigger keeps checking and never
          turns itself off.
        </p>
      ) : (
        trigger.latestCheck?.notStarted.map((missed) => (
          <p key={missed.issue} className="text-subtle-foreground">
            {missed.issue} didn&apos;t start: {missed.reason} — retried while it keeps{" "}
            {trigger.github.readyLabel}.
          </p>
        ))
      )}
    </section>
  );
}
