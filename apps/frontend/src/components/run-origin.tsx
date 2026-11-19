import type { RunOrigin } from "@t3-factory/contracts";
import { CircleDashed, Zap } from "lucide-react";
import { TextLink } from "@/components/ui/text-link";
import { InspectorSection } from "./inspector-section.tsx";

/** `name#N` as Figma RD17 writes it, from the copy stored at Start; the issue link names the owner. */
const originIssue = (origin: RunOrigin) =>
  `${origin.repository.slice(origin.repository.indexOf("/") + 1)}#${origin.issueNumber}`;

/** Figma RD17 top bar meta: the Trigger and issue a Run was started from. */
export function RunOriginMeta({ origin }: { origin: RunOrigin }) {
  const text = `Started from Trigger “${origin.trigger.name}” · ${originIssue(origin)}`;
  return (
    <>
      <span aria-hidden>·</span>
      <Zap aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
      {/* Yields its width before the Project and Flow names do; the title keeps it readable. */}
      <span className="min-w-0 shrink-[4] truncate tracking-label" title={text}>
        {text}
      </span>
    </>
  );
}

/** Figma RD17 sidebar hover card line. */
export function RunOriginPreview({ origin }: { origin: RunOrigin }) {
  return (
    <div className="flex items-start gap-1.5 text-muted-foreground">
      <Zap aria-hidden className="mt-0.75 size-3 shrink-0" strokeWidth={1.75} />
      <span className="break-words">
        Started from {origin.trigger.name} · {originIssue(origin)}
      </span>
    </div>
  );
}

/**
 * Figma RD17 inspector section. The Trigger name and issue title are the copies stored at Start, so
 * they stay as they were after the Trigger is renamed or removed and never reflect live issue state.
 */
export function RunOriginSection({ origin }: { origin: RunOrigin }) {
  return (
    <InspectorSection title="Started from" label="Started from">
      <div className="flex min-w-0 items-center gap-2">
        <Zap aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="truncate text-label font-medium text-muted-foreground">
          <span className="sr-only">Trigger: </span>
          {origin.trigger.name}
        </span>
      </div>
      <TextLink
        href={origin.url}
        tone="neutral"
        trailing="external"
        className="flex min-w-0 gap-2 text-sm"
      >
        <CircleDashed aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">
          {originIssue(origin)} {origin.title}
        </span>
      </TextLink>
      <p className="text-2xs tracking-label text-subtle-foreground">
        A record of what started this Run — not a claim, no live issue state.
      </p>
    </InspectorSection>
  );
}
