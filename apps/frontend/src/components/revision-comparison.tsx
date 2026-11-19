import { cn } from "@/lib/utils";
import { diffRevisionLines, type RevisionLine } from "../revision-diff.ts";

export function RevisionComparison({
  mine,
  theirs,
  revision,
}: {
  mine: readonly RevisionLine[];
  theirs: readonly RevisionLine[];
  revision: number;
}) {
  const { mineChanged, theirsChanged } = diffRevisionLines(mine, theirs);
  return (
    <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
      <RevisionSide
        title="Your draft"
        lines={mine}
        changes={mineChanged}
        tint="bg-destructive/20"
      />
      <RevisionSide
        title={`Revision ${revision}`}
        lines={theirs}
        changes={theirsChanged}
        tint="bg-success/20"
      />
    </div>
  );
}

function RevisionSide({
  title,
  lines,
  changes,
  tint,
}: {
  title: string;
  lines: readonly RevisionLine[];
  changes: readonly boolean[];
  tint: string;
}) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <h3 className="text-2xs font-medium text-muted-foreground">{title}</h3>
      <pre
        aria-label={title}
        className="max-h-[50vh] min-w-0 overflow-auto rounded-md border bg-background py-1.5 font-mono text-2xs leading-[1.4rem] whitespace-pre-wrap wrap-anywhere"
      >
        {lines.map((line, index) => (
          <span
            key={index}
            data-changed={changes[index] || undefined}
            className={cn("block min-h-[1.4rem] px-3", changes[index] && tint)}
          >
            {typeof line === "string" ? line : line.text}
          </span>
        ))}
      </pre>
    </div>
  );
}
