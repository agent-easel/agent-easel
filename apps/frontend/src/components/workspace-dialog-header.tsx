import { Fragment, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import { KeyChip } from "@/components/ui/key-chip";
import { DialogDescription, DialogTitle } from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Shared navigation and dismissal for the Settings and Studio workspaces. */
export function WorkspaceDialogHeader({
  title,
  parents = [],
  section,
  description,
  onClose,
  closeLabel = "Close",
  closeDisabled = false,
  className,
}: {
  title: ReactNode;
  /** Links to the pages above `section`, outermost first. */
  parents?: readonly { label: string; link: ReactNode }[];
  section: string;
  description: string;
  onClose: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  className?: string;
}) {
  return (
    <header
      className={cn("flex h-13 shrink-0 items-center gap-2 border-b pr-3 pl-5 text-sm", className)}
    >
      <DialogTitle className="text-sm leading-none font-normal text-muted-foreground">
        {title}
      </DialogTitle>
      <Separator />
      {parents.map((parent) => (
        <Fragment key={parent.label}>
          {parent.link}
          <Separator />
        </Fragment>
      ))}
      <span className="truncate font-medium text-foreground">{section}</span>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      <KeyChip aria-hidden className="ml-auto">
        Esc
      </KeyChip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={closeLabel}
            className="size-7 text-muted-foreground"
            disabled={closeDisabled}
            onClick={onClose}
          >
            <X aria-hidden className="size-4" strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent shortcut="Esc">{closeLabel}</TooltipContent>
      </Tooltip>
    </header>
  );
}

function Separator() {
  return (
    <span aria-hidden className="text-subtle-foreground">
      /
    </span>
  );
}
