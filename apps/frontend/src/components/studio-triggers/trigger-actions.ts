import { useCallback, useState } from "react";
import type { TriggerDefinition } from "@t3-factory/contracts";
import { ApiError } from "../../api.ts";
import type { StudioDefinitions } from "../../studio-definitions.ts";
import { currentSettings } from "../../trigger-review.ts";

type TriggerAction = "enable" | "disable" | "run" | "remove";

/** The last action Factory refused, with its reason. */
type TriggerFailure = { readonly name: string; readonly message: string } | null;

/** Factory refused enabling because another revision was saved after the reviewed one. */
const changedSinceReview = (cause: unknown) =>
  cause instanceof ApiError && cause.detail.issues[0]?.code === "trigger_changed";

/**
 * Enable, disable, Run and Remove for the Triggers screens. The results arrive through Studio's
 * live list; only a refusal is kept here to show. Enabling happens only after a review, confirms
 * the revision that review showed, and runs the first check at once.
 */
export function useTriggerActions(
  definitions: Pick<
    StudioDefinitions,
    "getTrigger" | "setTriggerEnabled" | "runTrigger" | "removeTrigger" | "previewTrigger"
  >,
) {
  const [pending, setPending] = useState<ReadonlyMap<string, TriggerAction>>(new Map());
  const [failure, setFailure] = useState<TriggerFailure>(null);
  const perform = useCallback(
    <T>(
      trigger: TriggerDefinition,
      action: TriggerAction,
      send: () => Promise<T>,
    ): Promise<T | undefined> => {
      setFailure(null);
      setPending((current) => new Map(current).set(trigger.id, action));
      return send()
        .then(
          (value) => value,
          (cause: unknown) => {
            setFailure({
              name: trigger.name,
              message:
                cause instanceof Error
                  ? cause.message
                  : `Factory could not ${action} this Trigger.`,
            });
            return undefined;
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
    /**
     * Enable and check: enabling starts the schedule an interval out, so the check runs now.
     * Answers the Trigger as saved now when another revision was saved after `reviewedRevision`;
     * nothing is enabled then and its author reviews the current settings instead.
     */
    enableAndCheck: (trigger: TriggerDefinition, reviewedRevision: number) =>
      perform(trigger, "enable", async (): Promise<TriggerDefinition | null> => {
        let enabled: TriggerDefinition;
        try {
          enabled = await definitions.setTriggerEnabled(trigger.id, {
            enabled: true,
            reviewedRevision,
          });
        } catch (cause) {
          if (!changedSinceReview(cause)) throw cause;
          return definitions.getTrigger(trigger.id);
        }
        // Enabling advanced the revision; the check runs the one the enable returned.
        await definitions.runTrigger(trigger.id, { expectedRevision: enabled.revision });
        return null;
      }),
    /** What a check of the saved Trigger would start now; it starts and changes nothing. */
    preview: (trigger: TriggerDefinition) =>
      definitions.previewTrigger(trigger.id, currentSettings(trigger)),
    /** Checks the revision on screen; a refusal because another was saved shows as the failure. */
    run: (trigger: TriggerDefinition) =>
      perform(trigger, "run", () =>
        definitions.runTrigger(trigger.id, { expectedRevision: trigger.revision }),
      ),
    remove: (trigger: TriggerDefinition) =>
      perform(trigger, "remove", () => definitions.removeTrigger(trigger.id).then(() => true)),
  };
}

export type TriggerActions = ReturnType<typeof useTriggerActions>;
