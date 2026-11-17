import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { CapturedAgent, RunDefinitions } from "@t3-factory/contracts";
import { executionForProject } from "@t3-factory/domain-validation";
import { readRunAgentRevisions, type AgentRevision } from "../../agent-revisions.ts";
import { readFlowRevision } from "../../flow-revisions.ts";

/** The revisions a Run captured at Start; later edits and removals never change them. */
export const readRunDefinitions = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  run: { id: string; flow_revision_id: string },
) {
  const [task] = yield* sql<{ project_id: string }>`SELECT t.project_id FROM runs r
    JOIN tasks t ON t.id = r.task_id WHERE r.id = ${run.id}`;
  if (!task) return yield* Effect.die(new Error(`Run ${run.id} has no Project`));
  // Both the captured revision and the Run's Project are fixed, so its settings never change.
  const agents = (yield* readRunAgentRevisions(sql, run)).map((agent) => ({
    ...agent,
    execution: executionForProject(agent, task.project_id),
  }));
  // Start captures only Agents with execution settings; anything else is a corrupt Run, refused
  // like a missing Flow revision rather than launched or recovered without a model.
  if (!agents.every(captured))
    return yield* Effect.die(new Error(`Run ${run.id} captured an Agent revision without a model`));
  const definitions: RunDefinitions = {
    flow: yield* readFlowRevision(sql, run.flow_revision_id),
    agents,
  };
  return definitions;
});

const captured = (agent: AgentRevision): agent is CapturedAgent => agent.execution !== null;
