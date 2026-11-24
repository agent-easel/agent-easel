import type { TriggerDefinition, UpdateTriggerInput } from "@agent-easel/contracts";

/**
 * Whether an edit of a saved Trigger widens what can start, so its author reviews the issues
 * before it applies: another repository or Project, query or Flow, or a higher Max active Runs.
 * Renaming, schedule changes and a lower limit save directly; later saved revisions of the Flow
 * and its Agents never ask again, as with New Run.
 */
export function widensAdmission(saved: TriggerDefinition, edit: UpdateTriggerInput) {
  return (
    edit.projectId !== saved.projectId ||
    edit.github.repositoryNodeId !== saved.github.repository.nodeId ||
    edit.github.query !== saved.github.query ||
    edit.flowId !== saved.flowId ||
    edit.maxActiveRuns > saved.maxActiveRuns
  );
}

/** The saved settings of `trigger` as an edit from its current revision, for a preview. */
export const currentSettings = (trigger: TriggerDefinition): UpdateTriggerInput => ({
  expectedRevision: trigger.revision,
  kind: trigger.kind,
  name: trigger.name,
  projectId: trigger.projectId,
  flowId: trigger.flowId,
  schedule: trigger.schedule,
  maxActiveRuns: trigger.maxActiveRuns,
  github: { repositoryNodeId: trigger.github.repository.nodeId, query: trigger.github.query },
});
