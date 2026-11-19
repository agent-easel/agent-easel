import { LayoutGrid, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import { TextLink } from "@/components/ui/text-link";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Explicit Auto-arrange control with pending and error feedback. */
export function AutoArrangeButton({
  pending,
  disabled,
  onClick,
}: {
  pending: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabled || pending}
          aria-busy={pending}
          aria-label="Auto-arrange"
          onClick={onClick}
        >
          {pending ? (
            <Loader2 aria-hidden className="size-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <LayoutGrid aria-hidden className="size-4" strokeWidth={1.5} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Layer blocks left-to-right and route wires</TooltipContent>
    </Tooltip>
  );
}

export function AutoArrangeStatus({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss: () => void;
}) {
  if (!error) return null;
  return (
    <Surface
      tone="floating"
      role="alert"
      className="pointer-events-auto max-w-sm border-destructive/40 px-3 py-2 text-2xs text-destructive"
    >
      <p>{error}</p>
      <TextLink tone="neutral" className="mt-1" onClick={onDismiss}>
        Dismiss
      </TextLink>
    </Surface>
  );
}
