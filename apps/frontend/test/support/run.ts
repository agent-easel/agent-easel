import type {
  RunAttention,
  RunBlock,
  RunDetail,
  RunNavigationEntry,
  RunSettlementWorker,
} from "@t3-factory/contracts";

/** A pending attention matter of `kind` on `blockId`. */
export const attention = (blockId: string, kind: RunAttention["kind"]): RunAttention => ({
  id: `${blockId}-${kind}`,
  runId: "run",
  taskTitle: "Task",
  blockId,
  blockName: blockId,
  executionId: "execution",
  kind,
  nativeRequestId: null,
  occurrenceId: null,
  link: null,
  freshness: "fresh",
  appearedAt: "2026-11-08T00:00:00Z",
  settledAt: null,
  settlementReason: null,
  message: null,
});

export const block = (blockId: string): RunBlock => ({
  blockId,
  name: blockId,
  state: "working",
  threadId: null,
  executionId: null,
  link: null,
  engineStatus: null,
  reportStatus: null,
  workingMessage: null,
  problem: null,
  pendingRequestCount: null,
  observedAt: null,
  freshness: "fresh",
  recovery: null,
});

export const event = (sequence: number): RunDetail["events"][number] => ({
  sequence,
  kind: "block-working",
  observedAt: "2026-11-08T00:00:00Z",
  sourceAt: null,
  engineStatus: null,
  executionId: null,
  causeId: null,
  blockId: "worker",
});

const execution = (bindingId: string): RunDetail["executions"][number] => ({
  bindingId,
  activationId: null,
  blockId: "worker",
  executionId: "execution",
  engineStatus: null,
  reportStatus: null,
  problem: null,
  observedAt: null,
  observedStartedAt: null,
  observedEndedAt: null,
});

export function runDetail(): RunDetail {
  return {
    id: "run",
    origin: null,
    number: 1,
    title: "Run",
    titleProvenance: "automatic",
    titleGeneration: null,
    lifecycle: "active",
    task: { id: "task", title: "Task", projectId: "project" },
    flowId: "flow",
    flowName: "Flow",
    repositories: [],
    startedAt: "2026-11-08T00:00:00Z",
    input: "Task",
    segments: [{ type: "text", text: "Task" }],
    images: [],
    gateOpen: true,
    settlement: null,
    generation: 1,
    definitions: {
      flow: {
        id: "flow",
        name: "Flow",
        revision: 1,
        createdAt: "2026-11-08T00:00:00Z",
        updatedAt: "2026-11-08T00:00:00Z",
        graph: {
          blocks: [],
          connections: [],
          flowInput: { position: { x: 0, y: 0 }, targetBlockIds: [] },
        },
        workspace: { mode: "checkout" },
      },
      agents: [],
    },
    currentFlowRevision: 1,
    workspace: { mode: "checkout" },
    coordinationActions: { questionReplies: [] },
    runCoordinator: null,
    blocks: [block("worker"), block("untouched"), block("removed")],
    executions: [execution("binding"), execution("other")],
    activations: [],
    threadBindings: [],
    reports: [],
    recoveries: [],
    humanOccurrences: [],
    waitArrivals: [],
    continuationVisits: [],
    conditions: [],
    attention: [],
    intents: [],
    rootWork: [],
    events: [event(1), event(2)],
  };
}

/** The navigation entry of an Active Run that is neither Snoozed nor settling. */
export function runEntry(): RunNavigationEntry {
  return {
    id: "run",
    number: 1,
    title: "Run",
    titleProvenance: "automatic",
    titleGeneration: null,
    createdAt: "2026-11-08T00:00:00Z",
    creationKey: "run",
    lastActivityAt: "2026-11-08T00:00:00Z",
    flowName: "Flow",
    origin: null,
    repositories: [],
    project: {
      id: "project",
      title: "Project",
      workspaceRoot: "/project",
      availability: "available",
    },
    lifecycle: "active",
    settlement: null,
    blocks: [],
    presentation: { snoozed: false, woke: false },
    attention: { needsInput: false, problem: false, matters: [] },
  };
}

/** A worker an unresolved settlement could not stop, with how T3 answered its Stop. */
export const blockedWorker = (
  blockId: string,
  stopOutcome: RunSettlementWorker["stopOutcome"],
): RunSettlementWorker => ({
  blockId,
  blockName: blockId,
  threadId: `thread-${blockId}`,
  link: `t3://threads/thread-${blockId}`,
  state: "unresolved",
  stopRequestedAt: null,
  stopOutcome,
  problem: "Not stopped.",
});

/** A confirmed Settle whose current attempt could not resolve `workers`. */
export const unresolvedSettlement = (
  workers: readonly RunSettlementWorker[],
): NonNullable<RunDetail["settlement"]> => ({
  state: "unresolved",
  requestedAt: "2026-11-08T22:20:00Z",
  attempt: 1,
  attemptedAt: "2026-11-08T22:20:00Z",
  workers,
});
