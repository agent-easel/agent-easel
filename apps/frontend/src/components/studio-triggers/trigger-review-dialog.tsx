import { useEffect, useState } from "react";
import { CirclePause, CircleX, Info, TriangleAlert } from "lucide-react";
import type { TriggerPreview, TriggerPreviewIssue } from "@t3-factory/contracts";
import { MutationGate } from "@/client-gate";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "../status-badge.tsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { sectionLabelClass } from "../page.tsx";
import { openedAgo, problemHeadline } from "./trigger-text.ts";

/** What one review shows and how it commits. */
export interface TriggerReview {
  /** "Enable “Implement ready issues”?" */
  readonly title: string;
  /** Project · repository · Flow · schedule · limit. */
  readonly summary: string;
  readonly query: string;
  readonly readyLabel: string;
  readonly confirmLabel: "Enable and check" | "Apply and check";
  /** Asks Factory what a check with the reviewed settings would start now. */
  readonly load: () => Promise<TriggerPreview>;
  /** Create offers saving without enabling instead. */
  readonly saveDisabled?: () => void;
  /** Why the review opened again, such as settings saved elsewhere after the last one. */
  readonly notice?: string;
}

type PreviewRead =
  | { readonly status: "loading" }
  | { readonly status: "answered"; readonly preview: TriggerPreview }
  | { readonly status: "failed"; readonly message: string };

const captionClass = "text-2xs leading-tight tracking-label text-subtle-foreground";

/**
 * Figma T04: the issues a check would start now, oldest first, marked Starts now or Waits, before
 * enabling a Trigger or applying an edit that widens what can start. Nothing starts until the
 * author confirms; confirming also runs the first check.
 */
export function TriggerReviewDialog({
  review,
  busy,
  onConfirm,
  onCancel,
}: {
  review: TriggerReview | null;
  busy: boolean;
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
        <ReviewBody review={review} busy={busy} onConfirm={onConfirm} onCancel={onCancel} />
      )}
    </Dialog>
  );
}

function ReviewBody({
  review,
  busy,
  onConfirm,
  onCancel,
}: {
  review: TriggerReview;
  busy: boolean;
  onConfirm: (preview: TriggerPreview) => void;
  onCancel: () => void;
}) {
  const read = usePreview(review.load);
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
            {review.saveDisabled && (
              <Button variant="outline" disabled={busy} onClick={review.saveDisabled}>
                Save disabled
              </Button>
            )}
            <Button
              disabled={busy || read.status !== "answered"}
              onClick={() => read.status === "answered" && onConfirm(read.preview)}
            >
              {busy ? "Checking…" : review.confirmLabel}
            </Button>
          </MutationGate>
        </>
      }
    >
      {review.notice && (
        <Alert variant="attention" role="status">
          <TriangleAlert aria-hidden />
          <AlertDescription className="text-foreground">{review.notice}</AlertDescription>
        </Alert>
      )}
      {read.status === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking which issues would start…
        </p>
      )}
      {read.status === "failed" && (
        <Alert variant="critical">
          <CircleX aria-hidden />
          <AlertDescription className="text-foreground">{read.message}</AlertDescription>
        </Alert>
      )}
      {read.status === "answered" && <PreviewResult review={review} preview={read.preview} />}
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

function PreviewResult({ review, preview }: { review: TriggerReview; preview: TriggerPreview }) {
  const { problem, issues } = preview;
  return (
    <>
      <AuthorFilterNotice review={review} preview={preview} />
      {problem ? (
        <Alert variant="critical">
          <CircleX aria-hidden />
          <AlertTitle>{problemHeadline(problem)}</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            {problem.message} The check will show this problem and start nothing until it is fixed.
          </AlertDescription>
        </Alert>
      ) : (
        <section aria-labelledby="trigger-review-issues" className="grid gap-3.5">
          <h3 id="trigger-review-issues" className={sectionLabelClass}>
            {issues.length === 0
              ? "No issues ready"
              : `${issues.length} ${issues.length === 1 ? "issue" : "issues"} ready · oldest first`}
          </h3>
          <ul className="divide-y overflow-hidden rounded-lg border bg-background">
            {issues.length === 0 ? (
              <li className="px-3.5 py-3 text-sm text-muted-foreground">
                No open issue matches right now. Issues that get {review.readyLabel} later start at
                the next check.
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

/** The query's author filter, or the warning that it is missing on a public repository. */
function AuthorFilterNotice({
  review,
  preview,
}: {
  review: TriggerReview;
  preview: TriggerPreview;
}) {
  const title = (
    <AlertTitle>
      Only issues matching <span className="font-mono text-label">{review.query}</span> can start
    </AlertTitle>
  );
  const [warning] = preview.warnings;
  if (warning)
    return (
      <Alert variant="attention">
        <TriangleAlert aria-hidden />
        {title}
        <AlertDescription className="text-muted-foreground">{warning.message}</AlertDescription>
      </Alert>
    );
  const me =
    preview.login && review.query.includes("@me") ? `Right now @me is ${preview.login}. ` : "";
  return (
    <Alert variant="info">
      <Info aria-hidden />
      {title}
      <AlertDescription className="text-muted-foreground">
        {me}Without an author filter, anyone whose issue gets {review.readyLabel} could start Runs
        on this host — on a public repository that includes issue templates.
      </AlertDescription>
    </Alert>
  );
}

function PreviewIssue({ issue }: { issue: TriggerPreviewIssue }) {
  const startsNow = issue.admission === "starts_now";
  return (
    <li className="flex h-10 items-center gap-3 px-3.5">
      <span className="w-12 shrink-0 font-mono text-label text-muted-foreground">
        #{issue.number}
      </span>
      <a
        href={issue.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
      >
        {issue.title}
      </a>
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
