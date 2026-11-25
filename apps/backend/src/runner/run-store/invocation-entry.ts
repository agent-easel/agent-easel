import { randomUUID } from "node:crypto";
import { FINISH_BLOCK_ID, type RunDefinitions } from "@agent-easel/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { fingerprint } from "../../fingerprint.ts";
import { newId } from "../../ids.ts";
import type { StoredTarget } from "../runner-types.ts";
import { createConditionCounters } from "./conditions.ts";
import { createDelivery } from "./deliveries.ts";

export type Invocation = {
  id: string;
  run_id: string;
  parent_id: string | null;
  placement_block_id: string;
  flow_id: string;
  number: number;
  incoming_intent_id: string | null;
  input: string;
  entry_input: 0 | 1;
  state: "queued" | "active" | "stopping" | "returned" | "nothing-returned" | "cancelled";
  arrived_at: string;
  completed_at: string | null;
};

const workerFacing = (kind: RunDefinitions["flow"]["graph"]["blocks"][number]["kind"]) =>
  kind === "agent" || kind === "continuation";

type Entry = {
  runId: string;
  definitions: RunDefinitions;
  target: Pick<StoredTarget, "endpoint" | "environmentId" | "projectId" | "workspaceRoot">;
  contextId: string;
  time: string;
  input: string;
  carriesStart: boolean;
};

export function scopedGraph(flow: RunDefinitions["flow"], ids: ReadonlyMap<string, string>) {
  const graph = flow.graph;
  return {
    ...graph,
    flowInput: {
      ...graph.flowInput,
      targetBlockIds: graph.flowInput.targetBlockIds.map((id) => ids.get(id)!),
    },
    blocks: graph.blocks.map((block) => ({ ...block, id: ids.get(block.id)! })),
    connections: graph.connections.map((edge) => ({
      ...edge,
      sourceBlockId: ids.get(edge.sourceBlockId)!,
      targetBlockId:
        edge.targetEndingId === undefined ? ids.get(edge.targetBlockId)! : FINISH_BLOCK_ID,
    })),
  };
}

export const enqueueInvocation = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  entry: Entry,
  placing: { id: string; flowId: string },
  parentId: string | null,
  incomingIntentId: string | null,
) {
  const id = yield* newId;
  const [invocation] = yield* sql<Invocation>`INSERT INTO subflow_invocations
    (id,run_id,parent_id,placement_block_id,flow_id,number,incoming_intent_id,input,entry_input,state,arrived_at)
    SELECT ${id},${entry.runId},${parentId},${placing.id},${placing.flowId},COALESCE(MAX(number),0)+1,
      ${incomingIntentId},${entry.input},${entry.carriesStart ? 1 : 0},'queued',${entry.time}
    FROM subflow_invocations WHERE run_id=${entry.runId} AND placement_block_id=${placing.id}
    RETURNING *`;
  return invocation!;
});

export const activateInvocation = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  entry: Entry,
  invocation: Invocation,
): Effect.fn.Return<{ blockId: string; placementPath: string[] }[], unknown> {
  const [activated] = yield* sql`UPDATE subflow_invocations SET state='active'
    WHERE id=${invocation.id} AND state='queued'
      AND NOT EXISTS(SELECT 1 FROM subflow_invocations other WHERE other.run_id=${entry.runId}
        AND other.placement_block_id=${invocation.placement_block_id}
        AND (other.state IN ('active','stopping') OR (other.state='queued' AND other.number<${invocation.number})))
    RETURNING id`;
  if (!activated) return [];
  const flow = entry.definitions.subflows!.find((saved) => saved.id === invocation.flow_id)!;
  const ids = new Map<string, string>();
  for (const block of flow.graph.blocks) {
    const id = yield* newId;
    ids.set(block.id, id);
    yield* sql`INSERT INTO run_blocks(run_id,block_id,template_block_id,invocation_id,name,public_id)
      VALUES(${entry.runId},${id},${block.id},${invocation.id},${block.name},${workerFacing(block.kind) ? randomUUID() : null})`;
  }
  yield* sql`INSERT INTO run_blocks(run_id,block_id,template_block_id,invocation_id,name)
    VALUES(${entry.runId},${yield* newId},NULL,${invocation.id},'Finish')`;
  const scoped = { ...flow, graph: scopedGraph(flow, ids) };
  yield* createConditionCounters(sql, entry.runId, { ...entry.definitions, flow: scoped });
  return yield* arriveAtEntries(sql, entry, flow, ids, invocation.id);
});

export const arriveAtEntries = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  entry: Entry,
  flow: RunDefinitions["flow"],
  ids?: ReadonlyMap<string, string>,
  parentId: string | null = null,
): Effect.fn.Return<{ blockId: string; placementPath: string[] }[], unknown> {
  const starters: { blockId: string; placementPath: string[] }[] = [];
  for (const templateId of flow.graph.flowInput.targetBlockIds) {
    const block = flow.graph.blocks.find((item) => item.id === templateId)!;
    const blockId = ids?.get(templateId) ?? templateId;
    if (block.kind === "subflow") {
      const invocation = yield* enqueueInvocation(
        sql,
        entry,
        { id: blockId, flowId: block.flowId! },
        parentId,
        null,
      );
      const nested = yield* activateInvocation(sql, entry, invocation);
      for (const starter of nested)
        starters.push({
          blockId: starter.blockId,
          placementPath: [templateId, ...starter.placementPath],
        });
      continue;
    }
    const cause = "start:" + blockId;
    yield* createDelivery(sql, {
      id: yield* newId,
      runId: entry.runId,
      blockId,
      kind: "handoff",
      cause,
      target: { ...entry.target, blockId, flowInput: true, carriesStart: entry.carriesStart },
      requestKey: fingerprint(JSON.stringify([entry.runId, cause])),
      payload: { message: entry.input },
      contextId: entry.contextId,
      retryScope: null,
    });
    starters.push({ blockId, placementPath: [templateId] });
  }
  return starters;
});
