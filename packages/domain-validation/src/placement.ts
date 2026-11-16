import type { Result } from "@t3-factory/contracts";

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

const INVALID_OWNER = "Send a Factory Project id as projectId, or null for a global definition.";

/** A create's owning Project: an omitted `projectId` creates a global definition. */
export function parseOwningProject(input: unknown): Result<OwningProject> {
  const projectId =
    typeof input === "object" && input !== null && "projectId" in input
      ? input.projectId
      : undefined;
  if (projectId === undefined || projectId === null) return { ok: true, value: null };
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
