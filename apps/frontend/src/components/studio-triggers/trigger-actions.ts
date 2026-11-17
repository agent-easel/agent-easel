import { useCallback, useState } from "react";
import type { TriggerDefinition } from "@t3-factory/contracts";
import type { StudioDefinitions } from "../../studio-definitions.ts";

type TriggerAction = "enable" | "disable" | "run" | "remove";

/** The last action Factory refused, with its reason. */
type TriggerFailure = { readonly name: string; readonly message: string } | null;

/**
 * Enable, disable, Run and Remove for the Triggers screens. The results arrive through Studio's
 * live list; only a refusal is kept here to show. Enabling is the one place a review before
 * the first check would intercept.
 */
export function useTriggerActions(
  definitions: Pick<StudioDefinitions, "setTriggerEnabled" | "runTrigger" | "removeTrigger">,
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
    setEnabled: (trigger: TriggerDefinition, enabled: boolean) =>
      perform(trigger, enabled ? "enable" : "disable", () =>
        definitions.setTriggerEnabled(trigger.id, { enabled }),
      ),
    run: (trigger: TriggerDefinition) =>
      perform(trigger, "run", () => definitions.runTrigger(trigger.id)),
    remove: (trigger: TriggerDefinition) =>
      perform(trigger, "remove", () => definitions.removeTrigger(trigger.id)),
  };
}

export type TriggerActions = ReturnType<typeof useTriggerActions>;
