import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** One chord, or the muted label shown in a list of bindings when it is unassigned. */
export function KeyChip({
  children,
  className,
  ...props
}: Omit<ComponentProps<"kbd">, "children"> & { children: string | undefined }) {
  const textClass = "shrink-0 font-sans text-xs font-medium text-muted-foreground";
  if (children === undefined) {
    return <span className={cn(textClass, className)}>Unbound</span>;
  }
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded-sm border bg-muted px-1.5 py-0.5 whitespace-nowrap",
        textClass,
        // Follows the size class: tailwind-merge drops a leading class placed before a font size.
        "leading-none",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
