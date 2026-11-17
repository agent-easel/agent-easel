import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import type {
  AgentDefinition,
  AgentExecutionSettings,
  FactoryProject,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DialogFooter, DialogHeader } from "@/components/ui/dialog";
import type { AgentContent, AgentDraftModel, AgentDraftSnapshot } from "../../agent-draft.ts";
import { studioOwner } from "../../studio-definitions.ts";

const updatedNoticeMs = 4000;

/** One side of the comparison; a saved revision without a model has no execution. */
type ComparedContent = Omit<AgentContent, "execution"> & {
  readonly execution: AgentContent["execution"] | null;
};

const optionList = (execution: AgentExecutionSettings | null) =>
  (execution?.modelOptions ?? []).map(({ id, value }) => `${id}=${String(value)}`).join(", ") ||
  "(none)";

/** How one side of the comparison reads: every saved field, read-only, prompt last. */
export function comparedPresentation(
  { name, prompt, execution, exits, projectOverrides }: ComparedContent,
  projects: readonly FactoryProject[],
) {
  const projectName = (projectId: string) =>
    projects.some((project) => project.id === projectId)
      ? studioOwner(projectId, projects).title
      : `Unknown Project ${projectId}`;
  const overrideLines = projectOverrides.map(
    ({ projectId, execution: settings }) =>
      `  ${projectName(projectId)}: ${settings.environmentId} · ${settings.providerInstanceId} · ${settings.modelId} · ${optionList(settings)}`,
  );
  const exitLines = exits.map(
    (exit) =>
      `  ${exit.name || "(unnamed)"}${exit.messageRequired ? " · message required" : ""}${exit.description ? ` — ${exit.description}` : ""}`,
  );
  return [
    `Name: ${name}`,
    `Environment: ${execution?.environmentId || "(none)"}`,
    `Provider: ${execution?.providerInstanceId || "(none)"}`,
    `Model: ${execution?.modelId || "(none)"}`,
    `Options: ${optionList(execution)}`,
    `Project overrides:${overrideLines.length ? "" : " (none)"}`,
    ...overrideLines,
    `Exits:${exitLines.length ? "" : " (none)"}`,
    ...exitLines,
    "Prompt:",
    prompt,
  ].join("\n");
}

function Presentation({
  title,
  content,
  projects,
}: {
  title: string;
  content: ComparedContent;
  projects: readonly FactoryProject[];
}) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-base font-semibold">{title}</h3>
      <pre
        aria-label={title}
        className="max-h-64 overflow-auto rounded-md border bg-muted p-2 font-mono text-2xs whitespace-pre-wrap break-words"
      >
        {comparedPresentation(content, projects)}
      </pre>
    </div>
  );
}

/**
 * The Agent editor's revision notices: a clean draft's brief "Updated to revision N", and for a
 * draft whose edits are kept while Factory holds a newer revision (saved elsewhere, or found by
 * a stale save) the comparison with that revision. Every action names the revision it shows.
 */
export function AgentRevisionPanel({
  draft,
  state,
  projects,
}: {
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
  /** Names each Project override in the comparison. */
  projects: readonly FactoryProject[];
}) {
  const { conflict, updatedTo } = state;
  useEffect(() => {
    if (updatedTo === null) return;
    const timer = setTimeout(() => draft.dismissUpdate(), updatedNoticeMs);
    return () => clearTimeout(timer);
  }, [draft, updatedTo]);
  if (conflict.status === "none")
    return updatedTo === null ? null : (
      <p
        role="status"
        className="flex shrink-0 items-center gap-1.5 px-4 pt-3 text-2xs text-muted-foreground sm:px-6 md:px-8"
      >
        <RefreshCw aria-hidden className="size-3.5 text-link" />
        Updated to revision {updatedTo}
      </p>
    );
  const revision =
    conflict.status === "compared"
      ? conflict.latest.revision
      : conflict.status === "detected"
        ? conflict.revision
        : null;
  return (
    <section
      aria-label="Reconcile Agent"
      className="grid shrink-0 gap-3 border-b border-attention/40 bg-attention/5 px-4 py-3 sm:px-6 md:px-8"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-foreground">
          <span className="font-medium">
            {revision !== null
              ? `Revision ${revision} was saved elsewhere.`
              : "Factory holds a newer revision of this Agent."}
          </span>{" "}
          Your edits are kept.
        </p>
        {conflict.status === "detected" && (
          <Button type="button" variant="outline" size="sm" onClick={draft.compare}>
            Compare latest revision
          </Button>
        )}
        {conflict.status === "comparing" && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading the latest revision…
          </p>
        )}
      </div>
      {conflict.status === "compared" && (
        <Comparison draft={draft} state={state} latest={conflict.latest} projects={projects} />
      )}
    </section>
  );
}

function Comparison({
  draft,
  state,
  latest,
  projects,
}: {
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
  latest: AgentDefinition;
  projects: readonly FactoryProject[];
}) {
  const { revision } = latest;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Presentation title="Your local draft" content={state.content} projects={projects} />
        <Presentation title={`Saved revision ${revision}`} content={latest} projects={projects} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => draft.requestLoadLatest(revision)}
        >
          Load latest revision
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => draft.keepEdits(revision)}>
          Keep my edits against revision {revision}
        </Button>
        <p className="text-xs text-muted-foreground">
          Keeping your edits requires another explicit Save. Reconcile any differences first.
        </p>
      </div>
      {/* Bound to the revision shown: a newer one closes it, so it never applies unseen. */}
      <AlertDialog
        open={state.confirmingLoad === revision}
        onOpenChange={(open) => {
          if (!open) draft.cancelLoadLatest();
        }}
      >
        <AlertDialogContent>
          <DialogHeader>
            <AlertDialogTitle>Load revision {revision}?</AlertDialogTitle>
            <AlertDialogDescription>
              Your unsaved edits to this Agent are discarded and replaced with saved revision{" "}
              {revision}.
            </AlertDialogDescription>
          </DialogHeader>
          <DialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button type="button" onClick={() => draft.loadLatest(revision)}>
              Load revision {revision}
            </Button>
          </DialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
