import type { RunDetail, RunResult, WorkerProvenance } from "@t3-factory/contracts";

export function targetsBlock(intent: RunDetail["intents"][number], blockId: string | null) {
  return intent.targetEndingId === null && intent.blockId === blockId;
}

export function blockName(run: RunDetail, blockId: string) {
  return (
    run.definitions.flow.graph.blocks.find((block) => block.id === blockId)?.name ||
    run.blocks.find((block) => block.blockId === blockId)?.name ||
    run.threadBindings.find((binding) => binding.blockId === blockId)?.blockName ||
    blockId
  );
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

export function resultVisit(run: RunDetail, result: RunResult) {
  const activation = run.activations.find((item) => item.id === result.origin?.activationId);
  if (!activation) return undefined;
  const visits = run.activations.filter((item) => item.blockId === activation.blockId);
  return { blockId: activation.blockId, number: visits.indexOf(activation) + 1 };
}
