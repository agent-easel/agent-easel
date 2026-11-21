import { useEffect, useState } from "react";
import { CirclePause, CircleX, ExternalLink } from "lucide-react";
import type { TriggerPreview, TriggerPreviewIssue } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { ProblemCard } from "../problem-card.tsx";
import { StatusBadge } from "../status-badge.tsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TextLink } from "@/components/ui/text-link";
import { SharedRepositoryCard } from "./trigger-notices.tsx";
import { openedAgo, problemHeadline } from "./trigger-text.ts";

/** What one review shows and how it commits. */
export interface TriggerReview {
  /** "Enable “Implement ready issues”?" */
  readonly title: string;
  /** Project · repository · Flow · schedule · limit. */
  readonly summary: string;
  readonly repository: string;
  readonly confirmLabel: "Enable and check" | "Apply and check" | "Check now";
  /** Asks Factory what a check with the reviewed settings would start now. */
  readonly load: () => Promise<TriggerPreview>;
  /** Create offers saving without enabling instead. */
  readonly saveOff?: () => void;
  /** Why the review opened again, such as settings saved elsewhere after the last one. */
  readonly notice?: string;
}

type PreviewRead =
  | { readonly status: "loading" }
  | { readonly status: "answered"; readonly preview: TriggerPreview }
  | { readonly status: "failed"; readonly message: string };

const captionClass = "text-2xs leading-tight tracking-label text-subtle-foreground";

export function TriggerReviewDialog({
  review,
  busy,
  blocked = false,
  saveBlocked = false,
  onConfirm,
  onCancel,
}: {
  review: TriggerReview | null;
  busy: boolean;
  blocked?: boolean;
  saveBlocked?: boolean;
  /** Commits the review; `preview` is what it showed. */
  onConfirm: (preview: TriggerPreview) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={review !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      {review && (
        <ReviewBody
          review={review}
          busy={busy}
          blocked={blocked}
          saveBlocked={saveBlocked}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      )}
    </Dialog>
  );
}

function ReviewBody({
  review,
  busy,
  blocked,
  saveBlocked,
  onConfirm,
  onCancel,
}: {
  review: TriggerReview;
  busy: boolean;
  blocked: boolean;
  saveBlocked: boolean;
  onConfirm: (preview: TriggerPreview) => void;
  onCancel: () => void;
}) {
  const read = usePreview(review.load);
  const confirmDisabled = busy || blocked || read.status !== "answered";
  return (
    <DialogContent
      title={review.title}
      description={review.summary}
      closeDisabled={busy}
      size="wide"
      actions={
        <>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <MutationGate>
            {review.saveOff && (
              <Button variant="outline" disabled={busy || saveBlocked} onClick={review.saveOff}>
                {busy ? "Saving…" : "Save"}
              </Button>
            )}
            <Button
              variant={confirmDisabled ? "outline" : "default"}
              className={confirmDisabled ? "bg-muted" : undefined}
              disabled={confirmDisabled}
              onClick={() => read.status === "answered" && onConfirm(read.preview)}
            >
              {busy ? "Checking…" : review.confirmLabel}
            </Button>
          </MutationGate>
        </>
      }
    >
      {review.notice && <ProblemCard tone="attention" title={review.notice} />}
      {read.status === "loading" && (
        <div role="status" className="rounded-lg border bg-background px-3.5 py-2.5">
          <StatusBadge kind="checking">Checking which issues would start…</StatusBadge>
        </div>
      )}
      {read.status === "failed" && <ProblemCard tone="error" icon={CircleX} title={read.message} />}
      {read.status === "answered" && (
        <>
          <SharedRepositoryCard repository={review.repository} warnings={read.preview.warnings} />
          <PreviewResult preview={read.preview} />
        </>
      )}
    </DialogContent>
  );
}

/** The answer to `load`; a review opened again with another `load` shows loading until it answers. */
function usePreview(load: () => Promise<TriggerPreview>): PreviewRead {
  const [read, setRead] = useState<{ load: typeof load; read: PreviewRead } | null>(null);
  useEffect(() => {
    let current = true;
    load().then(
      (preview) => current && setRead({ load, read: { status: "answered", preview } }),
      (cause: unknown) =>
        current &&
        setRead({
          load,
          read: {
            status: "failed",
            message:
              cause instanceof Error ? cause.message : "Factory could not preview this Trigger.",
          },
        }),
    );
    return () => {
      current = false;
    };
  }, [load]);
  return read?.load === load ? read.read : { status: "loading" };
}

function PreviewResult({ preview }: { preview: TriggerPreview }) {
  const { problem, issues } = preview;
  return (
    <>
      {problem ? (
        <ProblemCard tone="error" icon={CircleX} title={problemHeadline(problem)}>
          {problem.message} The check will show this problem and start nothing until it is fixed.
        </ProblemCard>
      ) : (
        <section aria-labelledby="trigger-review-issues" className="grid gap-3.5">
          <h3 id="trigger-review-issues" className="text-xs text-muted-foreground">
            {issues.length === 0
              ? "No issues ready"
              : `${issues.length} ${issues.length === 1 ? "issue" : "issues"} ready`}
          </h3>
          <ul className="divide-y overflow-hidden rounded-lg border bg-background">
            {issues.length === 0 ? (
              <li className="px-3.5 py-3 text-sm text-muted-foreground">
                No open issue matches right now.
              </li>
            ) : (
              issues.map((issue) => <PreviewIssue key={issue.issue} issue={issue} />)
            )}
          </ul>
        </section>
      )}
    </>
  );
}

function PreviewIssue({ issue }: { issue: TriggerPreviewIssue }) {
  const startsNow = issue.admission === "starts_now";
  return (
    <li className="flex h-10 items-center gap-3 px-3.5">
      <span className="w-12 shrink-0 font-mono text-label text-muted-foreground">
        #{issue.number}
      </span>
      <TextLink
        href={issue.url}
        tone="neutral"
        trailingIcon={ExternalLink}
        className="min-w-0 flex-1 text-sm font-normal"
      >
        <span className="min-w-0 truncate">{issue.title}</span>
      </TextLink>
      <span className={`${captionClass} shrink-0`}>{openedAgo(issue.createdAt)}</span>
      {startsNow ? (
        <StatusBadge kind="info">Starts now</StatusBadge>
      ) : (
        <StatusBadge kind="neutral" icon={CirclePause}>
          Waits
        </StatusBadge>
      )}
    </li>
  );
}
