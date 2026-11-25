import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FolderGit2, Plus, X } from "lucide-react";
import type {
  AgentCapabilities,
  AgentExecutionSettings,
  AgentProjectOverride,
  FactoryProject,
} from "@agent-easel/contracts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { agentRuntimeMeta } from "@/lib/agent-display";
import { cn } from "@/lib/utils";
import { executionChoices, executionEdits, offeredExecution } from "../../agent-draft.ts";
import { studioOwner } from "../../studio-definitions.ts";
import { ExecutionSettingsFields, SelectRow } from "../execution-settings-fields.tsx";
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

/** The 28 px icon button that removes a row; its padding makes the target larger than the icon. */
export const removeIconButtonClass =
  "size-7 text-muted-foreground hover:text-destructive [&_svg]:size-3.5";

/**
 * Figma SA06e: a global Agent's Project overrides in its Worker picker, one row per Project in
 * brand cyan with its display summary. A row opens the override's dialog; its ✕ takes it out of
 * the draft. Changes stay in the draft until the Agent is saved, like every other field.
 */
export function ProjectOverridesSection({
  overrides,
  projects,
  capabilities,
  needsModel,
  disabled,
  onEdit,
  onRemove,
}: {
  overrides: readonly AgentProjectOverride[];
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
  /** The Agent has no settings of its own, so nothing can be overridden yet. */
  needsModel: boolean;
  disabled: boolean;
  onEdit: (editing: OverrideEditing) => void;
  onRemove: (projectId: string) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const addable = addableProjects(projects, overrides);
  // Removing a row removes the focused Remove button. The draft renders first, so focus lands on
  // **Override for a Project…** only once it is enabled again, else on the first control left.
  function remove(projectId: string) {
    flushSync(() => onRemove(projectId));
    const enabled = (selector: string) => list.current?.querySelector<HTMLElement>(selector);
    (enabled("button:enabled[data-add]") ?? enabled("button:enabled"))?.focus();
  }
  return (
    <section aria-labelledby="project-overrides-heading" className="grid min-w-0 gap-1.5">
      <h3 id="project-overrides-heading" className="text-2xs font-medium text-muted-foreground">
        Project overrides
      </h3>
      <ul ref={list} aria-label="Project overrides" className="grid min-w-0 gap-0.5">
        {overrides.map((override) => {
          const owner = studioOwner(override.projectId, projects);
          const worker =
            agentRuntimeMeta(offeredExecution(override.execution, capabilities), capabilities) ||
            "Needs a model";
          return (
            <li
              key={override.projectId}
              className="flex min-w-0 items-center gap-1 rounded-md bg-accent/60 pr-1"
            >
              <button
                type="button"
                disabled={disabled}
                // The label replaces the row's text, so it names the override's Worker too.
                aria-label={`Edit override for ${owner.title}: ${worker}`}
                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus-ring disabled:opacity-50"
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
                <span className="min-w-0 truncate text-2xs text-subtle-foreground">{worker}</span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`Remove override for ${owner.title}`}
                className={removeIconButtonClass}
                onClick={() => remove(override.projectId)}
              >
                <X aria-hidden strokeWidth={1.5} />
              </Button>
            </li>
          );
        })}
        <li className="flex min-w-0">
          <button
            data-add
            type="button"
            disabled={disabled || needsModel || addable.length === 0}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-ring disabled:pointer-events-none disabled:opacity-50"
            onClick={() => onEdit({ projectId: null, isNew: true })}
          >
            <Plus aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-muted-foreground" />
            Override for a Project…
          </button>
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
  const [settings, setSettings] = useState(() => offeredExecution(initial.execution, capabilities));
  const choices = executionChoices(capabilities, settings);
  const complete = Boolean(
    projectId && settings.environmentId && settings.providerInstanceId && settings.modelId,
  );
  const title = studioOwner(projectId, projects).title;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={projectChoices.length ? "Override for a Project" : `Override for ${title}`}
        actions={
          <>
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
          </>
        }
      >
        <ExecutionSettingsFields
          role="override"
          saving={false}
          leading={
            projectChoices.length > 0 && (
              <SelectRow
                id="override-project"
                label="Project"
                value={projectId}
                choices={projectChoices.map((project) => ({
                  id: project.id,
                  label: studioOwner(project.id, projects).title,
                }))}
                onChange={setProjectId}
                disabled={false}
              />
            )
          }
          settings={{
            ...choices,
            execution: settings,
            setEnvironmentId: (id) => setSettings(executionEdits.environment(settings, id)),
            chooseProvider: (id) => setSettings(executionEdits.provider(settings, choices, id)),
            chooseModel: (id) => setSettings(executionEdits.model(settings, choices, id)),
            setOption: (id, value) => setSettings(executionEdits.option(settings, id, value)),
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
