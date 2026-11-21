import type { RunResult } from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { FINISH_BLOCK_ID } from "@t3-factory/contracts";
import { now } from "../../time.ts";
import type { RunRow, StoredTarget } from "../runner-types.ts";
import type { RunnerDatabase } from "./database.ts";
import { cancelTitleGeneration } from "./title-generations.ts";
import { arrivingHandoff, clearSpentArrivalMessages, workerProvenance } from "./handoffs.ts";
import type { Handoff } from "./records.ts";
import { advanceGeneration, appendTimelineEvent } from "./steps.ts";

export const CANCELLED_ON_FINISH = "cancelled-on-Finish";

type RunResultRow = {
  run_id: string;
  ending_id: string;
  ending_name: string;
  output: string | null;
  output_missing: 0 | 1;
  source_block_id: string;
  exit_id: string;
  author_block_id: string;
  origin_activation_id: string | null;
  origin_thread_id: string | null;
  intent_id: string;
  accepted_at: string;
};

const runResult = (row: RunResultRow): RunResult => ({
  endingId: row.ending_id,
  endingName: row.ending_name,
  output: row.output,
  outputMissing: row.output_missing === 1,
  sourceBlockId: row.source_block_id,
  exitId: row.exit_id,
  authorBlockId: row.author_block_id,
  origin: workerProvenance(row),
  deliveryId: row.intent_id,
  acceptedAt: row.accepted_at,
});

export function readRunResult(sql: SqlClient.SqlClient, runId: string) {
  return Effect.map(
    sql<RunResultRow>`SELECT r.*,t.thread_id AS origin_thread_id FROM run_results r LEFT JOIN run_thread_bindings t ON t.id=r.binding_id WHERE r.run_id=${runId}`,
    ([row]) => (row ? runResult(row) : null),
  );
}

function messageWriter(sql: SqlClient.SqlClient, handoff: Handoff) {
  return Effect.gen(function* () {
    const [writer] = yield* sql<{
      source_block_id: string | null;
    }>`WITH RECURSIVE chain(source_block_id,wait_arrival_id,condition_arrival_id,cause) AS (
        SELECT ${handoff.source_block_id},${handoff.wait_arrival_id},${handoff.condition_arrival_id},${handoff.cause}
        UNION ALL
        SELECT i.source_block_id,i.wait_arrival_id,i.condition_arrival_id,i.cause FROM chain c JOIN operation_intents i ON i.id=COALESCE(
          (SELECT a.incoming_intent_id FROM wait_arrivals a WHERE a.id=c.wait_arrival_id),
          (SELECT a.incoming_intent_id FROM condition_arrivals a WHERE a.id=c.condition_arrival_id),
          (SELECT v.incoming_intent_id FROM continuation_visits v WHERE v.run_id=${handoff.run_id} AND c.cause LIKE 'pass:' || v.id || '/%'))
      ) SELECT source_block_id FROM chain WHERE wait_arrival_id IS NULL AND condition_arrival_id IS NULL AND cause NOT LIKE 'pass:%'`;
    if (!writer?.source_block_id)
      return yield* Effect.fail(Error("A forwarded message lost its arrival"));
    return writer.source_block_id;
  });
}

export function openRunEndings(database: RunnerDatabase) {
  const ownerToken = database.owner.token;

  function reachEnding(current: RunRow, handoff: Handoff, generation: number | undefined) {
    return database.mutate(current.id, (sql) =>
      Effect.gen(function* (): Effect.fn.Return<RunResult | undefined, unknown> {
        const accepted = yield* readRunResult(sql, current.id);
        if (accepted?.deliveryId === handoff.id) return accepted;
        const arriving = yield* arrivingHandoff(sql, ownerToken, current.id, handoff, generation);
        if (!arriving) return undefined;
        const { endingId } = JSON.parse(arriving.record.target_json) as StoredTarget;
        const ending = current.definitions.flow.graph.finish?.endings.find(
          (entry) => entry.id === endingId,
        );
        if (!ending || !handoff.source_block_id || !handoff.exit_id)
          return yield* Effect.fail(Error("A delivery names no ending of the Run's Flow"));
        const author = yield* messageWriter(sql, handoff);
        const time = yield* now;
        const output = ending.output === "none" ? null : arriving.message;
        const missing = ending.output === "required" && !arriving.message.trim();
        yield* sql`INSERT INTO run_results(run_id,ending_id,ending_name,output,output_missing,source_block_id,exit_id,author_block_id,binding_id,origin_activation_id,intent_id,accepted_at)
          VALUES(${current.id},${ending.id},${ending.name},${output},${missing ? 1 : 0},${handoff.source_block_id},${handoff.exit_id},${author},${handoff.binding_id},${handoff.origin_activation_id},${handoff.id},${time})`;
        yield* sql`UPDATE runs SET gate_open=0 WHERE id=${current.id}`;
        yield* sql`UPDATE operation_intents SET state='acknowledged',payload_json=NULL,problem=NULL,reconciled_at=${time} WHERE id=${handoff.id}`;
        yield* appendTimelineEvent(sql, {
          kind: "ending-reached",
          runId: current.id,
          endingId: ending.id,
          observedAt: time,
        });
        const losers = yield* sql<{
          id: string;
        }>`UPDATE operation_intents SET state='cancelled',payload_json=NULL,problem=${CANCELLED_ON_FINISH},reconciled_at=${time} WHERE run_id=${current.id} AND kind='handoff' AND json_extract(target_json,'$.endingId') IS NOT NULL AND state='pending' RETURNING id`;
        for (const loser of losers)
          yield* appendTimelineEvent(sql, {
            kind: "operation-cancelled",
            runId: current.id,
            blockId: FINISH_BLOCK_ID,
            intentId: loser.id,
            observedAt: time,
          });
        yield* cancelTitleGeneration(sql, current.id, time, "finish");
        yield* clearSpentArrivalMessages(sql, current.id);
        yield* advanceGeneration(sql, current.id);
        return (yield* readRunResult(sql, current.id)) ?? undefined;
      }),
    );
  }

  const awaitingEndingSettlement = (runId: string) =>
    database.transaction((sql) =>
      Effect.map(
        sql`SELECT 1 FROM runs r JOIN run_results x ON x.run_id=r.id WHERE r.id=${runId} AND r.archived_at IS NULL AND r.settled_at IS NULL AND NOT EXISTS(SELECT 1 FROM run_settlements s WHERE s.run_id=r.id)`,
        (rows) => rows.length > 0,
      ),
    );

  return { reachEnding, awaitingEndingSettlement };
}
