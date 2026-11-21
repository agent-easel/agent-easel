import * as Effect from "effect/Effect";
import type { LaunchCandidate, LaunchDiscovery, LaunchPayload, T3Threads } from "../t3/threads.ts";
import { runTarget, type RunRow } from "./runner-types.ts";
import { launchedInWorkspace } from "./run-workspace.ts";

function unavailableLaunch(): LaunchDiscovery {
  return { available: false };
}

/** Where a launch was sent: the Run's T3 environment, project and project root. */
type LaunchScope = Pick<RunRow, "endpoint" | "environment_id" | "t3_project_id" | "workspace_root">;

/** The only thread in the project that carries the saved launch title, if exactly one does. */
function soleTitledCandidate(
  t3: T3Threads,
  scope: LaunchScope,
  title: string,
  bound: ReadonlySet<string>,
) {
  return Effect.tryPromise({
    try: () => t3.discoverLaunchCandidates(runTarget(scope), title).catch(unavailableLaunch),
    catch: unavailableLaunch,
  }).pipe(
    Effect.map((discovery) => {
      if (!discovery.available) return undefined;
      const titled = discovery.candidates.filter(
        (candidate) => candidate.title === title && !bound.has(candidate.threadId),
      );
      return titled.length === 1 ? titled[0] : undefined;
    }),
  );
}

/**
 * The thread an uncertain launch created, found only by uniquely verified provenance: the one
 * thread in the project with the saved title, top-level with the saved workspace and settings,
 * and exactly one matching execution. Undefined when evidence is missing, ambiguous or incomplete.
 */
export function verifiedLaunchedThread(
  t3: T3Threads,
  scope: LaunchScope,
  payload: LaunchPayload,
  bound: ReadonlySet<string> = new Set(),
) {
  return Effect.gen(function* () {
    const candidate = yield* soleTitledCandidate(t3, scope, payload.title, bound);
    if (!candidate || !sameWorkerSettings(payload, scope, candidate)) return undefined;
    const executions = matchingExecutions(payload, candidate);
    if (executions.length !== 1) return undefined;
    return {
      projectId: candidate.projectId,
      threadId: candidate.threadId,
      link: candidate.link ?? null,
      runId: executions[0]!.runId,
      status: executions[0]!.status,
    };
  });
}

/** A top-level thread of the Run's project with the saved workspace and Agent settings. */
function sameWorkerSettings(payload: LaunchPayload, run: LaunchScope, candidate: LaunchCandidate) {
  return (
    candidate.projectId === run.t3_project_id &&
    candidate.parentThreadId === null &&
    launchedInWorkspace(payload.workspaceStrategy, candidate, run.workspace_root) &&
    candidate.interactionMode === "default" &&
    candidate.providerInstanceId === payload.modelSelection.instanceId &&
    candidate.model === payload.modelSelection.model &&
    sameOptions(candidate.options, payload.modelSelection.options)
  );
}

function matchingExecutions(payload: LaunchPayload, candidate: LaunchCandidate) {
  return candidate.executions.filter(
    (execution) =>
      !!execution.runId &&
      execution.providerInstanceId === payload.modelSelection.instanceId &&
      execution.model === payload.modelSelection.model,
  );
}

function sameOptions(
  actual: LaunchCandidate["options"],
  expected: LaunchPayload["modelSelection"]["options"],
) {
  if (!actual) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
  );
}
