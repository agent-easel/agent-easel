import { LayoutGrid, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div
      role="alert"
      className="pointer-events-auto max-w-sm rounded-lg border border-destructive/40 bg-card px-3 py-2 text-2xs text-destructive shadow-floating"
    >
      <p>{error}</p>
      <button type="button" className="mt-1 underline underline-offset-2" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
