import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type {
  AgentCapabilities,
  AgentDefinition,
  AgentExecutionSettings,
  FactoryProject,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { agentRuntimeMeta } from "@/lib/agent-display";
import { cn } from "@/lib/utils";
import type { AgentContent, AgentDraftModel, AgentDraftSnapshot } from "../../agent-draft.ts";
import { studioOwner } from "../../studio-definitions.ts";
import { NoticeButton } from "../notice.tsx";
import { SettingsProblemCard } from "../settings-page.tsx";

const updatedNoticeMs = 4000;

/** One side of the comparison; a saved revision without a model has no execution. */
type ComparedContent = Omit<AgentContent, "execution"> & {
  readonly execution: AgentContent["execution"] | null;
};

/**
 * How one side of the comparison reads, line by line in display names: the Worker, Project
 * overrides, exits and the prompt. Projects sharing a title are told apart by their path.
 */
export function comparedLines(
  { name, prompt, execution, exits, projectOverrides }: ComparedContent,
  projects: readonly FactoryProject[],
  capabilities: AgentCapabilities | null,
): string[] {
  const worker = (settings: AgentExecutionSettings | null) =>
    (settings && agentRuntimeMeta(settings, capabilities)) || "Needs a model";
  const projectName = (projectId: string) => {
    const owner = studioOwner(projectId, projects);
    const alike = projects.filter(
      (project) => studioOwner(project.id, projects).title === owner.title,
    );
    return alike.length > 1 ? `${owner.title} (${owner.detail ?? projectId})` : owner.title;
  };
  return [
    `Name  ${name}`,
    `Worker  ${worker(execution)}`,
    ...(projectOverrides.length
      ? [
          "",
          "Project overrides",
          ...projectOverrides.map(
            (override) => `  ${projectName(override.projectId)}  ${worker(override.execution)}`,
          ),
        ]
      : []),
    "",
    "Exits",
    ...exits.map(
      (exit) =>
        `  ${exit.name || "(unnamed)"}${exit.messageRequired ? " · message required" : ""}${exit.description ? ` — ${exit.description}` : ""}`,
    ),
    "",
    "Prompt",
    ...prompt.split("\n").map((line) => `  ${line}`),
  ];
}

/** A clean draft's brief "Updated to revision N" after it followed a revision saved elsewhere. */
export function AgentUpdatedNotice({
  draft,
  state,
}: {
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
}) {
  const { updatedTo } = state;
  useEffect(() => {
    if (updatedTo === null) return;
    const timer = setTimeout(() => draft.dismissUpdate(), updatedNoticeMs);
    return () => clearTimeout(timer);
  }, [draft, updatedTo]);
  if (updatedTo === null) return null;
  return (
    <p role="status" className="flex items-center gap-1.5 text-2xs text-muted-foreground">
      <RefreshCw aria-hidden className="size-3.5 text-link" />
      Updated to revision {updatedTo}
    </p>
  );
}

/**
 * Figma SA06k: a draft whose edits are kept while Factory holds a newer revision (saved
 * elsewhere, or found by a stale save). Save waits until the revision is compared.
 */
export function AgentRevisionCard({
  draft,
  state,
  projects,
  capabilities,
}: {
  draft: AgentDraftModel;
  state: AgentDraftSnapshot;
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
}) {
  const { conflict } = state;
  const [comparisonOpen, setComparisonOpen] = useState(false);
  if (conflict.status === "none") return null;
  const revision =
    conflict.status === "compared"
      ? conflict.latest.revision
      : conflict.status === "detected"
        ? conflict.revision
        : null;
  return (
    <>
      <SettingsProblemCard
        tone="warning"
        title={
          revision === null
            ? "A newer revision was saved elsewhere"
            : `Revision ${revision} was saved elsewhere`
        }
        action={
          conflict.status === "comparing" ? (
            <span role="status">Loading the latest revision…</span>
          ) : (
            <NoticeButton
              onClick={() => {
                setComparisonOpen(true);
                draft.compare();
              }}
            >
              Compare latest revision
            </NoticeButton>
          )
        }
      >
        Your changes are kept. Compare them before saving.
      </SettingsProblemCard>
      {comparisonOpen && conflict.status === "compared" && (
        <CompareDialog
          draft={draft}
          content={state.content}
          latest={conflict.latest}
          projects={projects}
          capabilities={capabilities}
          onClose={() => setComparisonOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Figma SA06y: the draft beside the compared revision in the wide dialog, changed lines tinted.
 * **Load revision N** replaces the draft at once; **Keep my edits** keeps it against revision N.
 */
function CompareDialog({
  draft,
  content,
  latest,
  projects,
  capabilities,
  onClose,
}: {
  draft: AgentDraftModel;
  content: AgentContent;
  latest: AgentDefinition;
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
  onClose: () => void;
}) {
  const { revision } = latest;
  const mine = comparedLines(content, projects, capabilities);
  const theirs = comparedLines(latest, projects, capabilities);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="wide"
        title={`Compare with revision ${revision}`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                draft.keepEdits(revision);
                onClose();
              }}
            >
              Keep my edits
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                draft.loadLatest(revision);
                onClose();
              }}
            >
              Load revision {revision}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
          <ComparedSide title="Your draft" lines={mine} other={theirs} tone="removed" />
          <ComparedSide title={`Revision ${revision}`} lines={theirs} other={mine} tone="added" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComparedSide({
  title,
  lines,
  other,
  tone,
}: {
  title: string;
  lines: readonly string[];
  /** The other side's lines; a line missing there is tinted as changed. */
  other: readonly string[];
  tone: "removed" | "added";
}) {
  const present = new Set(other);
  return (
    <div className="grid min-w-0 gap-1.5">
      <h3 className="text-2xs font-medium text-muted-foreground">{title}</h3>
      <pre
        aria-label={title}
        className="min-w-0 overflow-hidden rounded-md border bg-background py-1.5 font-mono text-2xs leading-[1.4rem] whitespace-pre-wrap wrap-anywhere"
      >
        {lines.map((line, index) => {
          const changed = line !== "" && !present.has(line);
          return (
            <span
              key={index}
              data-changed={changed || undefined}
              className={cn(
                "block min-h-[1.4rem] px-3",
                changed && (tone === "removed" ? "bg-destructive/20" : "bg-success/20"),
              )}
            >
              {line}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
