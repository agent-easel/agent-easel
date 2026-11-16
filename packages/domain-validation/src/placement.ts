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
