import type { RefObject } from "react";
import type { TriggerDefinition } from "@agent-easel/contracts";
import { MutationGate } from "@/client-gate";
import { AlertDialog, AlertDialogCancel, AlertDialogContent } from "@/components/ui/alert-dialog";
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
        title={<>Remove Trigger “{trigger?.name}”?</>}
        description="Checks stop immediately and existing Runs keep their Trigger origin."
        actions={
          <>
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
          </>
        }
        closeDisabled={removing}
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current?.isConnected) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      ></AlertDialogContent>
    </AlertDialog>
  );
}
