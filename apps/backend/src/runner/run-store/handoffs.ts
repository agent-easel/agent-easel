import { FINISH_BLOCK_ID, type WorkerProvenance } from "@agent-easel/contracts";
import { handoffEndings } from "@agent-easel/domain-validation";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { Fragment } from "effect/sql/Statement";
import { newId } from "../../ids.ts";
import type { RunRow } from "../runner-types.ts";
import { fingerprint, intactPayload } from "../../fingerprint.ts";
import { runTarget } from "../runner-types.ts";
import { guardsHold } from "./guards.ts";
import type { DeliveryRecord, Handoff } from "./records.ts";
import { appendTimelineEvent } from "./steps.ts";

/**
 * A delivery's stored worker provenance: the thread binding a Continuation continues and, when
 * known, the Block activation whose result the message is. It is stored on every Handoff and kept
 * when the Handoff becomes a delivery, reaches a Wait or Condition, passes through or reaches a
 * Human step, whose answer forwards it.
 */
export type StoredProvenance = {
  readonly bindingId: string;
  readonly activationId: string | null;
};

/** The provenance a stored delivery, Wait arrival or Condition arrival carries, if any. */
export const storedProvenance = (row: {
  readonly binding_id: string | null;
  readonly origin_activation_id: string | null;
}): StoredProvenance | null =>
  row.binding_id ? { bindingId: row.binding_id, activationId: row.origin_activation_id } : null;

/** The provenance Run detail shows for a stored delivery or Wait arrival, read with its binding's
 * thread: present only when both thread and activation are known. */
export const workerProvenance = (row: {
  readonly run_id: string;
  readonly origin_activation_id: string | null;
  readonly origin_thread_id: string | null;
}): WorkerProvenance | null =>
  row.origin_activation_id && row.origin_thread_id
    ? { runId: row.run_id, activationId: row.origin_activation_id, threadId: row.origin_thread_id }
    : null;

export type OutgoingHandoffs = {
  readonly kind: "report" | "human" | "wait" | "condition" | "pass" | "subflow" | "join";
  readonly id: string;
  readonly blockId: string;
  readonly exitId: string | null;
  readonly recipients: readonly string[];
  readonly message: string;
  readonly at: string;
  readonly origin: StoredProvenance | null;
};

/** SQL for the thread binding a result of activation `activation` (a SQL expression) belongs to:
 * the thread a Continuation's prompt ran on, else its Block's worker; null without a worker. */
export const resultBinding = (sql: SqlClient.SqlClient, activation: Fragment) =>
  sql`COALESCE((SELECT v.binding_id FROM continuation_visits v WHERE v.activation_id=${activation}),(SELECT t.id FROM run_activations a JOIN run_blocks b ON b.run_id=a.run_id AND b.block_id=a.block_id JOIN run_thread_bindings t ON t.run_id=b.run_id AND t.thread_id=b.thread_id WHERE a.id=${activation}))`;

/** The provenance of a result of `activationId`; none without a worker thread. */
export function resultProvenance(sql: SqlClient.SqlClient, activationId: string) {
  return Effect.map(
    sql<{
      binding_id: string | null;
    }>`SELECT ${resultBinding(sql, sql`${activationId}`)} AS binding_id`,
    ([row]): StoredProvenance | null =>
      row?.binding_id ? { bindingId: row.binding_id, activationId } : null,
  );
}

function originatingSubflow(sql: SqlClient.SqlClient, source: OutgoingHandoffs) {
  if (source.kind === "subflow") return Effect.succeed(source.id);
  const arrivals = {
    wait: "wait_arrivals",
    condition: "condition_arrivals",
    pass: "continuation_visits",
  } as const;
  if (source.kind === "report" || source.kind === "human" || source.kind === "join")
    return Effect.succeed(null);
  return Effect.map(
    sql<{ subflow_invocation_id: string | null }>`
    SELECT i.subflow_invocation_id FROM ${sql(arrivals[source.kind])} a
    JOIN operation_intents i ON i.id=a.incoming_intent_id WHERE a.id=${source.id}`,
    ([row]) => row?.subflow_invocation_id ?? null,
  );
}

export function createHandoffs(
  sql: SqlClient.SqlClient,
  runRow: Pick<
    RunRow,
    | "id"
    | "context_id"
    | "endpoint"
    | "environment_id"
    | "t3_project_id"
    | "workspace_root"
    | "definitions"
  >,
  source: OutgoingHandoffs,
) {
  return Effect.gen(function* () {
    const ref = (kind: OutgoingHandoffs["kind"]) => (source.kind === kind ? source.id : null);
    const subflowResult = yield* originatingSubflow(sql, source);
    const finishBlockId = runRow.definitions.invocation?.finishBlockId ?? FINISH_BLOCK_ID;
    const endings = source.exitId
      ? handoffEndings(runRow.definitions.flow.graph.connections, source.blockId, source.exitId)
      : [];
    if (endings.length)
      yield* sql`INSERT INTO run_blocks(run_id,block_id,name) VALUES(${runRow.id},${finishBlockId},'Finish') ON CONFLICT DO NOTHING`;
    const recipients = [
      ...source.recipients.map((blockId) => ({
        blockId,
        causeSuffix: `recipient:${blockId}`,
        target: { blockId },
      })),
      ...endings.map((endingId) => ({
        blockId: finishBlockId,
        causeSuffix: `ending:${endingId}`,
        target: { blockId: FINISH_BLOCK_ID, endingId },
      })),
    ];
    for (const { blockId, causeSuffix, target } of recipients) {
      const id = yield* newId,
        cause = `${source.kind}:${source.id}/${causeSuffix}`;
      const payload = JSON.stringify({ message: source.message });
      const inserted =
        yield* sql`INSERT INTO operation_intents(id,run_id,block_id,kind,cause,target_json,request_key,payload_json,fingerprint,context_id,report_id,source_block_id,exit_id,occurrence_id,wait_arrival_id,condition_arrival_id,join_round_id,binding_id,origin_activation_id,subflow_invocation_id)
          VALUES(${id},${runRow.id},${blockId},'handoff',${cause},${JSON.stringify({ ...runTarget(runRow), ...target })},${fingerprint(cause)},${payload},${fingerprint(payload)},${runRow.context_id},${ref("report")},${source.blockId},${source.exitId},${ref("human")},${ref("wait")},${ref("condition")},${ref("join")},${source.origin?.bindingId ?? null},${source.origin?.activationId ?? null},${subflowResult}) ON CONFLICT(run_id,cause) DO NOTHING RETURNING id`;
      if (inserted.length)
        yield* appendTimelineEvent(sql, {
          kind: source.kind === "report" ? "handoff-held" : "handoff-created",
          runId: runRow.id,
          blockId,
          cause,
          intentId: id,
          observedAt: source.at,
        });
    }
    if (source.kind === "report")
      yield* sql`UPDATE runtime_reports SET pending_message=NULL WHERE id=${source.id}`;
  });
}

/**
 * Clears the message of every Wait arrival forwarded and every Condition arrival selected in Run
 * `runId` that nothing reads any more: each outgoing Handoff carries its own copy until its
 * recipient records the message, so only a pending Handoff or an Agent visit the arrival started,
 * while it is its Block's current visit, still reads the arrival's message (as that visit's
 * input). Outcome, deadline, number, selection and identity stay.
 */
export function clearSpentArrivalMessages(sql: SqlClient.SqlClient, runId: string) {
  const sources = [
    ["wait_arrivals", "wait_arrival_id", sql`state='forwarded'`],
    ["condition_arrivals", "condition_arrival_id", sql`state='selected'`],
    ["join_rounds", "join_round_id", sql`1`],
  ] as const;
  return Effect.forEach(
    sources,
    ([table, column, spent]) => {
      const source = sql(table);
      const matches = sql`i.${sql(column)}=${source}.id`;
      return sql`UPDATE ${source} SET message=NULL WHERE run_id=${runId} AND ${spent} AND message IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM operation_intents i WHERE ${matches} AND i.kind='handoff' AND i.state='pending')
      AND NOT EXISTS(SELECT 1 FROM operation_intents i JOIN run_activations a ON a.run_id=i.run_id AND a.cause=i.cause
        WHERE ${matches} AND a.phase!='finished' AND NOT EXISTS(SELECT 1 FROM continuation_visits v WHERE v.activation_id=a.id))`;
    },
    { discard: true },
  );
}

export function pendingHandoff(
  sql: SqlClient.SqlClient,
  ownerToken: string,
  runId: string,
  handoff: Handoff,
  generation: number | undefined,
) {
  return Effect.gen(function* () {
    const held = yield* guardsHold(sql, ownerToken, runId, {
      owner: true,
      gateOpen: true,
      liveContext: handoff.context_id,
      ...(generation === undefined ? {} : { generation }),
    });
    const [pending] =
      yield* sql<DeliveryRecord>`SELECT * FROM operation_intents WHERE id=${handoff.id} AND state='pending'`;
    return held ? pending : undefined;
  });
}

/** The pending Handoff a Human occurrence or Wait arrival is recorded from, with its stored
 * message, once the guards hold: owner, open gate, the Handoff's authorization context is live and
 * `generation` (a source release the caller read), when given, holds. Undefined when a guard fails
 * or the Handoff is no longer pending; a message that cannot be verified fails. */
export function arrivingHandoff(
  sql: SqlClient.SqlClient,
  ownerToken: string,
  runId: string,
  handoff: Handoff,
  generation: number | undefined,
) {
  return Effect.gen(function* () {
    const pending = yield* pendingHandoff(sql, ownerToken, runId, handoff, generation);
    if (!pending) return undefined;
    if (!intactPayload(pending)) return yield* Effect.fail(Error("Invalid arrival message"));
    return {
      record: pending,
      message: (JSON.parse(pending.payload_json) as { message: string }).message,
    };
  });
}
