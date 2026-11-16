import type { FlowDuplicatePlanAgent, Result } from "@t3-factory/contracts";

/**
 * The owning Project of a Flow or Agent: the Factory Project id it belongs to, or null for a
 * global Flow or global Agent.
 */
export type OwningProject = string | null;

/**
 * The placement rule: any Flow may place a global Agent, and a Project Flow may also place the
 * Agents of its own owning Project. A global Flow therefore places only global Agents.
 */
export function mayPlaceAgent(flowProject: OwningProject, agentProject: OwningProject): boolean {
  return agentProject === null || agentProject === flowProject;
}

/**
 * How Flow Duplicate treats an Agent owned by `agentProject` in a copy owned by `target`: an Agent
 * the target may not place is always copied, a global Agent is kept unless the user copies it, and
 * an Agent of the target Project itself is always kept.
 */
export function duplicateTreatment(
  target: OwningProject,
  agentProject: OwningProject,
): Pick<FlowDuplicatePlanAgent, "choice" | "changeable"> {
  if (!mayPlaceAgent(target, agentProject)) return { choice: "copy", changeable: false };
  return { choice: "keep", changeable: agentProject === null };
}

const INVALID_OWNER = "Send a Factory Project id as projectId, or null for a global definition.";

/** A create's owning Project: an omitted `projectId` creates a global definition. */
export function parseOwningProject(input: unknown): Result<OwningProject> {
  const target = parseTargetOwner(input);
  return target.ok ? { ok: true, value: target.value ?? null } : target;
}

/**
 * The target owner of a Duplicate or Import: a Factory Project id, null for Global, or undefined
 * when `projectId` is omitted and the operation's default applies.
 */
export function parseTargetOwner(input: unknown): Result<OwningProject | undefined> {
  const projectId =
    typeof input === "object" && input !== null && "projectId" in input
      ? input.projectId
      : undefined;
  if (projectId === undefined || projectId === null) return { ok: true, value: projectId };
  if (typeof projectId === "string" && projectId.length > 0 && projectId.length <= 256)
    return { ok: true, value: projectId };
  return {
    ok: false,
    error: {
      code: "validation",
      message: INVALID_OWNER,
      issues: [{ code: "invalid_project", path: "projectId", message: INVALID_OWNER }],
    },
  };
}
