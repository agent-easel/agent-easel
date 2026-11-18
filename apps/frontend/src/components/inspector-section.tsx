import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/** Figma inspector section heading: the label in sentence case, then its live count outside it,
 * as in "Progress  2 finished · 1 needs input". */
export function InspectorHeading({ title, count }: { title: string; count?: string | undefined }) {
  return (
    <h3 className="flex min-w-0 items-baseline gap-1.5 text-sm leading-4 font-semibold text-foreground">
      {title}
      {count && (
        <span className="truncate text-xs font-normal text-subtle-foreground">{count}</span>
      )}
    </h3>
  );
}

/** Figma inspector section: its heading above its content. */
export function InspectorSection({
  title,
  count,
  label,
  children,
}: {
  title: string;
  count?: string;
  /** Accessible region name when the section is a landmark for reads and tests. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5" aria-label={label}>
      <InspectorHeading title={title} count={count} />
      {children}
    </section>
  );
}

/** Figma DisclosureRow: secondary facts such as raw ids, closed until the viewer opens it. */
export function InspectorDisclosure({
  label,
  hint,
  children,
}: {
  label: string;
  /** One live value after the label, never fixed text. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Collapsible className="flex flex-col gap-3">
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

/** One labelled fact in an inspector `<dl>`. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}
