import type {
  ChangeOwnerInput,
  FlowDuplicatePlanAgent,
  Result,
  ValidationIssue,
} from "@t3-factory/contracts";

/**
 * The owning Project of a Flow or Agent: the Factory Project id it belongs to, or null for a
 * global Flow or global Agent.
 */
export type OwningProject = string | null;

/** The longest Factory Project id an owner field accepts. */
export const OWNING_PROJECT_ID_LIMIT = 256;

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

const ownerIssue = (path: string): ValidationIssue => ({
  code: "invalid_project",
  path,
  message: `Send a Factory Project id as ${path}, or null for a global definition.`,
});
const invalid = (issues: readonly ValidationIssue[]): Result<never> => ({
  ok: false,
  error: { code: "validation", message: issues[0]!.message, issues },
});

/** The owning Project in field `path`: a Factory Project id, null, or undefined when omitted. */
function ownerField(input: unknown, path: string): Result<OwningProject | undefined> {
  const value =
    typeof input === "object" && input !== null && path in input
      ? (input as Record<string, unknown>)[path]
      : undefined;
  if (value === undefined || value === null) return { ok: true, value };
  if (typeof value === "string" && value.length > 0 && value.length <= OWNING_PROJECT_ID_LIMIT)
    return { ok: true, value };
  return invalid([ownerIssue(path)]);
}

/** The owning Project in field `path`, which must be named explicitly (null for global). */
function requiredOwner(input: unknown, path: string): Result<OwningProject> {
  const owner = ownerField(input, path);
  if (!owner.ok) return owner;
  return owner.value === undefined ? invalid([ownerIssue(path)]) : { ok: true, value: owner.value };
}

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
  return ownerField(input, "projectId");
}

/** The owning Project a save expects, which it must name explicitly (null for global). */
export function parseExpectedOwner(input: unknown): Result<OwningProject> {
  return requiredOwner(input, "expectedProjectId");
}

/** Change owner names both the owning Project the client saw and the new one (null for global). */
export function validateChangeOwner(input: unknown): Result<ChangeOwnerInput> {
  const expected = parseExpectedOwner(input);
  const target = requiredOwner(input, "projectId");
  if (expected.ok && target.ok)
    return { ok: true, value: { expectedProjectId: expected.value, projectId: target.value } };
  return invalid([
    ...(expected.ok ? [] : expected.error.issues),
    ...(target.ok ? [] : target.error.issues),
  ]);
}
