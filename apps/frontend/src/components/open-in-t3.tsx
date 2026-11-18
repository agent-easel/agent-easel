import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one way out to a T3 thread: "Open in T3 ↗" as a link. The button form is only for a card
 * whose action is to go to T3 (Review *Block* in T3).
 */
export function OpenInT3({
  href,
  variant = "link",
  className,
}: {
  href: string;
  variant?: "link" | "button";
  className?: string;
}) {
  const content = (
    <a href={href} target="_blank" rel="noreferrer">
      Open in T3
      <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
    </a>
  );
  if (variant === "button")
    return (
      <Button asChild variant="outline" size="sm" className={cn("w-fit", className)}>
        {content}
      </Button>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-sm font-medium whitespace-nowrap text-link outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      Open in T3
      <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
    </a>
  );
}
