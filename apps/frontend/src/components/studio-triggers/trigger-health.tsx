import type { TriggerDefinition } from "@t3-factory/contracts";
import { Badge } from "@/components/ui/badge";

/** How many Triggers a problem stops, as Studio's attention marks announce it. */
export const triggersInError = (count: number) =>
  count === 1 ? "1 Trigger in Error" : `${count} Triggers in Error`;

/** Figma Trigger/Status: Error while a problem stops every check, Healthy after a clean check,
 * and nothing before the first completed check. */
export function TriggerHealth({ trigger }: { trigger: TriggerDefinition }) {
  if (!trigger.error && !trigger.latestCheck) return null;
  return (
    <Badge
      variant={trigger.error ? "destructive" : "success"}
      className="gap-1.25 border-transparent py-0.5 pr-2 pl-1.75"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {trigger.error ? "Error" : "Healthy"}
    </Badge>
  );
}
