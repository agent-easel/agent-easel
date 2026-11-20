import type { ReactElement } from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

type NavRowProps = {
  asChild: true;
  selected: boolean;
  density: "compact" | "regular";
  className?: string;
  children: ReactElement;
};

/** Wraps a typed route link and gives it the shared navigation-row presentation. */
export function NavRow({ selected, density, className, children }: NavRowProps) {
  return (
    <Slot.Root
      data-slot="nav-row"
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md text-sm outline-none hover:bg-accent hover:no-underline focus-ring",
        density === "compact" ? "h-8 px-2" : "h-8.5 px-3",
        selected ? "bg-sidebar-accent font-medium text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </Slot.Root>
  );
}
