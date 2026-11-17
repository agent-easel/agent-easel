import { useState } from "react";
import { Plus } from "lucide-react";
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
import { agentRuntimeMeta } from "@/lib/agent-display";
import { executionChoices, executionEdits } from "../../agent-draft.ts";
import { studioOwner } from "../../studio-definitions.ts";
import { ExecutionSettingsFields } from "../execution-settings-fields.tsx";
import { ownerName } from "../studio-owner.tsx";

/** The override the dialog edits: a new one (no Project chosen yet) or a listed one. */
type Editing = { readonly projectId: string | null; readonly isNew: boolean };

/**
 * Figma P08 Project overrides: a global Agent's Worker for Runs in particular Projects. Changes
 * stay in the draft until the Agent is saved, like every other field.
 */
export function AgentProjectOverrides({
  overrides,
  execution,
  projects,
  capabilities,
  needsModel,
  disabled,
  onSet,
  onRemove,
}: {
  overrides: readonly AgentProjectOverride[];
  /** The Agent's own settings, which a new override starts from. */
  execution: AgentExecutionSettings;
  projects: readonly FactoryProject[];
  capabilities: AgentCapabilities | null;
  /** The Agent has no settings of its own, so nothing can be overridden yet. */
  needsModel: boolean;
  disabled: boolean;
  onSet: (override: AgentProjectOverride) => void;
  onRemove: (projectId: string) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const addable = projects.filter(
    (project) =>
      project.availability === "available" &&
      !overrides.some((override) => override.projectId === project.id),
  );
  const editingOverride = overrides.find((override) => override.projectId === editing?.projectId);
  return (
    <section aria-labelledby="project-overrides-heading" className="grid min-w-0 gap-1.5">
      <div className="flex items-center gap-2">
        <h2 id="project-overrides-heading" className={fieldLabelClass}>
          Project overrides
        </h2>
        <span className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || needsModel || !addable.length}
          title={
            needsModel
              ? "Choose this Agent's own Worker first."
              : addable.length
                ? undefined
                : "Every available Project already has an override."
          }
          onClick={() => setEditing({ projectId: null, isNew: true })}
        >
          <Plus aria-hidden />
          Override for a Project
        </Button>
      </div>
      {overrides.length > 0 && (
        <div className="min-w-0 overflow-x-auto rounded-md border bg-muted">
          <table aria-label="Project overrides" className="w-full min-w-120 text-xs">
            <thead>
              <tr className="border-b bg-card text-left text-2xs text-muted-foreground">
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Project
                </th>
                <th scope="col" className="px-3 py-1.5 font-medium">
                  Worker
                </th>
                <th scope="col" className="w-32">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {overrides.map((override) => {
                const owner = studioOwner(override.projectId, projects);
                return (
                  <tr key={override.projectId} className="border-b last:border-b-0">
                    <td className="px-3 py-2 font-medium" title={owner.unavailable ?? undefined}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-full bg-brand-cyan"
                        />
                        {ownerName(owner)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {agentRuntimeMeta(override.execution, capabilities)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        aria-label={`Edit override for ${owner.title}`}
                        onClick={() => setEditing({ projectId: override.projectId, isNew: false })}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        aria-label={`Remove override for ${owner.title}`}
                        onClick={() => onRemove(override.projectId)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-2xs tracking-label text-subtle-foreground">
        Runs in any other Project use the Worker above. Name, prompt and exits are shared by every
        Project; a different prompt needs a Project Agent.
      </p>
      {editing && (
        <OverrideDialog
          key={`${editing.projectId ?? "new"}`}
          projectChoices={editing.isNew ? addable : []}
          projects={projects}
          initial={
            editingOverride ?? { projectId: addable[0]?.id ?? "", execution: { ...execution } }
          }
          capabilities={capabilities}
          onClose={() => setEditing(null)}
          onApply={(override) => {
            onSet(override);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function OverrideDialog({
  projectChoices,
  projects,
  initial,
  capabilities,
  onClose,
  onApply,
}: {
  /** The Projects a new override may name; empty while editing a listed one. */
  projectChoices: readonly FactoryProject[];
  projects: readonly FactoryProject[];
  initial: AgentProjectOverride;
  capabilities: AgentCapabilities | null;
  onClose: () => void;
  onApply: (override: AgentProjectOverride) => void;
}) {
  const [projectId, setProjectId] = useState(initial.projectId);
  const [execution, setExecution] = useState(initial.execution);
  const choices = executionChoices(capabilities, execution);
  const complete = Boolean(
    projectId && execution.environmentId && execution.providerInstanceId && execution.modelId,
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
              execution,
              needsModel: false,
              setEnvironmentId: (id) => setExecution(executionEdits.environment(execution, id)),
              chooseProvider: (id) => setExecution(executionEdits.provider(execution, choices, id)),
              chooseModel: (id) => setExecution(executionEdits.model(execution, choices, id)),
              setOption: (id, value) => setExecution(executionEdits.option(execution, id, value)),
              removeOption: (id) => setExecution(executionEdits.removeOption(execution, id)),
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
            onClick={() => onApply({ projectId, execution })}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
