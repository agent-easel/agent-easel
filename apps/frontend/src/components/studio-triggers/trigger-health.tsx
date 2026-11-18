import type { TriggerDefinition } from "@t3-factory/contracts";
import { StatusBadge } from "../status-badge.tsx";

/** How many Triggers a problem stops, as Studio's attention marks announce it. */
export const triggersInError = (count: number) =>
  count === 1 ? "1 Trigger in Error" : `${count} Triggers in Error`;

/** Figma Trigger/Status: Error while a problem stops every check, Healthy after a clean check,
 * and nothing before the first completed check. */
export function TriggerHealth({ trigger }: { trigger: TriggerDefinition }) {
  if (!trigger.error && !trigger.latestCheck) return null;
  return trigger.error ? (
    <StatusBadge kind="error">Error</StatusBadge>
  ) : (
    <StatusBadge kind="success">Healthy</StatusBadge>
  );
}
