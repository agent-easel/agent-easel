import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DefinitionExportModel, DefinitionExportSnapshot } from "../definition-export.ts";

/** **Export** for an editor's saved definition, asking first when the editor has unsaved changes. */
export function DefinitionExportControl({
  model,
  state,
  dirty,
  disabled,
  compact = false,
}: {
  model: DefinitionExportModel;
  state: DefinitionExportSnapshot;
  dirty: boolean;
  disabled: boolean;
  /** Icon-only, for a toolbar where a text button would squeeze the editable name. */
  compact?: boolean;
}) {
  const buttonDisabled = disabled || state.exporting;
  const request = () => void model.request(dirty);
  return (
    <>
      {compact ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Export"
              disabled={buttonDisabled}
              onClick={request}
            >
              <Download aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{state.exporting ? "Exporting…" : "Export as a file"}</TooltipContent>
        </Tooltip>
      ) : (
        <Button type="button" variant="outline" disabled={buttonDisabled} onClick={request}>
          {state.exporting ? "Exporting…" : "Export"}
        </Button>
      )}
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
