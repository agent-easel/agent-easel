import { X } from "lucide-react";
import { Button } from "./ui/button";
import { KeyChip } from "./ui/key-chip";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function PaletteDialogDismiss({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <>
      <KeyChip aria-hidden>Esc</KeyChip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            className="size-7 text-muted-foreground"
            onClick={onClose}
          >
            <X aria-hidden className="size-4" strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </>
  );
}
