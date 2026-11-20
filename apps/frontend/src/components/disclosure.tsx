import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Figma DisclosureRow: secondary facts such as raw ids, closed until the viewer opens it. */
export function Disclosure({
  label,
  hint,
  defaultOpen,
  children,
}: {
  label: string;
  /** One live value after the label, never fixed text. */
  hint?: string;
  defaultOpen?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex min-w-0 flex-col gap-3">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group w-full justify-start gap-1.5 px-0 has-[>svg]:px-0 hover:bg-transparent"
        >
          <ChevronRight
            aria-hidden
            className="size-3 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
          />
          <span className="min-w-0 flex-1 truncate text-left font-medium text-muted-foreground">
            {label}
          </span>
          {hint && <span className="shrink-0 font-normal text-subtle-foreground">{hint}</span>}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}
