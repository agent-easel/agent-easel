import type { RunDetail, WorkerProvenance } from "@t3-factory/contracts";

export function blockName(run: RunDetail, blockId: string) {
  return run.definitions.flow.graph.blocks.find((block) => block.id === blockId)?.name || blockId;
}

export function capturedEnding(run: RunDetail, endingId: string) {
  return run.definitions.flow.graph.finish.endings.find((ending) => ending.id === endingId);
}

export function deliveryRecipientName(
  run: RunDetail,
  { blockId, targetEndingId }: { blockId: string; targetEndingId: string | null },
) {
  return targetEndingId === null
    ? blockName(run, blockId)
    : `Finish · ${capturedEnding(run, targetEndingId)?.name || targetEndingId}`;
}

export function deliveryWorker(run: RunDetail, origin: WorkerProvenance) {
  return (
    run.threadBindings.find((binding) => binding.threadId === origin.threadId) ??
    run.blocks.find((block) => block.threadId === origin.threadId)
  );
}
