import type { ReactNode } from "react";

/** Figma inspector section heading: the label in sentence case, then its live count outside it,
 * as in "Progress  2 finished · 1 needs input". */
export function InspectorHeading({ title, count }: { title: string; count?: string | undefined }) {
  return (
    <h3 className="flex min-w-0 items-baseline gap-1.5 text-sm leading-4 font-semibold text-foreground">
      <span className={count ? "shrink-0" : undefined}>{title}</span>
      {count && <span className="min-w-0 text-xs font-normal text-subtle-foreground">{count}</span>}
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

/** One labelled fact in an inspector `<dl>`. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}
