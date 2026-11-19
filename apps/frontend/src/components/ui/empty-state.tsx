import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps =
  | {
      /** A whole list or preview is empty. */
      size: "large";
      icon: LucideIcon;
      title: string;
      body?: string;
      action?: ReactNode;
    }
  | {
      /** A panel list is empty for a reason worth explaining, so the body is required. */
      size: "compact";
      title: string;
      body: string;
    };

/**
 * An empty list, panel or preview in a dashed frame. A one-line hint without an explanation is
 * plain status text, not an EmptyState.
 */
export function EmptyState(props: EmptyStateProps) {
  if (props.size === "compact")
    return (
      <div
        role="status"
        className="grid gap-1 rounded-lg border border-dashed px-2.5 py-3.5 wrap-anywhere"
      >
        <p className="text-sm leading-tight font-medium text-muted-foreground">{props.title}</p>
        <p className="text-2xs leading-tight tracking-label text-muted-foreground">{props.body}</p>
      </div>
    );
  const { icon: Icon, title, body, action } = props;
  return (
    <div className="flex min-h-70 w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center">
      <span className="flex size-9 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
        <Icon aria-hidden className="size-4" strokeWidth={1.5} />
      </span>
      <h2 className="text-title font-semibold text-foreground">{title}</h2>
      {body && (
        <p className="max-w-80 text-2xs leading-tight tracking-label wrap-anywhere text-muted-foreground">
          {body}
        </p>
      )}
      {action}
    </div>
  );
}
