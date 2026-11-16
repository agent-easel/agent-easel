import type { ChangeOwnerInput, Result, ValidationIssue } from "@t3-factory/contracts";

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

const ownerIssue = (path: string): ValidationIssue => ({
  code: "invalid_project",
  path,
  message: `Send a Factory Project id as ${path}, or null for a global definition.`,
});
const invalid = (issues: readonly ValidationIssue[]): Result<never> => ({
  ok: false,
  error: { code: "validation", message: issues[0]!.message, issues },
});

/** The owning Project named by field `path`, which must be present unless `optional`. */
function ownerField(input: unknown, path: string, optional: boolean): Result<OwningProject> {
  const value =
    typeof input === "object" && input !== null && path in input
      ? (input as Record<string, unknown>)[path]
      : undefined;
  if (value === null || (optional && value === undefined)) return { ok: true, value: null };
  if (typeof value === "string" && value.length > 0 && value.length <= 256)
    return { ok: true, value };
  return invalid([ownerIssue(path)]);
}

/** A create's owning Project: an omitted `projectId` creates a global definition. */
export function parseOwningProject(input: unknown): Result<OwningProject> {
  return ownerField(input, "projectId", true);
}

/** The owning Project a save expects, which it must name explicitly (null for global). */
export function parseExpectedOwner(input: unknown): Result<OwningProject> {
  return ownerField(input, "expectedProjectId", false);
}

/** Change owner names both the owning Project the client saw and the new one (null for global). */
export function validateChangeOwner(input: unknown): Result<ChangeOwnerInput> {
  const expected = parseExpectedOwner(input);
  const target = ownerField(input, "projectId", false);
  if (expected.ok && target.ok)
    return { ok: true, value: { expectedProjectId: expected.value, projectId: target.value } };
  return invalid([
    ...(expected.ok ? [] : expected.error.issues),
    ...(target.ok ? [] : target.error.issues),
  ]);
}
