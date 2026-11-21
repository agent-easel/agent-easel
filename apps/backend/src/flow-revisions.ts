import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import {
  CONDITION_OTHERWISE_ID,
  FINISH_BLOCK_ID,
  type AgentRevisitContext,
  type EndingOutput,
  type FlowBlock,
  type FlowGraph,
  type FlowWorkspace,
  type RunDefinitions,
  type WaitUnit,
} from "@t3-factory/contracts";
import { newId } from "./ids.ts";
import { laterTime } from "./time.ts";

/** One saved Flow revision as a Run captures it; readiness is derived separately. */
export type FlowRevision = RunDefinitions["flow"];
/** The latest saved revision of a current Flow with its owning Project. */
export type CurrentFlow = FlowRevision & { readonly projectId: string | null };

type RevisionRow = {
  id: string;
  flow_id: string;
  revision: number;
  name: string;
  input_x: number;
  input_y: number;
  workspace_mode: FlowWorkspace["mode"];
  workspace_base_ref: string | null;
  saved_at: string;
  created_at: string;
};
type BlockRow = {
  flow_revision_id: string;
  block_id: string;
  kind: FlowBlock["kind"];
  name: string;
  agent_id: string | null;
  flow_id: string | null;
  prompt: string | null;
  revisit_instruction: string | null;
  revisit_context: AgentRevisitContext | null;
  x: number;
  y: number;
  wait_amount: number | null;
  wait_unit: WaitUnit | null;
};
/** A Flow-local exit of an Agent block. */
type ExitRow = {
  flow_revision_id: string;
  block_id: string;
  exit_id: string;
  name: string;
  description: string;
  message_required: number;
};
type ConditionRuleRow = {
  flow_revision_id: string;
  block_id: string;
  rule_id: string;
  name: string;
  from_arrival: number | null;
};
type HiddenExitRow = { flow_revision_id: string; block_id: string; exit_id: string };
type ConnectionRow = {
  flow_revision_id: string;
  source_block_id: string;
  exit_id: string;
  target_block_id: string | null;
  target_ending_id: string | null;
};
type FinishRow = { flow_revision_id: string; x: number; y: number };
type EndingRow = {
  flow_revision_id: string;
  ending_id: string;
  name: string;
  description: string;
  output: EndingOutput;
  output_description: string;
};
type TargetRow = { flow_revision_id: string; block_id: string };

const groupBy = <R>(rows: readonly R[], key: (row: R) => string) => {
  const groups = new Map<string, R[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
};
const byRevision = (row: { flow_revision_id: string }) => row.flow_revision_id;
const byBlock = (row: { flow_revision_id: string; block_id: string }) =>
  JSON.stringify([row.flow_revision_id, row.block_id]);

/** Appends one immutable revision with its owned graph rows; callers own the transaction. */
export const appendFlowRevision = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  flow: {
    id: string;
    revision: number;
    name: string;
    graph: FlowGraph;
    workspace: FlowWorkspace;
    savedAt: string;
  },
) {
  const revisionId = yield* newId;
  const { graph, workspace } = flow;
  const baseRef =
    workspace.mode === "worktree" && workspace.base.kind === "ref" ? workspace.base.ref : null;
  yield* sql`INSERT INTO flow_revisions (id, flow_id, revision, name, input_x, input_y,
      workspace_mode, workspace_base_ref, saved_at)
    VALUES (${revisionId}, ${flow.id}, ${flow.revision}, ${flow.name},
      ${graph.flowInput.position.x}, ${graph.flowInput.position.y},
      ${workspace.mode}, ${baseRef}, ${flow.savedAt})`;
  yield* Effect.forEach(
    graph.blocks,
    (block, ordinal) =>
      Effect.gen(function* () {
        const duration = block.kind === "wait" ? block.duration : null;
        yield* sql`INSERT INTO flow_revision_blocks (flow_revision_id, block_id, ordinal, kind, name, agent_id, flow_id, prompt, revisit_instruction, revisit_context, x, y, wait_amount, wait_unit)
        VALUES (${revisionId}, ${block.id}, ${ordinal}, ${block.kind}, ${block.name},
          ${block.kind === "agent" ? block.agentId : null},
          ${block.kind === "subflow" ? block.flowId : null},
          ${block.kind === "continuation" ? block.prompt : null},
          ${block.kind === "agent" ? block.revisitInstruction : null},
          ${block.kind === "agent" ? block.revisitContext : null}, ${block.position.x}, ${block.position.y},
          ${duration?.amount ?? null}, ${duration?.unit ?? null})`;
        if (block.kind === "condition")
          yield* Effect.forEach(
            block.rules,
            (rule, ruleOrdinal) =>
              sql`INSERT INTO flow_revision_condition_rules (flow_revision_id, block_id, rule_id, ordinal, name, from_arrival)
              VALUES (${revisionId}, ${block.id}, ${rule.id}, ${ruleOrdinal}, ${rule.name}, ${rule.fromArrival})`,
            { discard: true },
          );
        if (block.kind !== "agent") return;
        yield* Effect.forEach(
          block.localExits,
          (exit, exitOrdinal) =>
            sql`INSERT INTO flow_revision_exits (flow_revision_id, block_id, exit_id, ordinal, name, description, message_required)
            VALUES (${revisionId}, ${block.id}, ${exit.id}, ${exitOrdinal}, ${exit.name},
              ${exit.description}, ${exit.messageRequired ? 1 : 0})`,
          { discard: true },
        );
        yield* Effect.forEach(
          block.hiddenExitIds,
          (exitId, hiddenOrdinal) =>
            sql`INSERT INTO flow_revision_hidden_exits (flow_revision_id, block_id, exit_id, ordinal)
            VALUES (${revisionId}, ${block.id}, ${exitId}, ${hiddenOrdinal})`,
          { discard: true },
        );
      }),
    { discard: true },
  );
  if (graph.finish)
    yield* sql`INSERT INTO flow_revision_finish (flow_revision_id, x, y)
      VALUES (${revisionId}, ${graph.finish.position.x}, ${graph.finish.position.y})`;
  yield* Effect.forEach(
    graph.finish?.endings ?? [],
    (ending, ordinal) =>
      sql`INSERT INTO flow_revision_endings (flow_revision_id, ending_id, ordinal, name, description, output, output_description)
        VALUES (${revisionId}, ${ending.id}, ${ordinal}, ${ending.name}, ${ending.description},
          ${ending.output}, ${ending.outputDescription})`,
    { discard: true },
  );
  yield* Effect.forEach(
    graph.connections,
    (connection, ordinal) => {
      const toFinish = connection.targetEndingId !== undefined;
      return sql`INSERT INTO flow_revision_connections (flow_revision_id, ordinal, source_block_id, exit_id, target_block_id, target_ending_id)
        VALUES (${revisionId}, ${ordinal}, ${connection.sourceBlockId}, ${connection.exitId},
          ${toFinish ? null : connection.targetBlockId}, ${connection.targetEndingId ?? null})`;
    },
    { discard: true },
  );
  yield* Effect.forEach(
    graph.flowInput.targetBlockIds,
    (blockId, ordinal) =>
      sql`INSERT INTO flow_revision_input_targets (flow_revision_id, ordinal, block_id)
        VALUES (${revisionId}, ${ordinal}, ${blockId})`,
    { discard: true },
  );
});

const toWorkspace = (row: RevisionRow): FlowWorkspace => {
  if (row.workspace_mode === "checkout") return { mode: "checkout" };
  return {
    mode: "worktree",
    base:
      row.workspace_base_ref === null
        ? { kind: "default" }
        : { kind: "ref", ref: row.workspace_base_ref },
  };
};

const toBlock = (
  row: BlockRow,
  exits: readonly ExitRow[],
  hidden: readonly HiddenExitRow[],
  rules: readonly ConditionRuleRow[],
): FlowBlock => {
  const base = { id: row.block_id, name: row.name, position: { x: row.x, y: row.y } };
  if (row.kind === "human") return { ...base, kind: "human" };
  if (row.kind === "subflow") return { ...base, kind: "subflow", flowId: row.flow_id };
  if (row.kind === "condition")
    return {
      ...base,
      kind: "condition",
      rules: rules.map((rule) => ({
        id: rule.rule_id,
        name: rule.name,
        fromArrival: rule.from_arrival,
      })),
      otherwise: { id: CONDITION_OTHERWISE_ID },
    };
  if (row.kind === "wait")
    return {
      ...base,
      kind: "wait",
      duration:
        row.wait_amount === null || row.wait_unit === null
          ? null
          : { amount: row.wait_amount, unit: row.wait_unit },
    };
  if (row.kind === "continuation")
    return { ...base, kind: "continuation", prompt: row.prompt ?? "" };
  return {
    ...base,
    kind: "agent",
    agentId: row.agent_id,
    hiddenExitIds: hidden.map((entry) => entry.exit_id),
    localExits: exits.map((exit) => ({
      id: exit.exit_id,
      name: exit.name,
      description: exit.description,
      messageRequired: exit.message_required === 1,
    })),
    revisitInstruction: row.revisit_instruction ?? "",
    revisitContext: row.revisit_context ?? "keep",
  };
};

/**
 * The latest revision of each non-removed Flow (or only `flowId`) with its owning Project, newest
 * Flow first. Its update time is its latest save or owner change, whichever is later.
 */
export const readCurrentFlows = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  flowId?: string,
) {
  const revisions = yield* sql<
    RevisionRow & { project_id: string | null; owner_changed_at: string | null }
  >`
    SELECT r.*, f.created_at, f.project_id, f.owner_changed_at FROM flows f
    JOIN flow_revisions r ON r.flow_id = f.id
      AND r.revision = (SELECT max(revision) FROM flow_revisions WHERE flow_id = f.id)
    WHERE f.removed_at IS NULL ${flowId === undefined ? sql`` : sql`AND f.id = ${flowId}`}
    ORDER BY f.created_at DESC, f.id ASC`;
  const flows = yield* withGraphs(sql, revisions);
  return flows.map((flow, index): CurrentFlow => {
    const row = revisions[index]!;
    return {
      ...flow,
      projectId: row.project_id,
      updatedAt: laterTime(flow.updatedAt, row.owner_changed_at),
    };
  });
});

/** One stored revision by its id, also after a later save or the Flow's removal. */
export const readFlowRevision = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  revisionId: string,
) {
  const revisions = yield* sql<RevisionRow>`SELECT r.*, f.created_at FROM flow_revisions r
    JOIN flows f ON f.id = r.flow_id WHERE r.id = ${revisionId}`;
  const [flow] = yield* withGraphs(sql, revisions);
  if (!flow) return yield* Effect.die(new Error(`Flow revision ${revisionId} is missing`));
  return flow;
});

/**
 * Graphs of stored revisions by revision id. Revisions are immutable, so a graph another reader
 * still holds, such as an open Studio, Run composer or Run view, is reused instead of re-read:
 * every Studio change and Run row read would otherwise re-read whole near-limit graphs. The memo
 * holds graphs weakly, so it never keeps a graph alive by itself. Each open database has its own,
 * so a backend opened again reads its captured revisions from storage.
 */
type GraphMemo = Map<string, WeakRef<FlowGraph>>;
const memos = new WeakMap<SqlClient.SqlClient, GraphMemo>();
const collected = new FinalizationRegistry<{ graphs: GraphMemo; revisionId: string }>(
  ({ graphs, revisionId }) => {
    if (graphs.get(revisionId)?.deref() === undefined) graphs.delete(revisionId);
  },
);

function graphMemo(sql: SqlClient.SqlClient) {
  const existing = memos.get(sql);
  if (existing) return existing;
  const graphs: GraphMemo = new Map();
  memos.set(sql, graphs);
  return graphs;
}

const withGraphs = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  revisions: readonly RevisionRow[],
) {
  const graphs = graphMemo(sql);
  const known = new Map<string, FlowGraph>();
  for (const revision of revisions) {
    const graph = graphs.get(revision.id)?.deref();
    if (graph) known.set(revision.id, graph);
  }
  const unread = revisions.filter((revision) => !known.has(revision.id));
  for (const [revisionId, graph] of yield* readGraphs(sql, unread)) {
    graphs.set(revisionId, new WeakRef(graph));
    collected.register(graph, { graphs, revisionId });
    known.set(revisionId, graph);
  }
  return revisions.map((revision): FlowRevision => ({
    id: revision.flow_id,
    name: revision.name,
    revision: revision.revision,
    graph: known.get(revision.id)!,
    workspace: toWorkspace(revision),
    createdAt: revision.created_at,
    updatedAt: revision.saved_at,
  }));
});

/** The stored graph of each revision, by revision id. */
const readGraphs = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  revisions: readonly RevisionRow[],
) {
  if (!revisions.length) return new Map<string, FlowGraph>();
  const ids = sql.in(revisions.map((revision) => revision.id));
  const [blocks, exits, hidden, rules, connections, targets, finishes, endings] = yield* Effect.all(
    [
      sql<BlockRow>`SELECT * FROM flow_revision_blocks WHERE flow_revision_id IN ${ids} ORDER BY ordinal`,
      sql<ExitRow>`SELECT * FROM flow_revision_exits WHERE flow_revision_id IN ${ids} ORDER BY ordinal`,
      sql<HiddenExitRow>`SELECT * FROM flow_revision_hidden_exits WHERE flow_revision_id IN ${ids} ORDER BY ordinal`,
      sql<ConditionRuleRow>`SELECT * FROM flow_revision_condition_rules WHERE flow_revision_id IN ${ids} ORDER BY ordinal`,
      sql<ConnectionRow>`SELECT * FROM flow_revision_connections WHERE flow_revision_id IN ${ids} ORDER BY ordinal`,
      sql<TargetRow>`SELECT * FROM flow_revision_input_targets WHERE flow_revision_id IN ${ids} ORDER BY ordinal`,
      sql<FinishRow>`SELECT flow_revision_id, x, y FROM flow_revision_finish WHERE flow_revision_id IN ${ids} AND active = 1`,
      sql<EndingRow>`SELECT * FROM flow_revision_endings WHERE flow_revision_id IN ${ids} ORDER BY ordinal`,
    ],
  );
  const blocksByRevision = groupBy(blocks, byRevision);
  const exitsByBlock = groupBy(exits, byBlock);
  const hiddenByBlock = groupBy(hidden, byBlock);
  const rulesByBlock = groupBy(rules, byBlock);
  const connectionsByRevision = groupBy(connections, byRevision);
  const targetsByRevision = groupBy(targets, byRevision);
  const finishByRevision = new Map(finishes.map((finish) => [finish.flow_revision_id, finish]));
  const endingsByRevision = groupBy(endings, byRevision);
  return new Map(
    revisions.map((revision): [string, FlowGraph] => [
      revision.id,
      {
        blocks: (blocksByRevision.get(revision.id) ?? []).map((block) =>
          toBlock(
            block,
            exitsByBlock.get(byBlock(block)) ?? [],
            hiddenByBlock.get(byBlock(block)) ?? [],
            rulesByBlock.get(byBlock(block)) ?? [],
          ),
        ),
        connections: (connectionsByRevision.get(revision.id) ?? []).map((connection) => ({
          sourceBlockId: connection.source_block_id,
          exitId: connection.exit_id,
          ...(connection.target_block_id === null
            ? { targetBlockId: FINISH_BLOCK_ID, targetEndingId: connection.target_ending_id! }
            : { targetBlockId: connection.target_block_id }),
        })),
        flowInput: {
          position: { x: revision.input_x, y: revision.input_y },
          targetBlockIds: (targetsByRevision.get(revision.id) ?? []).map(
            (target) => target.block_id,
          ),
        },
        ...finishOf(finishByRevision.get(revision.id), endingsByRevision.get(revision.id) ?? []),
      },
    ]),
  );
});

function finishOf(
  row: FinishRow | undefined,
  endings: readonly EndingRow[],
): Pick<FlowGraph, "finish"> {
  if (!row) return {};
  return {
    finish: {
      position: { x: row.x, y: row.y },
      endings: endings.map((ending) => ({
        id: ending.ending_id,
        name: ending.name,
        description: ending.description,
        output: ending.output,
        outputDescription: ending.output_description,
      })),
    },
  };
}

/** The current saved revision number, absent once the Flow is removed. */
export const currentFlowRevisionNumber = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  flowId: string,
) {
  const [row] = yield* sql<{ revision: number | null }>`SELECT max(r.revision) AS revision
    FROM flows f JOIN flow_revisions r ON r.flow_id = f.id
    WHERE f.id = ${flowId} AND f.removed_at IS NULL`;
  return row?.revision ?? undefined;
});

/** The non-removed Flows whose latest revision places the Agent in a block, by name then id. */
export const currentFlowsReferencingAgent = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  agentId: string,
) {
  return yield* sql<{ id: string; name: string; project_id: string | null }>`
    SELECT f.id, r.name, f.project_id FROM flows f
    JOIN flow_revisions r ON r.flow_id = f.id
      AND r.revision = (SELECT max(revision) FROM flow_revisions WHERE flow_id = f.id)
    WHERE f.removed_at IS NULL AND EXISTS (SELECT 1 FROM flow_revision_blocks b
      WHERE b.flow_revision_id = r.id AND b.agent_id = ${agentId})
    ORDER BY r.name, f.id`;
});

export const currentFlowsPlacingFlow = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  flowId: string,
) {
  return yield* sql<{ id: string; name: string; project_id: string | null }>`
    SELECT f.id, r.name, f.project_id FROM flows f
    JOIN flow_revisions r ON r.flow_id = f.id
      AND r.revision = (SELECT max(revision) FROM flow_revisions WHERE flow_id = f.id)
    WHERE f.removed_at IS NULL AND f.id <> ${flowId} AND EXISTS (SELECT 1 FROM flow_revision_blocks b
      WHERE b.flow_revision_id = r.id AND b.flow_id = ${flowId})
    ORDER BY r.name, f.id`;
});
