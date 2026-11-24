import { useCallback, useState } from "react";
import type { TriggerCheckReply, TriggerDefinition } from "@agent-easel/contracts";
import { ApiError } from "../../api.ts";
import type { StudioDefinitions } from "../../studio-definitions.ts";
import { currentSettings } from "../../trigger-review.ts";

type TriggerAction = "enable" | "disable" | "run" | "remove";

/** The last action Factory refused, with its reason. */
type TriggerFailure = { readonly name: string; readonly message: string } | null;

export type RevisionRefusal = "enable" | "check";

export type CheckOutcome =
  | { readonly checked: TriggerCheckReply }
  | { readonly refused: RevisionRefusal; readonly latest: TriggerDefinition };

/** Factory refused enabling because another revision was saved after the reviewed one. */
const changedSinceReview = (cause: unknown) =>
  cause instanceof ApiError && cause.detail.issues[0]?.code === "trigger_changed";

const staleCheck = (cause: unknown) =>
  cause instanceof ApiError && cause.detail.issues.some((issue) => issue.code === "stale_revision");

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
  const check = (id: string, expectedRevision: number): Promise<CheckOutcome> =>
    definitions.runTrigger(id, { expectedRevision }).then(
      (checked) => ({ checked }),
      async (cause: unknown) => {
        if (!staleCheck(cause)) throw cause;
        return { refused: "check", latest: await definitions.getTrigger(id) };
      },
    );
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
    enableAndCheck: (trigger: TriggerDefinition, reviewedRevision: number) =>
      perform(trigger, "enable", async (): Promise<CheckOutcome> => {
        let enabled: TriggerDefinition;
        try {
          enabled = await definitions.setTriggerEnabled(trigger.id, {
            enabled: true,
            reviewedRevision,
          });
        } catch (cause) {
          if (!changedSinceReview(cause)) throw cause;
          return { refused: "enable", latest: await definitions.getTrigger(trigger.id) };
        }
        return check(enabled.id, enabled.revision);
      }),
    /** What a check of the saved Trigger would start now; it starts and changes nothing. */
    preview: (trigger: TriggerDefinition) =>
      definitions.previewTrigger(trigger.id, currentSettings(trigger)),
    run: (trigger: TriggerDefinition, revision?: number) =>
      perform(trigger, "run", () => check(trigger.id, revision ?? trigger.revision)),
    remove: (trigger: TriggerDefinition) =>
      perform(trigger, "remove", () => definitions.removeTrigger(trigger.id).then(() => true)),
  };
}

export type TriggerActions = ReturnType<typeof useTriggerActions>;
