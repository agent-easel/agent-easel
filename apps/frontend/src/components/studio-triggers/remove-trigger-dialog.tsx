import type { RefObject } from "react";
import type { TriggerDefinition } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/** Figma T06: Remove asks first; Cancel has focus and focus returns to the row's ⋯ button. */
export function RemoveTriggerDialog({
  trigger,
  removing,
  returnFocus,
  onCancel,
  onRemove,
}: {
  trigger: TriggerDefinition | null;
  removing: boolean;
  returnFocus: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onRemove: (trigger: TriggerDefinition) => void;
}) {
  return (
    <AlertDialog
      open={trigger !== null}
      onOpenChange={(open) => {
        if (!open && !removing) onCancel();
      }}
    >
      <AlertDialogContent
        className="gap-4 p-5.5 sm:max-w-115"
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current?.isConnected) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <AlertDialogTitle className="text-sm leading-tight">
          Remove Trigger “{trigger?.name}”?
        </AlertDialogTitle>
        <AlertDialogDescription className="leading-tight">
          Runs it already started keep running and still show where they came from. Checks stop now.
          A new Trigger can reuse this name — it will start issues that still have{" "}
          {trigger?.github.readyLabel}.
        </AlertDialogDescription>
        <div className="flex justify-end gap-2">
          <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
          <MutationGate>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => trigger && onRemove(trigger)}
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          </MutationGate>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
