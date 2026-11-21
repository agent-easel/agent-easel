import {
  SUBFLOW_INVOCATION_PAGE_DEFAULT,
  SUBFLOW_INVOCATION_PAGE_MAX,
  type Result,
  type SubflowInvocation,
  type SubflowInvocationPage,
  type SubflowPlacementSummary,
} from "@t3-factory/contracts";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { failure } from "../../result.ts";
import type { BlockRow } from "../runner-types.ts";
import type { RunnerDatabase } from "./database.ts";
import { endingResult, type EndingEvidenceRow } from "./endings.ts";
import type { Invocation } from "./invocation-entry.ts";
import { decodeCursor, encodeCursor } from "./read-cursor.ts";
import type { DeliveryRecord } from "./records.ts";
import { runBlock } from "./run-block-view.ts";

type Cursor = readonly ["subflow", string, string | null, string, number, number];

type Ending = EndingEvidenceRow & {
  invocation_id: string;
  released_at: string | null;
  cancelled_at: string | null;
};

type Recipient = {
  subflow_invocation_id: string;
  block_id: string;
  state: DeliveryRecord["state"];
  target_ending_id: string | null;
  total: number;
};

const disposition = (state: Recipient["state"]) =>
  state === "acknowledged" || state === "cancelled" ? state : "pending";

function endingView(row: Ending, recipients: readonly Recipient[]): SubflowInvocation["ending"] {
  return {
    ...endingResult(row),
    delivery: row.cancelled_at ? "cancelled" : row.released_at ? "released" : "held",
    releasedAt: row.released_at,
    cancelledAt: row.cancelled_at,
    recipientCount: recipients[0]?.total ?? 0,
    recipients: recipients.map((recipient) => ({
      blockId: recipient.block_id,
      targetEndingId: recipient.target_ending_id,
      disposition: disposition(recipient.state),
    })),
  };
}

function readInvocationViews(sql: SqlClient.SqlClient, invocations: readonly Invocation[]) {
  return Effect.gen(function* () {
    if (!invocations.length) return [];
    const ids = sql.in(invocations.map((row) => row.id));
    const blocks = yield* sql<BlockRow>`SELECT * FROM run_blocks
      WHERE invocation_id IN ${ids} AND template_block_id IS NOT NULL ORDER BY rowid`;
    const pendingLaunches =
      yield* sql<DeliveryRecord>`SELECT i.* FROM operation_intents i JOIN run_blocks b
      ON b.run_id=i.run_id AND b.block_id=i.block_id
      WHERE b.invocation_id IN ${ids} AND i.kind='launch' AND i.state IN ('pending','reserved','uncertain')`;
    const endings =
      yield* sql<Ending>`SELECT r.*,v.run_id,t.thread_id AS origin_thread_id FROM subflow_results r
      JOIN subflow_invocations v ON v.id=r.invocation_id LEFT JOIN run_thread_bindings t ON t.id=r.binding_id
      WHERE r.invocation_id IN ${ids}`;
    const recipients = yield* sql<Recipient>`SELECT * FROM (
      SELECT subflow_invocation_id,block_id,state,json_extract(target_json,'$.endingId') AS target_ending_id,
        COUNT(*) OVER (PARTITION BY subflow_invocation_id) AS total,
        ROW_NUMBER() OVER (PARTITION BY subflow_invocation_id ORDER BY rowid) AS position
      FROM operation_intents WHERE subflow_invocation_id IN ${ids} AND cause LIKE 'subflow:%'
    ) WHERE position<=100 ORDER BY subflow_invocation_id,position`;
    const stops = yield* sql<SubflowInvocation["stops"][number] & { invocationId: string }>`
      SELECT s.invocation_id AS invocationId,s.block_id AS blockId,s.thread_id AS threadId,
        s.attempt,s.requested_at AS requestedAt,s.outcome FROM subflow_worker_stops s
      JOIN subflow_invocations i ON i.id=s.invocation_id AND i.stop_attempt=s.attempt
      WHERE s.invocation_id IN ${ids} ORDER BY s.rowid`;
    const endingsById = new Map(endings.map((ending) => [ending.invocation_id, ending]));
    return invocations.map((row): SubflowInvocation => {
      const ending = endingsById.get(row.id);
      return {
        id: row.id,
        number: row.number,
        flowId: row.flow_id,
        placementBlockId: row.placement_block_id,
        parentInvocationId: row.parent_id,
        state: row.state,
        input: row.input,
        carriesStartImages: row.entry_input === 1,
        arrivedAt: row.arrived_at,
        completedAt: row.completed_at,
        blocks: blocks
          .filter((block) => block.invocation_id === row.id)
          .map((block) => runBlock(block, pendingLaunches, undefined, row.state === "active")),
        stops: stops
          .filter((stop) => stop.invocationId === row.id)
          .map(({ invocationId: _id, ...stop }) => stop),
        ending: ending
          ? endingView(
              ending,
              recipients.filter((recipient) => recipient.subflow_invocation_id === row.id),
            )
          : null,
      };
    });
  });
}

type Placement = {
  block_id: string;
  template_block_id: string;
  invocation_id: string | null;
  total: number;
  queued: number;
  selected: string | null;
};

const placingBlocks = (sql: SqlClient.SqlClient, runId: string) => sql`
  SELECT b.block_id,b.template_block_id,b.invocation_id FROM run_blocks b JOIN runs r ON r.id=b.run_id
  LEFT JOIN subflow_invocations i ON i.id=b.invocation_id
  LEFT JOIN run_subflow_revisions c ON c.run_id=i.run_id AND c.flow_id=i.flow_id
  JOIN flow_revision_blocks f ON f.flow_revision_id=COALESCE(c.flow_revision_id,r.flow_revision_id)
    AND f.block_id=COALESCE(b.template_block_id,b.block_id)
  WHERE b.run_id=${runId} AND f.kind='subflow'`;

export function readSubflowSummaries(sql: SqlClient.SqlClient, runId: string) {
  return Effect.gen(function* () {
    const placements = yield* sql<Placement>`WITH RECURSIVE
      placements AS (${placingBlocks(sql, runId)}),
      current AS (
        SELECT p.*,
          (SELECT COUNT(*) FROM subflow_invocations i WHERE i.run_id=${runId} AND i.placement_block_id=p.block_id) AS total,
          (SELECT COUNT(*) FROM subflow_invocations i WHERE i.run_id=${runId} AND i.placement_block_id=p.block_id AND state='queued') AS queued,
          COALESCE((SELECT id FROM subflow_invocations i WHERE i.run_id=${runId} AND i.placement_block_id=p.block_id
              AND state IN ('active','queued','stopping') ORDER BY number LIMIT 1),
            (SELECT id FROM subflow_invocations i WHERE i.run_id=${runId} AND i.placement_block_id=p.block_id ORDER BY number DESC LIMIT 1)) AS selected
        FROM placements p
      ),
      visible AS (
        SELECT * FROM current WHERE invocation_id IS NULL
        UNION ALL SELECT c.* FROM current c JOIN visible v ON c.invocation_id=v.selected
      )
      SELECT * FROM visible`;
    const selected = placements.flatMap((placement) =>
      placement.selected ? [placement.selected] : [],
    );
    const rows = selected.length
      ? yield* sql<Invocation>`SELECT * FROM subflow_invocations WHERE id IN ${sql.in(selected)}`
      : [];
    const views = yield* readInvocationViews(sql, rows);
    const byId = new Map(views.map((view) => [view.id, view]));
    return placements.map((placement): SubflowPlacementSummary => ({
      blockId: placement.block_id,
      templateBlockId: placement.template_block_id,
      parentInvocationId: placement.invocation_id,
      total: placement.total,
      queued: placement.queued,
      defaultInvocation: placement.selected ? byId.get(placement.selected)! : null,
    }));
  });
}

const invalidLimit = failure("validation", "Ask for 1 to 100 invocations per page.", [
  { code: "subflow_page_limit", path: "limit", message: "Use a whole number from 1 to 100." },
]);
const invalidCursor = failure(
  "validation",
  "This cursor does not continue this placement's invocations.",
  [
    {
      code: "subflow_page_cursor",
      path: "cursor",
      message: "Read the first page again without a cursor.",
    },
  ],
);

export function openInvocationReads(database: RunnerDatabase) {
  function listSubflowInvocations(
    runId: string,
    blockId: string,
    limit?: number,
    cursorText?: string,
  ) {
    const size = limit ?? SUBFLOW_INVOCATION_PAGE_DEFAULT;
    if (!Number.isInteger(size) || size < 1 || size > SUBFLOW_INVOCATION_PAGE_MAX)
      return Effect.succeed(invalidLimit);
    return database.transaction((sql) =>
      Effect.gen(function* (): Effect.fn.Return<Result<SubflowInvocationPage>, unknown> {
        const [placement] = yield* sql<
          Pick<Placement, "invocation_id">
        >`SELECT invocation_id FROM (${placingBlocks(sql, runId)}) WHERE block_id=${blockId}`;
        if (!placement) return failure("not_found", "This Run has no such Subflow placement.");
        const [latest] = yield* sql<{ number: number }>`SELECT number FROM subflow_invocations
        WHERE run_id=${runId} AND placement_block_id=${blockId} ORDER BY number DESC LIMIT 1`;
        const committed = latest?.number ?? 0;
        const cursor = cursorText === undefined ? null : decodeCursor<Cursor>(cursorText);
        if (
          cursorText !== undefined &&
          (!cursor ||
            cursor[0] !== "subflow" ||
            cursor[1] !== runId ||
            cursor[2] !== placement.invocation_id ||
            cursor[3] !== blockId ||
            cursor[4] > committed ||
            cursor[5] < 1 ||
            cursor[5] > cursor[4])
        )
          return invalidCursor;
        const highWater = cursor?.[4] ?? committed;
        const before = cursor?.[5] ?? null;
        const rows = yield* sql<Invocation>`SELECT * FROM subflow_invocations
        WHERE run_id=${runId} AND placement_block_id=${blockId} AND number<=${highWater}
          AND (${before} IS NULL OR number<${before})
        ORDER BY number DESC LIMIT ${size + 1}`;
        const page = rows.slice(0, size);
        return {
          ok: true,
          value: {
            highWater,
            invocations: yield* readInvocationViews(sql, page),
            nextCursor:
              rows.length > size
                ? encodeCursor<Cursor>([
                    "subflow",
                    runId,
                    placement.invocation_id,
                    blockId,
                    highWater,
                    page.at(-1)!.number,
                  ])
                : null,
          },
        };
      }),
    );
  }
  return { listSubflowInvocations };
}
