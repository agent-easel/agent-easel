import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { RunImageMimeType } from "@t3-factory/contracts";
import { definitionsAtBlock } from "./run-definitions.ts";
import type { BlockRow } from "../runner-types.ts";
import type { RunnerDatabase } from "./database.ts";

type ImageRow = {
  image_id: string;
  ordinal: number;
  name: string;
  mime_type: RunImageMimeType;
  size_bytes: number;
};

export function openRunReads(database: RunnerDatabase) {
  const { run, transaction } = database;
  return {
    invocationStopAlreadyRequested: (runId: string, threadId: string) =>
      transaction((sql) =>
        Effect.map(
          sql`SELECT 1 FROM subflow_worker_stops s JOIN subflow_invocations i ON i.id=s.invocation_id
        WHERE i.run_id=${runId} AND s.thread_id=${threadId} AND s.execution_id IS (
          SELECT execution_id FROM run_executions WHERE run_id=${runId} AND thread_id=${threadId}
          ORDER BY ordinal DESC,rowid DESC LIMIT 1)`,
          (rows) => rows.length > 0,
        ),
      ),
    invocationInput: (invocationId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<{
            input: string;
            entry_input: number;
            state: string;
          }>`SELECT input,entry_input,state FROM subflow_invocations WHERE id=${invocationId}`,
          ([row]) => row,
        ),
      ),
    routedMessage: (runId: string, cause: string) =>
      transaction((sql) =>
        Effect.map(
          sql<{
            message: string | null;
          }>`SELECT COALESCE(j.message,c.message) AS message FROM operation_intents i
        LEFT JOIN join_rounds j ON j.id=i.join_round_id LEFT JOIN condition_arrivals c ON c.id=i.condition_arrival_id
        WHERE i.run_id=${runId} AND i.cause=${cause}`,
          ([row]) => row?.message ?? null,
        ),
      ),
    subflowReturnMessage: (runId: string, invocationId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<{
            output: string | null;
          }>`SELECT x.output FROM subflow_results x JOIN subflow_invocations v ON v.id=x.invocation_id
        WHERE v.run_id=${runId} AND v.id=${invocationId} AND x.released_at IS NOT NULL`,
          ([row]) => (row ? (row.output ?? "") : null),
        ),
      ),
    definitionsAtBlock: (run: Parameters<typeof definitionsAtBlock>[1], blockId: string) =>
      transaction((sql) => definitionsAtBlock(sql, run, blockId)),
    executedBlockCount: (runId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<{ count: number }>`SELECT COUNT(*) AS count FROM (
            SELECT block_id FROM run_activations WHERE run_id=${runId}
            UNION SELECT block_id FROM human_occurrences WHERE run_id=${runId}
            UNION SELECT block_id FROM join_arrivals WHERE run_id=${runId}
            UNION SELECT block_id FROM wait_arrivals WHERE run_id=${runId}
            UNION SELECT block_id FROM continuation_visits WHERE run_id=${runId}
            UNION SELECT block_id FROM condition_counters WHERE run_id=${runId} AND arrivals>0
            UNION SELECT i.placement_block_id FROM subflow_invocations i WHERE i.run_id=${runId}
              AND EXISTS(SELECT 1 FROM run_blocks b WHERE b.run_id=i.run_id AND b.invocation_id=i.id)
            UNION SELECT b.block_id FROM subflow_results r JOIN run_blocks b
              ON b.invocation_id=r.invocation_id AND b.template_block_id IS NULL
              WHERE b.run_id=${runId}
          )`,
          ([row]) => row!.count,
        ),
      ),
    acceptedStart: (requestId: string) =>
      run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return (yield* sql<{
            id: string;
            request_fingerprint: string;
            created_at: string;
          }>`SELECT id,request_fingerprint,created_at FROM runs WHERE request_id=${requestId}`)[0];
        }),
      ),
    /** The Human occurrence an attributed answer request applied to, if it did. */
    answeredByRequest: (requestId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<{
            run_id: string;
          }>`SELECT run_id FROM human_occurrences WHERE answer_request_id=${requestId}`,
          (rows) => rows[0],
        ),
      ),
    /** The Run an attributed Archive request archived, if it did. */
    archivedByRequest: (requestId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<{ id: string }>`SELECT id FROM runs WHERE archive_request_id=${requestId}`,
          (rows) => rows[0],
        ),
      ),
    readBlock: (runId: string, blockId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<BlockRow>`SELECT * FROM run_blocks WHERE run_id=${runId} AND block_id=${blockId}`,
          (rows) => rows[0],
        ),
      ),
    boundWorkerThreads: (environmentId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<{
            thread_id: string;
          }>`SELECT thread_id FROM run_thread_bindings WHERE environment_id=${environmentId}`,
          (rows) => new Set(rows.map((row) => row.thread_id)),
        ),
      ),
    blocksWithWorkers: (runId: string) =>
      run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<BlockRow>`SELECT b.* FROM run_blocks b WHERE b.run_id=${runId} AND b.thread_id IS NOT NULL
            AND (NOT EXISTS(SELECT 1 FROM subflow_invocations i WHERE i.id=b.invocation_id AND i.state<>'active')
              OR EXISTS(SELECT 1 FROM continuation_visits v JOIN run_thread_bindings t ON t.id=v.binding_id
                WHERE v.run_id=b.run_id AND t.thread_id=b.thread_id AND v.state='sent'))`;
        }),
      ),
    recoverySource: (intentId: string) =>
      run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return (yield* sql<{
            source_execution_id: string;
          }>`SELECT source_execution_id FROM report_recoveries WHERE intent_id=${intentId}`)[0];
        }),
      ),
    blockImages: (runId: string) =>
      transaction(
        (sql) =>
          sql<ImageRow>`SELECT image_id, ordinal, name, mime_type, size_bytes FROM run_images WHERE run_id=${runId} ORDER BY ordinal`,
      ),
    blockImage: (runId: string, imageId: string) =>
      transaction((sql) =>
        Effect.map(
          sql<
            ImageRow & { sha256: string }
          >`SELECT image_id, ordinal, name, mime_type, size_bytes, sha256 FROM run_images WHERE run_id=${runId} AND image_id=${imageId}`,
          (rows) => rows[0],
        ),
      ),
  };
}
