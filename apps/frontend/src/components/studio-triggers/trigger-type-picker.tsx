import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { StudioBackLink, StudioLink } from "../app-link.tsx";
import { SettingsPage } from "../settings-page.tsx";
import { GitHubMark } from "./github-mark.tsx";
import { useTriggerReadiness } from "./use-trigger-readiness.ts";

/** Figma T03a: New Trigger asks for the type; GitHub Issues is the only one. */
export function TriggerTypePicker() {
  return (
    <main className="grid content-start gap-4 px-8 pt-6 pb-8 max-sm:px-4">
      <StudioBackLink selection={{ tab: "triggers" }}>All Triggers</StudioBackLink>
      <SettingsPage
        title="New Trigger"
        description="Choose what starts the Flow. More trigger types can come later."
      >
        <StudioLink
          selection={{ tab: "triggers", triggerId: "new", kind: "github_issues" }}
          className="flex items-center gap-3.5 rounded-xl border bg-card px-4.5 py-4 text-foreground no-underline transition-colors hover:border-border-hover hover:bg-accent hover:no-underline"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted">
            <GitHubMark className="size-5" />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.75">
            <span className="text-base leading-tight font-semibold tracking-[-0.26px]">
              GitHub Issues
            </span>
            <span className="text-sm leading-tight text-subtle-foreground">
              Start a Flow for open issues in a Project&apos;s GitHub repository that match a query.
              Read with gh on the Factory host — no AI, never writes to GitHub.
            </span>
            <GitHubReadiness />
          </span>
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
          />
        </StudioLink>
      </SettingsPage>
    </main>
  );
}

/** Whether `gh` on the Factory host is found and signed in, and as whom. */
function GitHubReadiness() {
  const read = useTriggerReadiness("", "");
  const gitHub = read.status === "answered" ? read.readiness.gitHub : null;
  const text =
    read.status === "checking"
      ? "Checking gh on the Factory host…"
      : read.status === "failed"
        ? read.message
        : gitHub?.ready
          ? `gh found · signed in as ${gitHub.login}`
          : gitHub?.problem;
  return (
    <span className="flex items-center gap-1.5 text-2xs leading-tight tracking-label text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          read.status === "checking"
            ? "bg-subtle-foreground"
            : gitHub?.ready
              ? "bg-success"
              : "bg-destructive",
        )}
      />
      {text}
    </span>
  );
}
