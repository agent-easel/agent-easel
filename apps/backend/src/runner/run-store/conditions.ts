import {
  CONDITION_ARRIVAL_MAX,
  CONDITION_OTHERWISE_ID,
  type ConditionSummary,
  type RunDefinitions,
} from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { intactPayload } from "../../fingerprint.ts";
import { newId } from "../../ids.ts";
import { now } from "../../time.ts";
import type { Checked, RunRow } from "../runner-types.ts";
import { unverified, verified } from "../runner-utils.ts";
import { latchConditionIntegrityProblem } from "./attention.ts";
import { writeBlockState } from "./blocks.ts";
import type { RunnerDatabase } from "./database.ts";
import { guardsHold } from "./guards.ts";
import { clearSpentArrivalMessages, createHandoffs, storedProvenance } from "./handoffs.ts";
import type { DeliveryRecord, Handoff } from "./records.ts";
import { advanceGeneration, appendTimelineEvent } from "./steps.ts";

type ConditionBlock = Extract<
  RunDefinitions["flow"]["graph"]["blocks"][number],
  { kind: "condition" }
>;

/** The oldest delivery waiting for its number at one Condition. */
type PendingArrival = {
  id: string;
  incoming_intent_id: string;
  binding_id: string | null;
  origin_activation_id: string | null;
};

/** Every Condition of a new Run starts its count at 0. */
export function createConditionCounters(
  sql: SqlClient.SqlClient,
  runId: string,
  definitions: RunDefinitions,
) {
  return Effect.forEach(
    definitions.flow.graph.blocks.filter((block) => block.kind === "condition"),
    (block) => sql`INSERT INTO condition_counters(run_id,block_id) VALUES(${runId},${block.id})`,
    { discard: true },
  );
}

/**
 * The Condition's next arrival number, with its captured rules: the integrity check before any
 * number is committed. It refuses when the captured rules are not a started Run's, the counter is
 * missing or disagrees with the numbers already committed, or the next number is not
 * representable. A refusal numbers and selects nothing; the delivery stays pending in order and
 * the Condition's integrity Problem latches.
 */
function nextArrival(
  block: ConditionBlock | undefined,
  counter: { readonly arrivals: number; readonly committed: number } | undefined,
): Checked<{ readonly block: ConditionBlock; readonly number: number }> {
  if (!block || block.rules.some((rule) => rule.fromArrival === null))
    return unverified("The captured Condition rules are incomplete.");
  if (!counter) return unverified("The Condition's arrival count is missing.");
  if (counter.arrivals !== counter.committed)
    return unverified("The Condition's arrival count disagrees with its numbered arrivals.");
  if (counter.arrivals >= CONDITION_ARRIVAL_MAX)
    return unverified("The Condition's next arrival number is not representable.");
  return verified({ block, number: counter.arrivals + 1 });
}

/** The rule whose output a Condition selects for arrival `number`: the first one it reaches;
 * undefined selects Otherwise. */
const selectedRule = (block: ConditionBlock, number: number) =>
  block.rules.find((rule) => rule.fromArrival !== null && number >= rule.fromArrival);

/** Numbers the Condition's pending deliveries in the order they were recorded, oldest first, while
 * the integrity check allows; its refusal latches the Condition's integrity Problem. Answers how
 * many were numbered and whether this pass latched the Problem. */
function numberPendingArrivals(
  sql: SqlClient.SqlClient,
  runRow: RunRow,
  blockId: string,
  time: string,
) {
  return Effect.gen(function* () {
    const captured = runRow.definitions.flow.graph.blocks.find(
      (entry): entry is ConditionBlock => entry.id === blockId && entry.kind === "condition",
    );
    for (let numbered = 0; ; numbered++) {
      const [head] =
        yield* sql<PendingArrival>`SELECT id,incoming_intent_id,binding_id,origin_activation_id FROM condition_arrivals WHERE run_id=${runRow.id} AND block_id=${blockId} AND state='pending' ORDER BY rowid LIMIT 1`;
      if (!head) return { numbered, latched: false };
      const [counter] = yield* sql<{
        arrivals: number;
        committed: number;
      }>`SELECT c.arrivals,COALESCE((SELECT MAX(a.arrival_number) FROM condition_arrivals a WHERE a.run_id=c.run_id AND a.block_id=c.block_id),0) AS committed FROM condition_counters c WHERE c.run_id=${runRow.id} AND c.block_id=${blockId}`;
      const next = nextArrival(captured, counter);
      if (!next.ok)
        return {
          numbered,
          latched: yield* latchConditionIntegrityProblem(
            sql,
            runRow.id,
            blockId,
            next.problem,
            time,
          ),
        };
      const { block, number } = next.value;
      const [incoming] =
        yield* sql<DeliveryRecord>`SELECT * FROM operation_intents WHERE id=${head.incoming_intent_id} AND state='pending'`;
      if (!incoming || !intactPayload(incoming))
        return yield* Effect.fail(Error("Invalid arrival message"));
      const message = (JSON.parse(incoming.payload_json) as { message: string }).message;
      const rule = selectedRule(block, number);
      const outputId = rule?.id ?? CONDITION_OTHERWISE_ID;
      yield* sql`UPDATE condition_arrivals SET state='selected',arrival_number=${number},rule_id=${rule?.id ?? null},message=${message},accepted_at=${time} WHERE id=${head.id}`;
      yield* sql`UPDATE condition_counters SET arrivals=${number} WHERE run_id=${runRow.id} AND block_id=${blockId}`;
      yield* sql`UPDATE operation_intents SET state='acknowledged',payload_json=NULL,problem=NULL,reconciled_at=${time} WHERE id=${incoming.id}`;
      const recipients = [
        ...new Set(
          runRow.definitions.flow.graph.connections
            .filter((edge) => edge.sourceBlockId === blockId && edge.exitId === outputId)
            .map((edge) => edge.targetBlockId),
        ),
      ];
      yield* createHandoffs(sql, runRow, {
        kind: "condition",
        id: head.id,
        blockId,
        exitId: outputId,
        recipients,
        message,
        at: time,
        origin: storedProvenance(head),
      });
      yield* appendTimelineEvent(sql, {
        kind: "condition-selected",
        runId: runRow.id,
        blockId,
        conditionArrivalId: head.id,
        observedAt: time,
      });
    }
  });
}

/** The constant-size summary of each captured Condition of Run `runId`, in block order. */
export function readConditionSummaries(
  sql: SqlClient.SqlClient,
  runId: string,
  definitions: RunDefinitions,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<{
      block_id: string;
      arrivals: number;
      pending: number;
      arrival_number: number | null;
      rule_id: string | null;
      accepted_at: string | null;
    }>`SELECT c.block_id,c.arrivals,(SELECT COUNT(*) FROM condition_arrivals p WHERE p.run_id=c.run_id AND p.block_id=c.block_id AND p.state='pending') AS pending,l.arrival_number,l.rule_id,l.accepted_at FROM condition_counters c LEFT JOIN condition_arrivals l ON l.run_id=c.run_id AND l.block_id=c.block_id AND l.arrival_number=c.arrivals WHERE c.run_id=${runId}`;
    const byBlock = new Map(rows.map((row) => [row.block_id, row]));
    return definitions.flow.graph.blocks.flatMap((block): ConditionSummary[] => {
      const row = byBlock.get(block.id);
      if (!row) return [];
      return [
        {
          blockId: row.block_id,
          arrivals: row.arrivals,
          pending: row.pending,
          latest:
            row.arrival_number === null || row.accepted_at === null
              ? null
              : {
                  arrivalNumber: row.arrival_number,
                  outputId: row.rule_id ?? CONDITION_OTHERWISE_ID,
                  acceptedAt: row.accepted_at,
                },
        },
      ];
    });
  });
}

/**
 * Condition arrivals. Each distinct delivery accepted at a Condition is numbered from 1 per Run and
 * Condition, shared by every incoming wire and worker, and routed by the captured rules to every
 * recipient of the selected output with its text and worker provenance unchanged. A Condition has
 * no worker, prompt or report.
 */
export function openRunConditions(database: RunnerDatabase) {
  const ownerToken = database.owner.token;

  /** Accepts a released Handoff to a Condition in one transaction. `generation`, when given, is
   * the snapshot at which the caller read its Final result released. Guards: owner, open gate, the
   * Handoff's authorization context is live and that generation holds. The Handoff, while still
   * pending, is recorded once as the Condition's newest pending delivery (a redelivery finds its
   * arrival and records nothing). Then the Condition's pending deliveries are numbered oldest
   * first, so none overtakes an earlier one: each gets the next arrival number, its first matching
   * rule or Otherwise is selected, released Handoffs to every recipient of that output carry its
   * message and provenance, its incoming Handoff is acknowledged, the count moves and
   * "condition-selected" is appended. An unwired output still counts and ends the arrival. An
   * integrity refusal stops numbering and, in the same transaction, latches the Condition's
   * integrity Problem, which holds every later delivery to it unnumbered. Sets the
   * Condition waiting while a delivery is pending, else finished, and advances the generation.
   * Any failure rolls back everything, so no number is consumed. Answers whether it changed the
   * Run. */
  function handoffToConditionArrival(
    runRow: RunRow,
    handoff: Handoff,
    generation: number | undefined,
  ) {
    return database.mutate(
      runRow.id,
      (sql) =>
        Effect.gen(function* () {
          const held = yield* guardsHold(sql, ownerToken, runRow.id, {
            owner: true,
            gateOpen: true,
            liveContext: handoff.context_id,
            ...(generation === undefined ? {} : { generation }),
          });
          if (!held) return false;
          const time = yield* now;
          const recorded =
            yield* sql`INSERT INTO condition_arrivals(id,run_id,block_id,incoming_intent_id,flow_revision_id,binding_id,origin_activation_id,arrived_at)
              SELECT ${yield* newId},i.run_id,i.block_id,i.id,r.flow_revision_id,i.binding_id,i.origin_activation_id,${time} FROM operation_intents i JOIN runs r ON r.id=i.run_id
              WHERE i.id=${handoff.id} AND i.kind='handoff' AND i.state='pending' ON CONFLICT(incoming_intent_id) DO NOTHING RETURNING id`;
          const { numbered, latched } = yield* numberPendingArrivals(
            sql,
            runRow,
            handoff.block_id,
            time,
          );
          if (!recorded.length && !numbered && !latched) return false;
          yield* writeBlockState(
            sql,
            { runId: runRow.id, blockId: handoff.block_id },
            { whileArrivalPending: "waiting", otherwise: "finished" },
            { freshness: "fresh", observed_at: time },
          );
          yield* clearSpentArrivalMessages(sql, runRow.id);
          yield* advanceGeneration(sql, runRow.id);
          return true;
        }),
      (changed) => changed,
    );
  }

  /** The message Condition arrival `arrivalId` of Run `runId` still keeps for its recipients;
   * null once cleared. */
  const conditionArrivalMessage = (runId: string, arrivalId: string) =>
    database.transaction((sql) =>
      Effect.map(
        sql<{
          message: string | null;
        }>`SELECT message FROM condition_arrivals WHERE id=${arrivalId} AND run_id=${runId}`,
        ([row]) => row?.message ?? null,
      ),
    );

  return { handoffToConditionArrival, conditionArrivalMessage };
}
