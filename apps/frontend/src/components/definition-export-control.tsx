import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { DefinitionExportModel, DefinitionExportSnapshot } from "../definition-export.ts";

type Exporter = { model: DefinitionExportModel; state: DefinitionExportSnapshot };

/**
 * **Export JSON** in an editor's actions menu; `onSelect` requests the export. Render
 * `DefinitionExportDialog` outside the menu, which closes on select.
 */
export function DefinitionExportMenuItem({
  state,
  disabled,
  description,
  onSelect,
}: {
  state: DefinitionExportSnapshot;
  disabled: boolean;
  /** Why the item is disabled. */
  description?: string | undefined;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled || state.exporting}
      description={description}
      onSelect={onSelect}
    >
      <Download aria-hidden />
      {state.exporting ? "Exporting…" : "Export JSON"}
    </DropdownMenuItem>
  );
}

/** Asks before exporting the saved revision when the editor has unsaved changes. */
export function DefinitionExportDialog({ model, state }: Exporter) {
  return (
    <Dialog
      open={state.confirming}
      onOpenChange={(open) => {
        if (!open) model.keepEditing();
      }}
    >
      <DialogContent
        title="Export the saved revision?"
        description="Unsaved changes won't be included."
        actions={
          <>
            <Button type="button" variant="outline" onClick={model.keepEditing}>
              Keep editing
            </Button>
            <Button type="button" onClick={() => void model.confirm()}>
              Export saved revision
            </Button>
          </>
        }
      ></DialogContent>
    </Dialog>
  );
}

/** What the last export needs to tell the user, or empty. */
export function definitionExportNotice(state: DefinitionExportSnapshot): string {
  if (state.error) return state.error;
  if (state.driverKindOmitted.length === 0) return "";
  const names = state.driverKindOmitted.map((name) => `"${name}"`).join(", ");
  return `Exported without the driver kind for ${names}: T3 did not list the provider, so another installation can match the model only to the same provider instance.`;
}
