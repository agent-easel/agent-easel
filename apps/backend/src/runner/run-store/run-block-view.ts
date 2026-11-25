import { threadHref } from "../../thread-link.ts";
import type { RunDetail } from "@agent-easel/contracts";
import type { BlockRow } from "../runner-types.ts";
import type { DeliveryRecord } from "./records.ts";

export function runBlock(
  block: BlockRow,
  intents: readonly DeliveryRecord[],
  progress: { message: string | null; overdue: boolean } | undefined,
  active: boolean,
): RunDetail["blocks"][number] {
  const recovering = intents.some(
    (intent) =>
      intent.block_id === block.block_id &&
      intent.kind === "launch" &&
      ["pending", "reserved", "uncertain"].includes(intent.state),
  );
  return {
    blockId: block.block_id,
    ...(block.invocation_id
      ? { invocationId: block.invocation_id, templateBlockId: block.template_block_id! }
      : {}),
    name: block.name,
    state: block.state,
    threadId: block.thread_id,
    executionId: block.execution_id,
    link: threadHref(block.link),
    engineStatus: block.engine_status,
    workerFinished: block.worker_finished === 1,
    reportStatus: block.report_status,
    workingMessage: progress?.message ?? null,
    progressOverdue:
      active &&
      (block.state === "working" || block.state === "sent") &&
      (progress?.overdue ?? false),
    problem: block.problem,
    pendingRequestCount: block.pending_request_count,
    observedAt: block.observed_at,
    freshness: block.freshness,
    recovery: recovering ? "pending" : null,
  };
}
