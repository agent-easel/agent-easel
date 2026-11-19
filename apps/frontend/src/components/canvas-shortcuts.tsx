import { useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { executeAppCommand } from "../app-keyboard-commands.ts";
import { formatShortcut, shortcutGroupEntries } from "../keyboard-shortcuts.ts";
import { useShortcutPreferences } from "../shortcut-preferences.ts";
import { Button } from "@/components/ui/button";
import { KeyChip } from "@/components/ui/key-chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Figma RD15: the canvas group of the shortcut cheat sheet, with current bindings, one click
 * away instead of a sentence always on screen.
 */
export function CanvasShortcutsButton() {
  const { bindings } = useShortcutPreferences();
  const [open, setOpen] = useState(false);
  // The cheat sheet refuses to open over another overlay, so it opens once this one has closed.
  const cheatSheetRequested = useRef(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Canvas shortcuts">
              <Keyboard aria-hidden className="size-4" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Canvas shortcuts</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        aria-label="Canvas shortcuts"
        className="flex w-67 flex-col gap-2.5 rounded-[10px] border-border bg-card px-3.5 py-3"
        onCloseAutoFocus={(event) => {
          if (!cheatSheetRequested.current) return;
          cheatSheetRequested.current = false;
          event.preventDefault();
          executeAppCommand("shortcutsCheatSheet");
        }}
      >
        <p className="text-sm font-semibold text-foreground">Canvas shortcuts</p>
        <p className="text-xs text-subtle-foreground">Work when the canvas has focus.</p>
        <dl className="flex flex-col gap-2.5">
          {shortcutGroupEntries("canvas", bindings).map((entry) => (
            <div key={entry.id} className="flex items-center gap-1">
              <dt className="min-w-0 flex-1 text-sm text-muted-foreground">{entry.label}</dt>
              <dd className="flex shrink-0 gap-1">
                {entry.keys.map((key) => (
                  <KeyChip key={key}>{key}</KeyChip>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <span aria-hidden className="h-px bg-border" />
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="link"
            className="h-auto min-w-0 flex-1 justify-start p-0 text-xs font-medium"
            onClick={() => {
              cheatSheetRequested.current = true;
              setOpen(false);
            }}
          >
            All keyboard shortcuts
          </Button>
          <KeyChip>{formatShortcut(bindings.shortcutsCheatSheet)}</KeyChip>
        </div>
      </PopoverContent>
    </Popover>
  );
}
