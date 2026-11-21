import { createHash } from "node:crypto";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type { CommitImportInput, ImportResult, Result } from "@t3-factory/contracts";
import { failure } from "./result.ts";

/**
 * Version 2 fingerprints cover the import target. Version 1 receipts were written before imports
 * took a target, so each records a global import.
 */
type FingerprintVersion = 1 | 2;
const CURRENT_FINGERPRINT_VERSION: FingerprintVersion = 2;

interface ImportReceipt {
  readonly fingerprintVersion: FingerprintVersion;
  readonly fingerprint: string;
  readonly result: ImportResult;
}

/** JSON with object keys sorted at every level. Array order is content and is kept. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : entry,
  );
}

const sha256 = (content: unknown) =>
  createHash("sha256").update(canonicalJson(content)).digest("hex");

function fingerprintDocument(
  document: CommitImportInput["document"],
  legacyRevisitContext?: "keep",
) {
  if (document.kind !== "flow" || document.formatVersion === 4 || document.formatVersion === 5)
    return document;
  const { flow } = document;
  const blocks = flow.graph.blocks.map((block) =>
    block.kind === "agent" ? { ...block, revisitContext: legacyRevisitContext } : block,
  );
  return { ...document, flow: { ...flow, graph: { ...flow.graph, blocks } } };
}

const currentFingerprint = ({ document, selections, projectId = null }: CommitImportInput) =>
  sha256({ document: fingerprintDocument(document, "keep"), selections, projectId });

function matchesFingerprint(receipt: ImportReceipt, commit: CommitImportInput): boolean {
  const { document, selections, projectId = null } = commit;
  if (receipt.fingerprintVersion === 1)
    return (
      projectId === null &&
      receipt.fingerprint === sha256({ document: fingerprintDocument(document), selections })
    );
  if (receipt.fingerprint === currentFingerprint(commit)) return true;
  const legacyDocument = fingerprintDocument(document);
  return (
    legacyDocument !== document &&
    receipt.fingerprint === sha256({ document: legacyDocument, selections, projectId })
  );
}

export const readImportReceipt = Effect.fnUntraced(function* (
  sql: SqlClient.SqlClient,
  requestId: string,
) {
  const [receipt] = yield* sql<{
    fingerprint_version: FingerprintVersion;
    fingerprint: string;
    flow_id: string | null;
  }>`SELECT fingerprint_version, fingerprint, flow_id FROM definition_import_receipts
    WHERE request_id=${requestId}`;
  if (!receipt) return undefined;
  const agentRows = yield* sql<{ key: string; id: string }>`
    SELECT agent_key AS key, agent_id AS id FROM definition_import_receipt_agents
    WHERE request_id=${requestId} ORDER BY ordinal`;
  const flowRows = yield* sql<{ key: string; id: string }>`
    SELECT flow_key AS key, flow_id AS id FROM definition_import_receipt_flows
    WHERE request_id=${requestId} ORDER BY ordinal`;
  const agents = agentRows.map(({ key, id }) => ({ key, id }));
  const flows = flowRows.map(({ key, id }) => ({ key, id }));
  return {
    fingerprintVersion: receipt.fingerprint_version,
    fingerprint: receipt.fingerprint,
    result: { agents, flowId: receipt.flow_id, ...(flows.length ? { flows } : {}) },
  } satisfies ImportReceipt;
});

/** The original result for the same content and target; anything else under a used request id conflicts. */
export function replayedImport(
  receipt: ImportReceipt,
  commit: CommitImportInput,
): Result<ImportResult> {
  if (matchesFingerprint(receipt, commit)) return { ok: true, value: receipt.result };
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
  commit: CommitImportInput,
  createdAt: string,
  result: ImportResult,
) {
  const fingerprint = currentFingerprint(commit);
  yield* sql`INSERT INTO definition_import_receipts
    (request_id, fingerprint_version, fingerprint, flow_id, created_at)
    VALUES (${commit.requestId}, ${CURRENT_FINGERPRINT_VERSION}, ${fingerprint}, ${result.flowId}, ${createdAt})`;
  yield* Effect.forEach(
    result.agents,
    (agent, ordinal) =>
      sql`INSERT INTO definition_import_receipt_agents (request_id, ordinal, agent_key, agent_id)
        VALUES (${commit.requestId}, ${ordinal}, ${agent.key}, ${agent.id})`,
    { discard: true },
  );
  yield* Effect.forEach(
    result.flows ?? [],
    (flow, ordinal) =>
      sql`INSERT INTO definition_import_receipt_flows (request_id, ordinal, flow_key, flow_id)
        VALUES (${commit.requestId}, ${ordinal}, ${flow.key}, ${flow.id})`,
    { discard: true },
  );
});
