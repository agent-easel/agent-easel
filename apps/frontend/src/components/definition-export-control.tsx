import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DefinitionExportModel, DefinitionExportSnapshot } from "../definition-export.ts";

/** **Export** for an editor's saved definition, asking first when the editor has unsaved changes. */
export function DefinitionExportControl({
  model,
  state,
  dirty,
  disabled,
}: {
  model: DefinitionExportModel;
  state: DefinitionExportSnapshot;
  dirty: boolean;
  disabled: boolean;
}) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled || state.exporting}
        onClick={() => void model.request(dirty)}
      >
        {state.exporting ? "Exporting…" : "Export"}
      </Button>
      <Dialog
        open={state.confirming}
        onOpenChange={(open) => {
          if (!open) model.keepEditing();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export the saved revision?</DialogTitle>
            <DialogDescription>Unsaved changes won't be included.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={model.keepEditing}>
              Keep editing
            </Button>
            <Button type="button" onClick={() => void model.confirm()}>
              Export saved revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What the last export needs to tell the user, or empty. */
export function definitionExportNotice(state: DefinitionExportSnapshot): string {
  if (state.error) return state.error;
  if (state.driverKindOmitted.length === 0) return "";
  const names = state.driverKindOmitted.map((name) => `"${name}"`).join(", ");
  return `Exported without the driver kind for ${names}: T3 did not list the provider, so another installation can match the model only to the same provider instance.`;
}
