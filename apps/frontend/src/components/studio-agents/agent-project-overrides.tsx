import { useState, type Ref } from "react";
import { FolderGit2, Plus, X } from "lucide-react";
import type {
  AgentCapabilities,
  AgentExecutionSettings,
  AgentProjectOverride,
  FactoryProject,
} from "@t3-factory/contracts";
import { ChoiceMenu } from "@/components/choice-menu";
import { fieldLabelClass } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { agentRuntimeMeta } from "@/lib/agent-display";
import { cn } from "@/lib/utils";
import { executionChoices, executionEdits } from "../../agent-draft.ts";
import { studioOwner } from "../../studio-definitions.ts";
import { ExecutionSettingsFields } from "../execution-settings-fields.tsx";
import { ownerName } from "../studio-owner.tsx";

/** The override the dialog edits: a new one (no Project chosen yet) or a listed one. */
export type OverrideEditing = { readonly projectId: string | null; readonly isNew: boolean };

/** The available Projects a new override may name: those without one yet. */
function addableProjects(
  projects: readonly FactoryProject[],
  overrides: readonly AgentProjectOverride[],
): readonly FactoryProject[] {
  return projects.filter(
    (project) =>
      project.availability === "available" &&
      !overrides.some((override) => override.projectId === project.id),
  );
}

/** Override rows are full-width ghost buttons laid out like menu items (Figma SA01b). */
const rowLayout = "min-w-0 flex-1 justify-start px-2 font-normal";

/**
 * Figma SA01b: a global Agent's Project overrides in its model picker, one row per Project with
 * its provider · model · effort. A row opens the override's dialog; Remove takes it out of the
 * draft. Changes stay in the draft until the Agent is saved, like every other field.
 */
export function ProjectOverridesSection({
  overrides,
  projects,
  capabilities,
  needsModel,
  disabled,
  addRef,
  onEdit,
  onRemove,
}: {
  overrides: readonly AgentProjectOverride[];
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
  /** The Agent has no settings of its own, so nothing can be overridden yet. */
  needsModel: boolean;
  disabled: boolean;
  /** **Override for a Project…**, which keeps focus in the picker after a row is removed. */
  addRef: Ref<HTMLButtonElement>;
  onEdit: (editing: OverrideEditing) => void;
  onRemove: (projectId: string) => void;
}) {
  const addable = addableProjects(projects, overrides);
  const addBlocked = needsModel
    ? "Choose this Agent's own Worker first."
    : addable.length
      ? null
      : "Every available Project already has an override.";
  return (
    <section aria-labelledby="project-overrides-heading" className="grid min-w-0 gap-2.5">
      <h3
        id="project-overrides-heading"
        className="text-overline font-semibold text-subtle-foreground uppercase"
      >
        Project overrides
      </h3>
      <ul aria-label="Project overrides" className="grid min-w-0">
        {overrides.map((override) => {
          const owner = studioOwner(override.projectId, projects);
          const worker = agentRuntimeMeta(override.execution, capabilities);
          return (
            <li key={override.projectId} className="group flex min-w-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                // The label replaces the row's text, so it names the override's Worker too.
                aria-label={`Edit override for ${owner.title}: ${worker}`}
                title={owner.unavailable ?? undefined}
                className={rowLayout}
                onClick={() => onEdit({ projectId: override.projectId, isNew: false })}
              >
                <FolderGit2
                  aria-hidden
                  strokeWidth={1.5}
                  className={cn(
                    "size-4 shrink-0",
                    owner.unavailable ? "text-attention" : "text-brand-cyan",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    owner.unavailable ? "text-attention" : "text-brand-cyan",
                  )}
                >
                  {ownerName(owner)}
                </span>
                <span className="min-w-0 truncate text-2xs tracking-label text-subtle-foreground">
                  {worker}
                </span>
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={disabled}
                    aria-label={`Remove override for ${owner.title}`}
                    // Visible on row hover or keyboard focus; never removed, so Tab still reaches it.
                    className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => onRemove(override.projectId)}
                  >
                    <X aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove override for {owner.title}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
        <li className="flex min-w-0">
          <Button
            ref={addRef}
            type="button"
            variant="ghost"
            disabled={disabled || addBlocked !== null}
            className={rowLayout}
            onClick={() => onEdit({ projectId: null, isNew: true })}
          >
            <Plus aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">Override for a Project…</span>
            {addBlocked && (
              <span className="text-2xs tracking-label text-subtle-foreground">{addBlocked}</span>
            )}
          </Button>
        </li>
      </ul>
    </section>
  );
}

/**
 * Adds or edits one override. It lives outside the model picker's popover, which closes when the
 * dialog opens.
 */
export function OverrideDialog({
  editing,
  overrides,
  execution,
  projects,
  capabilities,
  onClose,
  onApply,
}: {
  editing: OverrideEditing;
  overrides: readonly AgentProjectOverride[];
  /** The Agent's own settings, which a new override starts from. */
  execution: AgentExecutionSettings;
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
  onClose: () => void;
  onApply: (override: AgentProjectOverride) => void;
}) {
  const projectChoices = editing.isNew ? addableProjects(projects, overrides) : [];
  const initial = overrides.find((override) => override.projectId === editing.projectId) ?? {
    projectId: projectChoices[0]?.id ?? "",
    execution: { ...execution },
  };
  const [projectId, setProjectId] = useState(initial.projectId);
  const [settings, setSettings] = useState(initial.execution);
  const choices = executionChoices(capabilities, settings);
  const complete = Boolean(
    projectId && settings.environmentId && settings.providerInstanceId && settings.modelId,
  );
  const title = studioOwner(projectId, projects).title;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {projectChoices.length ? "Override for a Project" : `Override for ${title}`}
          </DialogTitle>
          <DialogDescription>
            Runs in this Project use these settings instead of the Agent's Worker. Save the Agent to
            apply them.
          </DialogDescription>
        </DialogHeader>
        <div className="@container/agent-form grid gap-3.5">
          {projectChoices.length > 0 && (
            <div className="grid gap-1.5">
              <span className={fieldLabelClass}>Project</span>
              <ChoiceMenu
                id="override-project"
                label="Project"
                value={projectId}
                choices={projectChoices.map((project) => ({
                  id: project.id,
                  label: studioOwner(project.id, projects).title,
                }))}
                onChange={setProjectId}
                disabled={false}
                placeholder="Choose a Project…"
              />
            </div>
          )}
          <ExecutionSettingsFields
            role="override"
            capabilities={capabilities}
            saving={false}
            settings={{
              ...choices,
              execution: settings,
              needsModel: false,
              setEnvironmentId: (id) => setSettings(executionEdits.environment(settings, id)),
              chooseProvider: (id) => setSettings(executionEdits.provider(settings, choices, id)),
              chooseModel: (id) => setSettings(executionEdits.model(settings, choices, id)),
              setOption: (id, value) => setSettings(executionEdits.option(settings, id, value)),
              removeOption: (id) => setSettings(executionEdits.removeOption(settings, id)),
              clearWorker: () => undefined,
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!complete}
            onClick={() => onApply({ projectId, execution: settings })}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
