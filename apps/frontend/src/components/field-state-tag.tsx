/**
 * Closed-field state tag for the New Run composer.
 * #525 StatusBadge replaces this markup at merge; keep the tag in this file only.
 */
export function FieldStateTag({ children }: { children: string }) {
  return <span className="shrink-0 text-2xs tracking-label text-destructive">{children}</span>;
}
