import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { CapturedAgent, RunDefinitions } from "@t3-factory/contracts";
import { executionForProject } from "@t3-factory/domain-validation";
import { readRunAgentRevisions, type AgentRevision } from "../../agent-revisions.ts";
import { scopedGraph } from "./invocation-entry.ts";
import type { ExecutionDefinitions } from "../runner-types.ts";
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
  const links = yield* sql<{
    flow_revision_id: string;
  }>`SELECT flow_revision_id FROM run_subflow_revisions WHERE run_id=${run.id} ORDER BY flow_id`;
  const subflows = yield* Effect.forEach(links, (link) =>
    readFlowRevision(sql, link.flow_revision_id),
  );
  const definitions: RunDefinitions = {
    ...(subflows.length ? { subflows } : {}),
    flow: yield* readFlowRevision(sql, run.flow_revision_id),
    agents,
  };
  return definitions;
});

const captured = (agent: AgentRevision): agent is CapturedAgent => agent.execution !== null;

export const definitionsAtBlock = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  run: { id: string; definitions: RunDefinitions },
  blockId: string,
): Effect.fn.Return<ExecutionDefinitions, unknown> {
  if (!run.definitions.subflows?.length) return run.definitions;
  const [scope] = yield* sql<{
    id: string;
    flow_id: string;
    flow_revision_id: string;
  }>`SELECT i.id,i.flow_id,c.flow_revision_id
    FROM run_blocks b JOIN subflow_invocations i ON i.id=b.invocation_id
    JOIN run_subflow_revisions c ON c.run_id=i.run_id AND c.flow_id=i.flow_id
    WHERE b.run_id=${run.id} AND b.block_id=${blockId}`;
  if (!scope) return run.definitions;
  const rows = yield* sql<{
    template_block_id: string | null;
    block_id: string;
  }>`SELECT template_block_id,block_id
    FROM run_blocks WHERE invocation_id=${scope.id}`;
  const ids = new Map(
    rows.flatMap((row) =>
      row.template_block_id === null ? [] : [[row.template_block_id, row.block_id]],
    ),
  );
  const flow = run.definitions.subflows.find((item) => item.id === scope.flow_id)!;
  return {
    ...run.definitions,
    flow: { ...flow, workspace: run.definitions.flow.workspace, graph: scopedGraph(flow, ids) },
    invocation: {
      id: scope.id,
      revisionId: scope.flow_revision_id,
      finishBlockId: rows.find((row) => row.template_block_id === null)!.block_id,
    },
  };
});
