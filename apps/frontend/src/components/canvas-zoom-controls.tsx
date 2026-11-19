import { useShortcutPreferences } from "../shortcut-preferences.ts";
import type { ReactNode } from "react";
import { Crosshair, Minus, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CanvasShortcutsButton } from "./canvas-shortcuts.tsx";

const toolbarClass = "pointer-events-auto flex items-center gap-0.5 p-1";
const separator = <span aria-hidden className="h-5 w-px bg-border" />;

function ControlButton({
  label,
  onClick,
  shortcut,
  children,
}: {
  label: string;
  onClick: () => void;
  shortcut: string | undefined;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent shortcut={shortcut}>{label}</TooltipContent>
    </Tooltip>
  );
}

type FollowControl = {
  /** False with no active or failed Block to focus, so the button never does nothing silently. */
  available: boolean;
  /** The active Blocks changed while following was off. */
  changed: boolean;
  onFollow: () => void;
};

function FollowActiveButton({ available, changed, onFollow }: FollowControl) {
  const { hint: shortcutHint } = useShortcutPreferences();
  const indicated = available && changed;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={indicated ? "Follow active, active Blocks changed" : "Follow active"}
          disabled={!available}
          onClick={onFollow}
        >
          <Crosshair aria-hidden className="size-4" strokeWidth={1.5} />
          {indicated && (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-1.5 rounded-full bg-status-working"
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent shortcut={shortcutHint("followActive")}>
        {indicated ? "Active Blocks changed · follow them" : "Follow active Blocks"}
      </TooltipContent>
    </Tooltip>
  );
}

export function CanvasZoomControls({
  scale,
  onZoom,
  onFit,
  follow,
  arrange,
}: {
  scale: number;
  onZoom: (factor: number) => void;
  onFit: () => void;
  /** Run execution canvas only; the authoring canvas has nothing to follow. */
  follow?: FollowControl | undefined;
  /** The Auto-arrange control. */
  arrange: ReactNode;
}) {
  const { hint: shortcutHint } = useShortcutPreferences();
  const zoomIn = shortcutHint("zoomIn");
  const zoomOut = shortcutHint("zoomOut");
  const fit = shortcutHint("fit");
  return (
    <div className="pointer-events-none flex items-center gap-2">
      <Surface tone="floating" className={toolbarClass}>
        <ControlButton label="Zoom out" shortcut={zoomOut} onClick={() => onZoom(1 / 1.1)}>
          <Minus aria-hidden className="size-3.75" strokeWidth={1.5} />
        </ControlButton>
        <span
          role="status"
          aria-label="Zoom level"
          className="flex h-8 w-12 items-center justify-center font-mono text-xs font-medium"
        >
          {Math.round(scale * 100)}%
        </span>
        <ControlButton label="Zoom in" shortcut={zoomIn} onClick={() => onZoom(1.1)}>
          <Plus aria-hidden className="size-3.75" strokeWidth={1.5} />
        </ControlButton>
        {separator}
        <ControlButton label="Fit Flow" shortcut={fit} onClick={onFit}>
          <Scan aria-hidden className="size-3.5" strokeWidth={1.5} />
        </ControlButton>
      </Surface>
      <Surface tone="floating" className={toolbarClass}>
        {follow && <FollowActiveButton {...follow} />}
        {arrange}
        {separator}
        <CanvasShortcutsButton />
      </Surface>
    </div>
  );
}
