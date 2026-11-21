import {
  CONDITION_ARRIVAL_PAGE_DEFAULT,
  CONDITION_ARRIVAL_PAGE_MAX,
  CONDITION_OTHERWISE_ID,
  type ConditionArrivalEvidence,
  type ConditionArrivalPage,
  type ConditionRecipientDisposition,
  type Result,
} from "@t3-factory/contracts";
import { decodeCursor, encodeCursor } from "./read-cursor.ts";
import * as Effect from "effect/Effect";
import { failure } from "../../result.ts";
import type { RunnerDatabase } from "./database.ts";
import { workerProvenance } from "./handoffs.ts";
import type { DeliveryState } from "./states.ts";

type ArrivalRow = {
  id: string;
  run_id: string;
  arrival_number: number;
  accepted_at: string;
  rule_id: string | null;
  rule_name: string | null;
  source_block_id: string | null;
  origin_activation_id: string | null;
  origin_thread_id: string | null;
  subflow_invocation_id: string | null;
  ending_id: string | null;
  ending_name: string | null;
};

type RecipientRow = {
  condition_arrival_id: string;
  block_id: string;
  target_ending_id: string | null;
  state: DeliveryState;
};

/** The window a cursor continues: its Run and Condition, high-water and last arrival number. */
type Cursor = readonly [runId: string, blockId: string, highWater: number, after: number];

/**
 * Signs cursors so a client cannot move a window it was issued, such as raising its high-water
 * after a later arrival. The key lives only in this process: a cursor issued before a restart is
 * refused, and the reader opens a new window from arrival 1.
 */
const DISPOSITIONS: Readonly<Record<DeliveryState, ConditionRecipientDisposition>> = {
  pending: "pending",
  reserved: "pending",
  uncertain: "pending",
  acknowledged: "acknowledged",
  cancelled: "cancelled",
};

const invalidLimit = failure(
  "validation",
  `Ask for a whole number of 1 to ${CONDITION_ARRIVAL_PAGE_MAX} Condition arrivals per page.`,
  [
    {
      code: "condition_page_limit",
      path: "limit",
      message: `Use a whole number from 1 to ${CONDITION_ARRIVAL_PAGE_MAX}.`,
    },
  ],
);

const invalidCursor = failure(
  "validation",
  "This cursor does not continue this Condition's arrivals in this Run.",
  [
    {
      code: "condition_page_cursor",
      path: "cursor",
      message: "Read the first page again without a cursor.",
    },
  ],
);

/** A page size from a query string: absent when empty, not a number unless all digits. */
export const queryPageLimit = (text: string) =>
  text === "" ? undefined : /^[0-9]+$/.test(text) ? Number(text) : Number.NaN;

/**
 * Condition evidence: bounded pages of one Condition's numbered arrivals in a Run. Each page is one
 * read transaction keyed by arrival number with `LIMIT n+1`, and reads recipient dispositions only
 * for its own arrivals, so neither the arrival history nor its deliveries are loaded whole.
 */
export function openConditionEvidence(database: RunnerDatabase) {
  /**
   * The page of Condition `blockId`'s arrivals in Run `runId` after the cursor's position, or from
   * arrival 1 without one. `limit` defaults to `CONDITION_ARRIVAL_PAGE_DEFAULT`. A first page fixes
   * its window at the highest arrival number committed now; a cursor continues only its own Run,
   * Condition and window, which never exceeds the committed arrivals. Decisions are as recorded;
   * each recipient's disposition is its delivery's state at this read.
   */
  function listConditionArrivals(
    runId: string,
    blockId: string,
    limit: number | undefined,
    cursorText: string | undefined,
  ): Effect.Effect<Result<ConditionArrivalPage>, unknown> {
    const pageSize = limit ?? CONDITION_ARRIVAL_PAGE_DEFAULT;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > CONDITION_ARRIVAL_PAGE_MAX)
      return Effect.succeed(invalidLimit);
    return database.transaction((sql) =>
      Effect.gen(function* () {
        const [scope] = yield* sql<{
          condition: number;
          committed: number | null;
        }>`SELECT EXISTS(SELECT 1 FROM condition_counters c WHERE c.run_id=r.id AND c.block_id=${blockId}) AS condition,
          (SELECT MAX(a.arrival_number) FROM condition_arrivals a WHERE a.run_id=r.id AND a.block_id=${blockId}) AS committed
          FROM runs r WHERE r.id=${runId}`;
        if (!scope) return failure("not_found", "This Run does not exist.");
        if (!scope.condition) return failure("not_found", "This Run has no such Condition.");
        const committed = scope.committed ?? 0;
        let window = { highWater: committed, after: 0 };
        if (cursorText !== undefined) {
          const cursor = decodeCursor<Cursor>(cursorText);
          if (!cursor) return invalidCursor;
          const [cursorRun, cursorBlock, highWater, after] = cursor;
          if (cursorRun !== runId || cursorBlock !== blockId) return invalidCursor;
          if (after < 1 || after >= highWater || highWater > committed) return invalidCursor;
          window = { highWater, after };
        }
        const rows =
          yield* sql<ArrivalRow>`SELECT a.id,a.run_id,a.arrival_number,a.accepted_at,a.rule_id,r.name AS rule_name,i.source_block_id,a.origin_activation_id,t.thread_id AS origin_thread_id,i.subflow_invocation_id,s.ending_id,s.ending_name
          FROM condition_arrivals a
          JOIN operation_intents i ON i.id=a.incoming_intent_id
          LEFT JOIN subflow_results s ON s.invocation_id=i.subflow_invocation_id
          LEFT JOIN flow_revision_condition_rules r ON r.flow_revision_id=a.flow_revision_id AND r.block_id=a.template_block_id AND r.rule_id=a.rule_id
          LEFT JOIN run_thread_bindings t ON t.id=a.binding_id
          WHERE a.run_id=${runId} AND a.block_id=${blockId} AND a.arrival_number>${window.after} AND a.arrival_number<=${window.highWater}
          ORDER BY a.arrival_number LIMIT ${pageSize + 1}`;
        const page = rows.slice(0, pageSize);
        const recipients = page.length
          ? yield* sql<RecipientRow>`SELECT condition_arrival_id,block_id,json_extract(target_json,'$.endingId') AS target_ending_id,state FROM operation_intents WHERE run_id=${runId} AND condition_arrival_id IN ${sql.in(page.map((row) => row.id))} ORDER BY rowid`
          : [];
        const last = page.at(-1);
        return {
          ok: true as const,
          value: {
            arrivals: page.map((row): ConditionArrivalEvidence => ({
              id: row.id,
              arrivalNumber: row.arrival_number,
              outputId: row.rule_id ?? CONDITION_OTHERWISE_ID,
              acceptedAt: row.accepted_at,
              sourceBlockId: row.source_block_id,
              origin: workerProvenance(row),
              ...(row.subflow_invocation_id &&
                row.ending_id !== null &&
                row.ending_name !== null && {
                  subflowReturn: {
                    invocationId: row.subflow_invocation_id,
                    endingId: row.ending_id,
                    endingName: row.ending_name,
                  },
                }),
              // A matched rule references its captured rule row, so its name is always read.
              rule: row.rule_id === null ? null : { id: row.rule_id, name: row.rule_name! },
              recipients: recipients
                .filter((recipient) => recipient.condition_arrival_id === row.id)
                .map((recipient) => ({
                  blockId: recipient.block_id,
                  targetEndingId: recipient.target_ending_id,
                  disposition: DISPOSITIONS[recipient.state],
                })),
            })),
            highWater: window.highWater,
            nextCursor:
              rows.length > pageSize && last
                ? encodeCursor([runId, blockId, window.highWater, last.arrival_number])
                : null,
          },
        };
      }),
    );
  }

  return { listConditionArrivals };
}
