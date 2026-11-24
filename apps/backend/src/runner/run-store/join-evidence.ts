import {
  JOIN_QUEUED_LISTED,
  type JoinArrival,
  type JoinDetail,
  type JoinOutcome,
  type JoinSummary,
  type Result,
  type RunDefinitions,
} from "@agent-easel/contracts";
import { effectiveExits, joinSlots } from "@agent-easel/domain-validation";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { failure } from "../../result.ts";
import type { ExecutionDefinitions } from "../runner-types.ts";
import type { RunnerDatabase } from "./database.ts";
import { definitionsAtBlock, readRunDefinitions } from "./run-definitions.ts";

type Scoped = {
  readonly id: string;
  readonly definitions: RunDefinitions;
};

function capturedSlots(definitions: ExecutionDefinitions, blockId: string) {
  const { flow } = definitions;
  if (flow.graph.blocks.find((block) => block.id === blockId)?.kind !== "join") return undefined;
  return joinSlots(flow.graph, blockId);
}

type Outcome = { block_id: string; round: number; at: string };

function latestOutcomes(sql: SqlClient.SqlClient, runId: string) {
  return Effect.gen(function* () {
    const forwarded =
      yield* sql<Outcome>`SELECT r.block_id,r.number AS round,r.forwarded_at AS at FROM join_rounds r
      WHERE r.run_id=${runId} AND r.number=(SELECT MAX(n.number) FROM join_rounds n WHERE n.run_id=r.run_id AND n.block_id=r.block_id)`;
    const cancelled =
      yield* sql<Outcome>`SELECT c.block_id,c.round_number AS round,c.cancelled_at AS at FROM join_cancellations c
      WHERE c.run_id=${runId} AND c.round_number=(SELECT MAX(n.round_number) FROM join_cancellations n WHERE n.run_id=c.run_id AND n.block_id=c.block_id)`;
    return { forwarded, cancelled };
  });
}

const outcome = (
  forwarded: Outcome | undefined,
  cancelled: Outcome | undefined,
): JoinOutcome | null => {
  if (cancelled && (!forwarded || cancelled.round > forwarded.round))
    return { round: cancelled.round, outcome: "cancelled", at: cancelled.at };
  return forwarded ? { round: forwarded.round, outcome: "forwarded", at: forwarded.at } : null;
};

export function readJoinSummaries(
  sql: SqlClient.SqlClient,
  run: Scoped,
  blocks: readonly { readonly block_id: string; readonly template_block_id: string | null }[],
) {
  return Effect.gen(function* () {
    const known = [run.definitions.flow, ...(run.definitions.subflows ?? [])];
    const candidates = blocks.filter((block) =>
      known.some((flow) =>
        flow.graph.blocks.some(
          (entry) =>
            entry.id === (block.template_block_id ?? block.block_id) && entry.kind === "join",
        ),
      ),
    );
    if (!candidates.length) return [];
    const { forwarded, cancelled } = yield* latestOutcomes(sql, run.id);
    const pending = yield* sql<{
      block_id: string;
      source_block_id: string;
      waiting: number;
    }>`SELECT block_id,source_block_id,COUNT(*) AS waiting FROM join_arrivals WHERE run_id=${run.id} AND round_id IS NULL AND cancelled_at IS NULL GROUP BY block_id,source_block_id`;
    const summaries: JoinSummary[] = [];
    for (const { block_id: blockId } of candidates) {
      const slots = capturedSlots(yield* definitionsAtBlock(sql, run, blockId), blockId);
      if (!slots) continue;
      const latestForwarded = forwarded.find((row) => row.block_id === blockId);
      const latestCancelled = cancelled.find((row) => row.block_id === blockId);
      const queues = pending.filter(
        (row) =>
          row.block_id === blockId &&
          slots.some((slot) => slot.sourceBlockId === row.source_block_id),
      );
      const latest = outcome(latestForwarded, latestCancelled);
      summaries.push({
        blockId,
        round: Math.min((latest?.round ?? 0) + 1, Number.MAX_SAFE_INTEGER),
        sources: slots.length,
        arrived: queues.length,
        queued: queues.reduce((total, row) => total + row.waiting - 1, 0),
        latest,
      });
    }
    return summaries;
  });
}

type LatestRow = {
  source_block_id: string;
  exit_id: string;
  arrived_at: string;
};

type QueueRow = LatestRow & {
  position: number;
  total: number;
};

export function openJoinEvidence(database: RunnerDatabase) {
  function getRunJoin(runId: string, blockId: string): Effect.Effect<Result<JoinDetail>, unknown> {
    return database.transaction((sql) =>
      Effect.gen(function* () {
        const [saved] = yield* sql<{
          id: string;
          flow_revision_id: string;
        }>`SELECT id,flow_revision_id FROM runs WHERE id=${runId}`;
        if (!saved) return failure("not_found", "This Run does not exist.");
        const [block] =
          yield* sql`SELECT block_id FROM run_blocks WHERE run_id=${runId} AND block_id=${blockId}`;
        if (!block) return failure("not_found", "This Run has no such Join.");
        const run = { id: runId, definitions: yield* readRunDefinitions(sql, saved) };
        const definitions = yield* definitionsAtBlock(sql, run, blockId);
        const slots = capturedSlots(definitions, blockId);
        if (!slots) return failure("not_found", "This Run has no such Join.");
        const flows = new Map(definitions.subflows?.map((child) => [child.id, child]));
        const queue =
          yield* sql<QueueRow>`SELECT source_block_id,exit_id,arrived_at,position,total FROM (
          SELECT source_block_id,exit_id,arrived_at,
            ROW_NUMBER() OVER (PARTITION BY source_block_id ORDER BY ordinal) AS position,
            COUNT(*) OVER (PARTITION BY source_block_id) AS total
          FROM join_arrivals WHERE run_id=${runId} AND block_id=${blockId} AND round_id IS NULL AND cancelled_at IS NULL
        ) WHERE position<=${JOIN_QUEUED_LISTED + 1} ORDER BY source_block_id,position`;
        const { forwarded, cancelled } = yield* latestOutcomes(sql, runId);
        const latest = outcome(
          forwarded.find((row) => row.block_id === blockId),
          cancelled.find((row) => row.block_id === blockId),
        );
        const latestRows = !latest
          ? []
          : latest.outcome === "forwarded"
            ? yield* sql<LatestRow>`SELECT a.source_block_id,a.exit_id,a.arrived_at FROM join_arrivals a
              JOIN join_rounds r ON r.id=a.round_id
              WHERE r.run_id=${runId} AND r.block_id=${blockId} AND r.number=${latest.round}`
            : yield* sql<LatestRow>`SELECT source_block_id,exit_id,arrived_at FROM join_arrivals
              WHERE run_id=${runId} AND block_id=${blockId} AND cancelled_at=${latest.at} AND ordinal IN (
                SELECT MIN(ordinal) FROM join_arrivals
                WHERE run_id=${runId} AND block_id=${blockId} AND cancelled_at=${latest.at} GROUP BY source_block_id)`;
        return {
          ok: true as const,
          value: {
            blockId,
            round: Math.min((latest?.round ?? 0) + 1, Number.MAX_SAFE_INTEGER),
            sources: slots.map((slot) => {
              const source = definitions.flow.graph.blocks.find(
                (entry) => entry.id === slot.sourceBlockId,
              )!;
              const exits = effectiveExits(source, definitions.agents, flows);
              const rows = queue.filter((row) => row.source_block_id === slot.sourceBlockId);
              const arrival = (row: LatestRow): JoinArrival => ({
                exitId: row.exit_id,
                exitName: exits.find((exit) => exit.id === row.exit_id)?.name || "Output",
                arrivedAt: row.arrived_at,
              });
              const arrivals = rows.map(arrival);
              const inLatest = latestRows.find((row) => row.source_block_id === slot.sourceBlockId);
              return {
                sourceBlockId: slot.sourceBlockId,
                name: slot.label,
                arrived: arrivals[0] ?? null,
                queued: Math.max((rows[0]?.total ?? 1) - 1, 0),
                extras: arrivals.slice(1),
                latestArrival: inLatest ? arrival(inLatest) : null,
              };
            }),
            latest,
          },
        };
      }),
    );
  }

  return { getRunJoin };
}
