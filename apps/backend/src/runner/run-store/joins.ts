import { effectiveExits, handoffRecipients, joinSlots } from "@t3-factory/domain-validation";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { intactPayload } from "../../fingerprint.ts";
import { newId } from "../../ids.ts";
import { now } from "../../time.ts";
import type { RunRow } from "../runner-types.ts";
import { writeBlockState } from "./blocks.ts";
import type { RunnerDatabase } from "./database.ts";
import { arrivingHandoff, clearSpentArrivalMessages, createHandoffs } from "./handoffs.ts";
import type { Handoff } from "./records.ts";
import { advanceGeneration } from "./steps.ts";

type Head = {
  incoming_intent_id: string;
  source_block_id: string;
  exit_id: string;
  payload_json: string | null;
  fingerprint: string;
};

function section(label: string, exit: string, message: string) {
  let length = 3;
  for (const match of message.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return `## ${label} — ${exit}\n\n${fence}\n${message || "(no message)"}\n${fence}`;
}

function roundSections(run: RunRow, blockId: string, heads: readonly Head[]) {
  const { flow, agents, subflows } = run.definitions;
  const slots = joinSlots(flow.graph, blockId);
  const labels = slots.map((slot) => slot.label);
  const flows = new Map(subflows?.map((child) => [child.id, child]));
  if (slots.length < 2) throw Error("Join has fewer than two captured sources.");
  const bySource = new Map(heads.map((head) => [head.source_block_id, head]));
  if (heads.some((head) => !slots.some((slot) => slot.sourceBlockId === head.source_block_id)))
    throw Error("Unknown queued Join source.");
  if (heads.length !== slots.length) return null;
  return slots.map((slot, index) => {
    const head = bySource.get(slot.sourceBlockId)!;
    if (!slot.exitIds.includes(head.exit_id) || !intactPayload(head))
      throw Error("Invalid queued Join arrival.");
    const source = flow.graph.blocks.find((block) => block.id === slot.sourceBlockId)!;
    const exit = effectiveExits(source, agents, flows).find((exit) => exit.id === head.exit_id);
    if (!exit) throw Error("Unknown captured Join exit.");
    const message: unknown = JSON.parse(head.payload_json).message;
    if (typeof message !== "string") throw Error("Missing Join message.");
    const label =
      labels.indexOf(slot.label) === labels.lastIndexOf(slot.label)
        ? slot.label
        : `${slot.label} (${labels.slice(0, index + 1).filter((name) => name === slot.label).length})`;
    return section(label, exit.name || "Output", message);
  });
}

const forwardRound = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  run: RunRow,
  blockId: string,
  time: string,
) {
  const heads =
    yield* sql<Head>`SELECT a.incoming_intent_id,a.source_block_id,a.exit_id,i.payload_json,i.fingerprint
    FROM join_arrivals a JOIN operation_intents i ON i.id=a.incoming_intent_id WHERE a.ordinal IN
    (SELECT MIN(ordinal) FROM join_arrivals WHERE run_id=${run.id} AND block_id=${blockId} AND round_id IS NULL AND cancelled_at IS NULL GROUP BY source_block_id)`;
  const sections = roundSections(run, blockId, heads);
  if (!sections) return;
  const [latest] = yield* sql<{
    latest: number;
  }>`SELECT COALESCE(MAX(number),0) AS latest FROM join_rounds WHERE run_id=${run.id} AND block_id=${blockId}`;
  const number = latest!.latest + 1;
  if (!Number.isSafeInteger(number)) throw Error("Join round overflow.");
  const message = [`Join round ${number}`, ...sections].join("\n\n");
  const id = yield* newId;
  yield* sql`INSERT INTO join_rounds(id,run_id,block_id,number,forwarded_at,message) VALUES(${id},${run.id},${blockId},${number},${time},${message})`;
  const spent = sql.in(heads.map((head) => head.incoming_intent_id));
  yield* sql`UPDATE join_arrivals SET round_id=${id} WHERE incoming_intent_id IN ${spent}`;
  yield* sql`UPDATE operation_intents SET payload_json=NULL WHERE id IN ${spent}`;
  yield* createHandoffs(sql, run, {
    kind: "join",
    id,
    blockId,
    exitId: "output",
    recipients: handoffRecipients(run.definitions.flow.graph.connections, blockId, "output"),
    message,
    at: time,
    origin: null,
  });
});

export function openRunJoins(database: RunnerDatabase) {
  function handoffToJoinArrival(run: RunRow, handoff: Handoff, generation: number | undefined) {
    return database.mutate(
      run.id,
      (sql) =>
        Effect.gen(function* () {
          const arriving = yield* arrivingHandoff(
            sql,
            database.owner.token,
            run.id,
            handoff,
            generation,
          );
          if (!arriving) return false;
          const { id, block_id, source_block_id, exit_id } = arriving.record;
          const time = yield* now;
          yield* sql`INSERT INTO join_arrivals(incoming_intent_id,run_id,block_id,source_block_id,exit_id,arrived_at) VALUES(${id},${run.id},${block_id},${source_block_id},${exit_id},${time})`;
          yield* sql`UPDATE operation_intents SET state='acknowledged',reconciled_at=${time} WHERE id=${id}`;
          yield* forwardRound(sql, run, block_id, time);
          yield* writeBlockState(
            sql,
            { runId: run.id, blockId: block_id },
            { whileArrivalPending: "waiting", otherwise: "finished" },
            { freshness: "fresh", observed_at: time },
          );
          yield* clearSpentArrivalMessages(sql, run.id);
          yield* advanceGeneration(sql, run.id);
          return true;
        }),
      (changed) => changed,
    );
  }
  return { handoffToJoinArrival };
}
