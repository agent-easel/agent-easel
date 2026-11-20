import type { ComponentProps } from "react";
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

const tones = {
  /** Content inside a panel or card. */
  inset: "rounded-md bg-muted",
  /** Grouped rows, as in Settings: divided by borders and clipped to the radius. */
  group: "divide-y overflow-hidden rounded-lg bg-muted",
  /** A card that stands on the page. */
  raised: "rounded-lg bg-card",
  /** Controls and popups over the canvas. */
  floating: "rounded-lg bg-card shadow-floating",
} as const;

/**
 * Surface's classes, for a host primitive that renders its own element, such as PopoverContent.
 * The border colour is explicit so it wins over the host's own.
 */
export const surfaceVariants = cva("border border-border", { variants: { tone: tones } });

/**
 * The bordered container in one of four tones. It owns border, background, radius and shadow;
 * padding, gap, layout and content stay at the call site. With `asChild`, it styles its child
 * element (a list, an article, a button), and call-site classes go on Surface, not the child.
 */
export function Surface({
  tone,
  asChild = false,
  className,
  ...props
}: ComponentProps<"div"> & { tone: keyof typeof tones; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="surface"
      data-tone={tone}
      className={cn(surfaceVariants({ tone }), className)}
      {...props}
    />
  );
}
