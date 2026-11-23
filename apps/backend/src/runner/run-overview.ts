import { attentionPresentation, type FlowGraph, type RunDetail } from "@t3-factory/contracts";
import { effectiveExits } from "@t3-factory/domain-validation";

export function referenceOf(value: string): { id: string } | { number: number } {
  const number = /^#?(\d{1,15})$/.exec(value.trim())?.[1];
  return number === undefined ? { id: value.trim() } : { number: Number(number) };
}

const HANDOFF_STATES = { acknowledged: "delivered", cancelled: "cancelled" } as const;

type RunOverviewIdentity = {
  readonly id: string;
  readonly number: number | null;
  readonly title: string;
  readonly project: { readonly id: string; readonly name: string; readonly repositoryPath: string };
  readonly state: RunDetail["lifecycle"] | "snoozed";
};

export function runOverview(
  identity: RunOverviewIdentity,
  detail: RunDetail,
  definition: (blockId: string) => FlowGraph["blocks"][number] | undefined = (blockId) =>
    detail.definitions.flow.graph.blocks.find((block) => block.id === blockId),
) {
  const blockName = (blockId: string) =>
    definition(blockId)?.name ?? detail.blocks.find((block) => block.blockId === blockId)?.name;
  const exitName = (blockId: string, exitId: string | null) => {
    const block = definition(blockId);
    if (!block || exitId === null) return null;
    return (
      effectiveExits(block, detail.definitions.agents).find((exit) => exit.id === exitId)?.name ||
      null
    );
  };
  const latest = new Map<string, RunDetail["reports"][number]>();
  for (const report of detail.reports) latest.set(report.blockId, report);
  const released = (intentId: string) =>
    detail.events.some((event) => event.kind === "handoff-released" && event.causeId === intentId);
  const pending = detail.attention.filter((matter) => matter.settledAt === null);
  const blockProblem = (blockId: string) =>
    detail.blocks.find((block) => block.blockId === blockId)?.problem ?? null;
  const settlementProblem = () => {
    const blocked = (detail.settlement?.workers ?? [])
      .filter((worker) => worker.state === "unresolved")
      .map((worker) => `${worker.blockName}: ${worker.problem ?? "not resolved"}`);
    return `Not resolved: ${blocked.join("; ")}. Settle again, remove queued work in T3, or Archive the Run.`;
  };

  const run = {
    id: identity.id,
    number: identity.number,
    title: identity.title,
    project: identity.project,
    flow: {
      name: detail.definitions.flow.name,
      capturedRevision: detail.definitions.flow.revision,
      latestSavedRevision: detail.currentFlowRevision,
    },
    state: identity.state,
    settlement: detail.settlement?.state ?? null,
    acceptsHandoffs: detail.gateOpen,
    startedAt: detail.startedAt,
    workspace:
      detail.workspace.mode === "checkout"
        ? { mode: "checkout" }
        : {
            mode: "worktree",
            state: detail.workspace.state,
            branch: detail.workspace.branch,
            problem: detail.workspace.problem,
          },
    prompt: detail.input,
  };
  const lists = {
    blocks: detail.blocks.map((block) => ({
      blockId: block.blockId,
      name: blockName(block.blockId) ?? block.name,
      kind: definition(block.blockId)?.kind ?? null,
      state: block.state,
      observation: block.freshness,
      observedAt: block.observedAt,
      problem: block.problem,
      pendingT3Requests: block.pendingRequestCount,
      workingMessage: block.workingMessage,
    })),
    latestResults: [...latest.values()].map((report) => ({
      reportId: report.id,
      block: blockName(report.blockId),
      blockId: report.blockId,
      status: report.status,
      exit: exitName(report.blockId, report.exitId),
      acceptedAt: report.acceptedAt,
      workerCompletion:
        report.status !== "finished" ? null : report.completionEligibleAt ? "confirmed" : "held",
      handoffs: detail.intents
        .filter((intent) => intent.reportId === report.id)
        .map((intent) => ({
          to: blockName(intent.blockId),
          state:
            intent.state === "acknowledged" || intent.state === "cancelled"
              ? HANDOFF_STATES[intent.state]
              : released(intent.id)
                ? "released-unconfirmed"
                : "held",
          problem: intent.problem,
        })),
      result: report.resultMessage ?? null,
    })),
    needsInput: pending
      .filter((matter) => attentionPresentation(matter.kind) === "needs-input")
      .map((matter) => ({
        id: matter.id,
        kind: matter.kind,
        block: matter.blockName,
        appearedAt: matter.appearedAt,
        observation: matter.freshness,
        occurrenceId: matter.occurrenceId,
        ...(matter.kind === "native-request" ? { answeredIn: "T3" } : {}),
      })),
    problems: pending
      .filter((matter) => attentionPresentation(matter.kind) === "problem")
      .map((matter) => ({
        id: matter.id,
        kind: matter.kind,
        block: matter.blockName,
        appearedAt: matter.appearedAt,
        observation: matter.freshness,
        detail: matter.blockId === null ? settlementProblem() : blockProblem(matter.blockId),
      })),
    humanOccurrences: detail.humanOccurrences
      .filter((occurrence) => occurrence.state === "pending")
      .map((occurrence) => {
        const arrival = detail.intents.find((intent) => intent.id === occurrence.incomingIntentId);
        const source = arrival?.sourceBlockId ?? null;
        return {
          occurrenceId: occurrence.id,
          block: blockName(occurrence.blockId),
          blockId: occurrence.blockId,
          appearedAt: occurrence.appearedAt,
          arrival: {
            id: occurrence.incomingIntentId,
            from: source === null ? null : blockName(source),
            exit: source === null ? null : exitName(source, arrival?.exitId ?? null),
            reportId: arrival?.reportId ?? null,
          },
          context: occurrence.context,
        };
      }),
    pendingWaits: detail.waitArrivals
      .filter((arrival) => arrival.state === "pending")
      .map((arrival) => ({
        arrivalId: arrival.id,
        block: blockName(arrival.blockId),
        startedAt: arrival.startedAt,
        deadlineAt: arrival.deadlineAt,
        message: arrival.message,
      })),
  };
  return { run, lists };
}
