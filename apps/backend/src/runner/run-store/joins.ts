import {
  effectiveExits,
  handoffEndings,
  handoffRecipients,
  joinSlots,
  type JoinSlot,
} from "@t3-factory/domain-validation";
import type { RunDefinitions } from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { Fragment } from "effect/sql/Statement";
import { intactPayload } from "../../fingerprint.ts";
import { newId } from "../../ids.ts";
import { now } from "../../time.ts";
import type { Checked, RunRow } from "../runner-types.ts";
import { unverified, verified } from "../runner-utils.ts";
import { latchIntegrityProblem } from "./attention.ts";
import { writeBlockState } from "./blocks.ts";
import type { RunnerDatabase } from "./database.ts";
import { clearSpentArrivalMessages, createHandoffs, pendingHandoff } from "./handoffs.ts";
import type { DeliveryRecord, Handoff } from "./records.ts";
import { advanceGeneration, appendTimelineEvent } from "./steps.ts";

const JOIN_OUTPUT = "output";

type QueuedArrival = {
  ordinal: number;
  source_block_id: string;
  exit_id: string;
  intent_id: string | null;
  kind: string | null;
  state: string | null;
  intent_block_id: string | null;
  intent_source_block_id: string | null;
  intent_exit_id: string | null;
  has_payload: number | null;
};

type Head = { readonly intent: string; readonly source: string; readonly exit: string };

type Round = {
  readonly number: number;
  readonly message: string;
  readonly spent: readonly string[];
};

function section(label: string, exit: string, message: string) {
  let length = 3;
  for (const match of message.matchAll(/`+/g)) length = Math.max(length, match[0].length + 1);
  const fence = "`".repeat(length);
  return `## ${label} — ${exit}\n\n${fence}\n${message || "(no message)"}\n${fence}`;
}

function joinTopology(definitions: RunDefinitions, blockId: string) {
  const { flow, agents, subflows } = definitions;
  const { blocks, connections, flowInput } = flow.graph;
  if (blocks.find((block) => block.id === blockId)?.kind !== "join")
    return unverified("The captured block is not a Join.");
  const flows = new Map(subflows?.map((child) => [child.id, child]));
  for (const wire of connections) {
    if (wire.targetEndingId !== undefined || wire.targetBlockId !== blockId) continue;
    const source = blocks.find((block) => block.id === wire.sourceBlockId);
    if (!source || !effectiveExits(source, agents, flows).some((exit) => exit.id === wire.exitId))
      return unverified("A wire into the captured Join leaves a source or exit that is missing.");
  }
  if (flowInput.targetBlockIds.includes(blockId))
    return unverified("The Flow input feeds the captured Join.");
  const slots = joinSlots(flow.graph, blockId);
  if (slots.length < 2) return unverified("The captured Join has fewer than two sources.");
  if (connections.some((wire) => wire.sourceBlockId === blockId && wire.exitId !== JOIN_OUTPUT))
    return unverified("A wire leaves the captured Join by an exit it lacks.");
  const recipients = handoffRecipients(connections, blockId, JOIN_OUTPUT);
  if (
    recipients.some((id) => !blocks.some((block) => block.id === id)) ||
    recipients.length + handoffEndings(connections, blockId, JOIN_OUTPUT).length === 0
  )
    return unverified("The captured Join's output reaches no recipient or Finish ending.");
  return verified({ slots, flows });
}

function roundMessage(
  definitions: RunDefinitions,
  slots: readonly JoinSlot[],
  flows: Parameters<typeof effectiveExits>[2],
  messages: ReadonlyMap<string, string>,
  heads: ReadonlyMap<string, Head>,
  number: number,
): Checked<string> {
  const labels = slots.map((slot) => slot.label);
  const sections: string[] = [];
  for (const [index, slot] of slots.entries()) {
    const head = heads.get(slot.sourceBlockId)!;
    const source = definitions.flow.graph.blocks.find((block) => block.id === slot.sourceBlockId)!;
    const exit = effectiveExits(source, definitions.agents, flows).find(
      (entry) => entry.id === head.exit,
    );
    if (!exit) return unverified("A queued arrival's exit is missing from its captured source.");
    const label =
      labels.indexOf(slot.label) === labels.lastIndexOf(slot.label)
        ? slot.label
        : `${slot.label} (${labels.slice(0, index + 1).filter((name) => name === slot.label).length})`;
    sections.push(section(label, exit.name || "Output", messages.get(head.intent)!));
  }
  return verified([`Join round ${number}`, ...sections].join("\n\n"));
}

const messageOf = (payload: string) => (JSON.parse(payload) as { message?: unknown }).message;

type Wired = (source: string | null, exit: string | null) => boolean;

const wiredBy =
  (slots: readonly JoinSlot[]): Wired =>
  (source, exit) =>
    slots.some((slot) => slot.sourceBlockId === source && slot.exitIds.includes(exit ?? ""));

function incomingHead(incoming: DeliveryRecord, wired: Wired): Checked<Head & { message: string }> {
  if (incoming.kind !== "handoff" || !wired(incoming.source_block_id, incoming.exit_id))
    return unverified("The delivery is not a Handoff from a captured source and exit of the Join.");
  const message =
    incoming.payload_json && intactPayload(incoming) ? messageOf(incoming.payload_json) : undefined;
  if (typeof message !== "string")
    return unverified("The delivery's message is missing or altered.");
  return verified({
    intent: incoming.id,
    source: incoming.source_block_id!,
    exit: incoming.exit_id!,
    message,
  });
}

function queuedHeads(queue: readonly QueuedArrival[], blockId: string, wired: Wired) {
  const heads = new Map<string, Head>();
  for (const row of queue) {
    if (row.intent_id === null) return unverified("A queued arrival's Handoff is missing.");
    const matches =
      row.kind === "handoff" &&
      row.state === "acknowledged" &&
      row.intent_block_id === blockId &&
      row.intent_source_block_id === row.source_block_id &&
      row.intent_exit_id === row.exit_id &&
      wired(row.source_block_id, row.exit_id);
    if (!matches) return unverified("A queued arrival no longer matches its acknowledged Handoff.");
    if (!row.has_payload) return unverified("A queued arrival's message is missing.");
    if (!heads.has(row.source_block_id))
      heads.set(row.source_block_id, {
        intent: row.intent_id,
        source: row.source_block_id,
        exit: row.exit_id,
      });
  }
  return verified(heads);
}

const headMessages = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  heads: ReadonlyMap<string, Head>,
): Effect.fn.Return<Checked<Map<string, string>>, unknown> {
  const messages = new Map<string, string>();
  if (!heads.size) return verified(messages);
  const stored = yield* sql<
    Pick<DeliveryRecord, "id" | "payload_json" | "fingerprint">
  >`SELECT id,payload_json,fingerprint FROM operation_intents WHERE id IN ${sql.in([...heads.values()].map((head) => head.intent))}`;
  for (const intent of stored) {
    const message = intactPayload(intent) ? messageOf(intent.payload_json) : undefined;
    if (typeof message !== "string")
      return unverified("A queued arrival's message is missing or altered.");
    messages.set(intent.id, message);
  }
  return verified(messages);
});

const nextRoundNumber = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  runId: string,
  blockId: string,
) {
  const [latest] = yield* sql<{
    latest: number;
  }>`SELECT COALESCE(MAX(number),0) AS latest FROM join_rounds WHERE run_id=${runId} AND block_id=${blockId}`;
  const number = latest!.latest + 1;
  return Number.isSafeInteger(number)
    ? verified(number)
    : unverified("The Join's next round number is not representable.");
});

const checkDelivery = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  run: RunRow,
  incoming: DeliveryRecord,
): Effect.fn.Return<Checked<Round | null>, unknown> {
  const blockId = incoming.block_id;
  const topology = joinTopology(run.definitions, blockId);
  if (!topology.ok) return topology;
  const { slots, flows } = topology.value;
  const wired = wiredBy(slots);
  const arriving = incomingHead(incoming, wired);
  if (!arriving.ok) return arriving;
  const queue =
    yield* sql<QueuedArrival>`SELECT a.ordinal,a.source_block_id,a.exit_id,i.id AS intent_id,i.kind,i.state,i.block_id AS intent_block_id,i.source_block_id AS intent_source_block_id,i.exit_id AS intent_exit_id,i.payload_json IS NOT NULL AS has_payload
    FROM join_arrivals a LEFT JOIN operation_intents i ON i.id=a.incoming_intent_id
    WHERE a.run_id=${run.id} AND a.block_id=${blockId} AND a.round_id IS NULL AND a.cancelled_at IS NULL ORDER BY a.ordinal`;
  const queued = queuedHeads(queue, blockId, wired);
  if (!queued.ok) return queued;
  const messages = yield* headMessages(sql, queued.value);
  if (!messages.ok) return messages;
  const heads = new Map(queued.value);
  if (!heads.has(arriving.value.source)) {
    heads.set(arriving.value.source, arriving.value);
    messages.value.set(arriving.value.intent, arriving.value.message);
  }
  if (slots.some((slot) => !heads.has(slot.sourceBlockId))) return verified(null);
  const number = yield* nextRoundNumber(sql, run.id, blockId);
  if (!number.ok) return number;
  const message = roundMessage(run.definitions, slots, flows, messages.value, heads, number.value);
  if (!message.ok) return message;
  return verified({
    number: number.value,
    message: message.value,
    spent: [...heads.values()].map((head) => head.intent),
  });
});

const forwardRound = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  run: RunRow,
  blockId: string,
  round: Round,
  time: string,
) {
  const id = yield* newId;
  yield* sql`INSERT INTO join_rounds(id,run_id,block_id,number,forwarded_at,message) VALUES(${id},${run.id},${blockId},${round.number},${time},${round.message})`;
  const spent = sql.in(round.spent);
  yield* sql`UPDATE join_arrivals SET round_id=${id} WHERE incoming_intent_id IN ${spent}`;
  yield* sql`UPDATE operation_intents SET payload_json=NULL WHERE id IN ${spent}`;
  yield* appendTimelineEvent(sql, {
    kind: "join-round-forwarded",
    runId: run.id,
    blockId,
    joinRoundId: id,
    observedAt: time,
  });
  yield* createHandoffs(sql, run, {
    kind: "join",
    id,
    blockId,
    exitId: JOIN_OUTPUT,
    recipients: handoffRecipients(run.definitions.flow.graph.connections, blockId, JOIN_OUTPUT),
    message: round.message,
    at: time,
    origin: null,
  });
});

export function cancelJoinArrivals(
  sql: SqlClient.SqlClient,
  runId: string,
  scope: Fragment | null,
  time: string,
) {
  return Effect.gen(function* () {
    const inScope = scope ? sql`AND block_id IN (${scope})` : sql``;
    const joins = yield* sql<{
      block_id: string;
    }>`SELECT DISTINCT block_id FROM join_arrivals WHERE run_id=${runId} AND round_id IS NULL AND cancelled_at IS NULL ${inScope}`;
    for (const { block_id: blockId } of joins) {
      yield* sql`UPDATE operation_intents SET payload_json=NULL WHERE id IN (SELECT incoming_intent_id FROM join_arrivals WHERE run_id=${runId} AND block_id=${blockId} AND round_id IS NULL AND cancelled_at IS NULL)`;
      yield* sql`UPDATE join_arrivals SET cancelled_at=${time} WHERE run_id=${runId} AND block_id=${blockId} AND round_id IS NULL AND cancelled_at IS NULL`;
      const id = yield* newId;
      const recorded =
        yield* sql`INSERT INTO join_cancellations(id,run_id,block_id,round_number,cancelled_at)
        SELECT ${id},${runId},${blockId},COALESCE(MAX(number),0)+1,${time} FROM join_rounds WHERE run_id=${runId} AND block_id=${blockId}
        ON CONFLICT(run_id,block_id,round_number) DO NOTHING RETURNING id`;
      if (recorded.length)
        yield* appendTimelineEvent(sql, {
          kind: "join-round-cancelled",
          runId,
          blockId,
          joinRoundId: id,
          observedAt: time,
        });
    }
  });
}

export function openRunJoins(database: RunnerDatabase) {
  function handoffToJoinArrival(run: RunRow, handoff: Handoff, generation: number | undefined) {
    return database.mutate(
      run.id,
      (sql) =>
        Effect.gen(function* () {
          const incoming = yield* pendingHandoff(
            sql,
            database.owner.token,
            run.id,
            handoff,
            generation,
          );
          if (!incoming) return false;
          const blockId = incoming.block_id;
          const [latched] =
            yield* sql`SELECT id FROM run_attention WHERE run_id=${run.id} AND block_id=${blockId} AND kind='join-integrity' AND settled_at IS NULL`;
          if (latched) return false;
          const time = yield* now;
          const checked = yield* checkDelivery(sql, run, incoming);
          if (!checked.ok) {
            const changed = yield* latchIntegrityProblem(
              sql,
              run.id,
              blockId,
              "join-integrity",
              checked.problem,
              time,
            );
            if (changed) yield* advanceGeneration(sql, run.id);
            return changed;
          }
          yield* sql`INSERT INTO join_arrivals(incoming_intent_id,run_id,block_id,source_block_id,exit_id,arrived_at) VALUES(${incoming.id},${run.id},${blockId},${incoming.source_block_id},${incoming.exit_id},${time})`;
          yield* sql`UPDATE operation_intents SET state='acknowledged',reconciled_at=${time} WHERE id=${incoming.id}`;
          if (checked.value) yield* forwardRound(sql, run, blockId, checked.value, time);
          yield* writeBlockState(
            sql,
            { runId: run.id, blockId },
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
