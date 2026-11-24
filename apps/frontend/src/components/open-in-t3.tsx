import { createContext, useContext } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/text-link";
import { cn } from "@/lib/utils";

/** A missing Project leaves its saved history readable without live thread links. */
export const T3LinksAvailable = createContext(true);

/**
 * The one way out to a T3 thread: "Open in T3 ↗" as a link. The filled button form is only for
 * an Attention card whose action is to go to T3.
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
  if (!useContext(T3LinksAvailable)) return null;
  if (variant === "button")
    return (
      <Button asChild size="sm" className={cn("w-fit", className)}>
        <a href={href} target="_blank" rel="noreferrer">
          Open in T3 Code
          <ExternalLink aria-hidden className="size-3" strokeWidth={1.75} />
        </a>
      </Button>
    );
  return (
    <TextLink
      href={href}
      trailingIcon={ExternalLink}
      className={cn("w-fit shrink-0 whitespace-nowrap", className)}
    >
      Open in T3 Code
    </TextLink>
  );
}
