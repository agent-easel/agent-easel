import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { CommitImportInput, ImportResult, Result } from "@t3-factory/contracts";
import { failure } from "./result.ts";

interface ImportReceipt {
  readonly fingerprint: string;
  readonly result: ImportResult;
}

/**
 * The content a request id commits to: the decoded document and the selections, both rebuilt by
 * the validator in a fixed field and Agent order, so equal content always hashes equally.
 */
export const importFingerprint = ({ document, selections }: CommitImportInput) =>
  createHash("sha256").update(JSON.stringify({ document, selections })).digest("hex");

export const readImportReceipt = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  requestId: string,
) {
  const [receipt] = yield* sql<{
    fingerprint: string;
    flow_id: string | null;
  }>`SELECT fingerprint, flow_id FROM definition_import_receipts WHERE request_id=${requestId}`;
  if (!receipt) return undefined;
  const rows = yield* sql<{ key: string; id: string }>`
    SELECT agent_key AS key, agent_id AS id FROM definition_import_receipt_agents
    WHERE request_id=${requestId} ORDER BY ordinal`;
  const agents = rows.map(({ key, id }) => ({ key, id }));
  return {
    fingerprint: receipt.fingerprint,
    result: { agents, flowId: receipt.flow_id },
  } satisfies ImportReceipt;
});

/** The original result for the same content; other content under a used request id conflicts. */
export function replayedImport(receipt: ImportReceipt, fingerprint: string): Result<ImportResult> {
  if (receipt.fingerprint === fingerprint) return { ok: true, value: receipt.result };
  return failure("conflict", "This import request was already committed with different content.", [
    {
      code: "import_request_conflict",
      path: "requestId",
      message: "Start a new import to commit different content.",
    },
  ]);
}

/** Records a commit; callers own the transaction that created the definitions it names. */
export const writeImportReceipt = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  requestId: string,
  fingerprint: string,
  createdAt: string,
  result: ImportResult,
) {
  yield* sql`INSERT INTO definition_import_receipts (request_id, fingerprint, flow_id, created_at)
    VALUES (${requestId}, ${fingerprint}, ${result.flowId}, ${createdAt})`;
  yield* Effect.forEach(
    result.agents,
    (agent, ordinal) =>
      sql`INSERT INTO definition_import_receipt_agents (request_id, ordinal, agent_key, agent_id)
        VALUES (${requestId}, ${ordinal}, ${agent.key}, ${agent.id})`,
    { discard: true },
  );
});
