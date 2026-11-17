import { useCallback, useState } from "react";
import type { TriggerDefinition } from "@t3-factory/contracts";
import type { StudioDefinitions } from "../../studio-definitions.ts";
import { currentSettings } from "../../trigger-review.ts";

type TriggerAction = "enable" | "disable" | "run" | "remove";

/** The last action Factory refused, with its reason. */
type TriggerFailure = { readonly name: string; readonly message: string } | null;

/**
 * Enable, disable, Run and Remove for the Triggers screens. The results arrive through Studio's
 * live list; only a refusal is kept here to show. Enabling happens only after a review, and runs
 * the first check at once.
 */
export function useTriggerActions(
  definitions: Pick<
    StudioDefinitions,
    "setTriggerEnabled" | "runTrigger" | "removeTrigger" | "previewTrigger"
  >,
) {
  const [pending, setPending] = useState<ReadonlyMap<string, TriggerAction>>(new Map());
  const [failure, setFailure] = useState<TriggerFailure>(null);
  const perform = useCallback(
    (trigger: TriggerDefinition, action: TriggerAction, send: () => Promise<unknown>) => {
      setFailure(null);
      setPending((current) => new Map(current).set(trigger.id, action));
      return send()
        .then(
          () => true,
          (cause: unknown) => {
            setFailure({
              name: trigger.name,
              message:
                cause instanceof Error
                  ? cause.message
                  : `Factory could not ${action} this Trigger.`,
            });
            return false;
          },
        )
        .finally(() =>
          setPending((current) => {
            const next = new Map(current);
            next.delete(trigger.id);
            return next;
          }),
        );
    },
    [],
  );
  return {
    /** The action running for each Trigger, and the last refusal. */
    state: { pending, failure },
    disable: (trigger: TriggerDefinition) =>
      perform(trigger, "disable", () =>
        definitions.setTriggerEnabled(trigger.id, { enabled: false }),
      ),
    /** Enable and check: enabling starts the schedule an interval out, so the check runs now. */
    enableAndCheck: (trigger: TriggerDefinition) =>
      perform(trigger, "enable", async () => {
        await definitions.setTriggerEnabled(trigger.id, { enabled: true });
        await definitions.runTrigger(trigger.id);
      }),
    /** What a check of the saved Trigger would start now; it starts and changes nothing. */
    preview: (trigger: TriggerDefinition) =>
      definitions.previewTrigger(trigger.id, currentSettings(trigger)),
    run: (trigger: TriggerDefinition) =>
      perform(trigger, "run", () => definitions.runTrigger(trigger.id)),
    remove: (trigger: TriggerDefinition) =>
      perform(trigger, "remove", () => definitions.removeTrigger(trigger.id)),
  };
}

export type TriggerActions = ReturnType<typeof useTriggerActions>;
