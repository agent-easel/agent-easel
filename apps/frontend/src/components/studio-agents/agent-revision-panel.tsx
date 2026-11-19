import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type {
  AgentCapabilities,
  AgentDefinition,
  AgentExecutionSettings,
  AgentModelOptionDescriptor,
  AgentModelOptionValue,
  FactoryProject,
} from "@t3-factory/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { optionValue, resolveAgentModel } from "@t3-factory/domain-validation";
import { modelOptionLabel } from "@/lib/agent-display";
import { revisionExitLines, revisionLine, type RevisionLine } from "../../revision-diff.ts";
import { RevisionComparison } from "../revision-comparison.tsx";
import type { AgentContent, AgentDraftModel, AgentDraftSnapshot } from "../../agent-draft.ts";
import { studioOwner } from "../../studio-definitions.ts";
import { TextLink } from "@/components/ui/text-link";
import { ProblemCard } from "../problem-card.tsx";

const updatedNoticeMs = 4000;

/** One side of the comparison; a saved revision without a model has no execution. */
type ComparedContent = Omit<AgentContent, "execution"> & {
  readonly execution: AgentContent["execution"] | null;
};

function workerOptionLines(
  options: readonly AgentModelOptionValue[],
  descriptors: readonly AgentModelOptionDescriptor[],
): RevisionLine[] {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const saved = new Set(options.map((option) => option.id));
  return [
    ...options.map((option) => {
      const descriptor = byId.get(option.id);
      const value = descriptor ? modelOptionLabel(descriptor, option.value) : String(option.value);
      return revisionLine(`  ${descriptor?.label ?? "Unknown option"}  ${value}`, option);
    }),
    ...descriptors
      .filter((descriptor) => !saved.has(descriptor.id))
      .map((descriptor) => {
        const value = optionValue(options, descriptor);
        return revisionLine(
          `  ${descriptor.label}  ${modelOptionLabel(descriptor, value)} · Default`,
          descriptor.id,
        );
      }),
  ];
}

/** Display every saved Worker setting, including options missing from the current catalog. */
function workerLines(
  settings: AgentExecutionSettings | null,
  capabilities: AgentCapabilities | null,
): RevisionLine[] {
  if (!settings || (!settings.environmentId && !settings.providerInstanceId && !settings.modelId))
    return ["  Needs a model"];
  const catalog = capabilities?.state === "ready" ? capabilities : null;
  const { provider, model } = resolveAgentModel(settings, catalog);
  const environment = catalog?.environments.find(
    (item) => item.environmentId === settings.environmentId,
  );
  return [
    revisionLine(
      `  Environment  ${environment?.label ?? "Unknown environment"}`,
      settings.environmentId,
    ),
    revisionLine(
      `  Provider  ${provider?.displayName ?? "Unknown provider"}`,
      settings.providerInstanceId,
    ),
    revisionLine(`  Model  ${model?.label ?? "Unknown model"}`, settings.modelId),
    ...workerOptionLines(settings.modelOptions, model?.options ?? []),
  ];
}

/** One side of the comparison, using labels for its stored references. */
export function comparedAgentLines(
  { name, prompt, execution, exits, projectOverrides }: ComparedContent,
  projects: readonly FactoryProject[],
  capabilities: AgentCapabilities | null,
): RevisionLine[] {
  const projectName = (projectId: string) => {
    const owner = studioOwner(projectId, projects);
    const alike = projects.filter(
      (project) => studioOwner(project.id, projects).title === owner.title,
    );
    return alike.length > 1 && owner.detail ? `${owner.title} (${owner.detail})` : owner.title;
  };
  return [
    `Name  ${name}`,
    "",
    "Worker",
    ...workerLines(execution, capabilities),
    ...(projectOverrides.length
      ? [
          "",
          "Project overrides",
          ...projectOverrides.flatMap((override) => [
            revisionLine(projectName(override.projectId), override.projectId),
            ...workerLines(override.execution, capabilities),
          ]),
        ]
      : []),
    "",
    "Exits",
    ...exits.flatMap((exit) => revisionExitLines(exit, "  ")),
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
      <ProblemCard
        tone="attention"
        title={
          revision === null
            ? "A newer revision was saved elsewhere"
            : `Revision ${revision} was saved elsewhere`
        }
        action={
          conflict.status === "comparing" ? (
            <span role="status">Loading the latest revision…</span>
          ) : (
            <TextLink
              trailing="chevron"
              onClick={() => {
                setComparisonOpen(true);
                draft.compare();
              }}
            >
              Compare latest revision
            </TextLink>
          )
        }
      >
        Your changes are kept. Compare them before saving.
      </ProblemCard>
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
  const mine = comparedAgentLines(content, projects, capabilities);
  const theirs = comparedAgentLines(latest, projects, capabilities);
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
        <RevisionComparison mine={mine} theirs={theirs} revision={revision} />
      </DialogContent>
    </Dialog>
  );
}
