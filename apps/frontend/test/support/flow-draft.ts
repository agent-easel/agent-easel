import { vi, type Mock } from "vite-plus/test";
import type {
  AgentDefinition,
  FlowDraft,
  FlowGraph,
  FlowReadiness,
  FlowValidation,
  OperationError,
  StudioLiveMessage,
} from "@t3-factory/contracts";
import { api, ApiError } from "../../src/api.ts";
import { createFlowDraft } from "../../src/flow-draft.ts";
import { createStudioDefinitions } from "../../src/studio-definitions.ts";
import { savedAgent } from "./agent-draft.ts";
import { envelope, liveHarness } from "./live.ts";

type FlowOperations = Pick<typeof api, "updateFlow" | "removeFlow" | "validateFlow" | "getFlow">;

/** A minute after `time`: an owner change always advances a definition's `updatedAt`. */
export const laterThan = (time: string) => new Date(Date.parse(time) + 60_000).toISOString();
type Operations = { [K in keyof FlowOperations]: Mock<FlowOperations[K]> };

/** The Flow Factory holds, and its Flow operations over it in memory. */
interface MemoryFactory extends Operations {
  latest(): FlowDraft;
  /** Another client saves the Flow, appending the next revision. */
  saveElsewhere(name: string, readiness?: FlowReadiness): FlowDraft;
  /** Another client changes the Flow's owner, which appends no revision. */
  moveElsewhere(projectId: string | null): FlowDraft;
}

const ready: FlowReadiness = { ready: true, issues: [] };

/** Readiness Factory validated against the global saved Agent at revision 3. */
export const validated = (
  readiness: FlowReadiness = ready,
  revision = 3,
  projectId: string | null = null,
): FlowValidation => ({
  ...readiness,
  agentRevisions: { agent: { revision, projectId } },
});

export const notReady: FlowReadiness = {
  ready: false,
  issues: [{ code: "missing_target", path: "flowInput", message: "Connect the Flow input." }],
};

export const rejection = (detail: Partial<OperationError> = {}) =>
  new ApiError({ code: "validation", message: "Flow is invalid.", issues: [], ...detail });

export function memoryFactory(): MemoryFactory {
  let removed = false;
  let latest: FlowDraft = {
    id: "flow",
    projectId: null,
    name: "Review",
    revision: 1,
    graph: {
      blocks: [
        {
          id: "review",
          name: "Review",
          kind: "agent",
          agentId: "agent",
          position: { x: 200, y: 0 },
          hiddenExitIds: [],
          localExits: [],
          revisitInstruction: "",
          revisitContext: "keep",
        },
      ],
      connections: [],
      flowInput: { position: { x: 0, y: 0 }, targetBlockIds: ["review"] },
      finish: { position: { x: 800, y: 0 }, endings: [] },
    },
    workspace: { mode: "checkout" },
    createdAt: "2026-11-10T08:00:00.000Z",
    updatedAt: "2026-11-10T08:00:00.000Z",
    readiness: ready,
  };
  function append(change: Partial<FlowDraft>) {
    latest = { ...latest, readiness: ready, ...change, revision: latest.revision + 1 };
    return latest;
  }
  return {
    latest: () => latest,
    saveElsewhere: (name, readiness = ready) => append({ name, readiness }),
    moveElsewhere(projectId) {
      latest = { ...latest, projectId, updatedAt: laterThan(latest.updatedAt) };
      return latest;
    },
    updateFlow: vi.fn<FlowOperations["updateFlow"]>(
      async (_id, { expectedRevision, expectedProjectId, name, graph, workspace }) => {
        if (removed) throw rejection({ code: "not_found", message: "Flow was removed." });
        if (expectedRevision !== latest.revision)
          throw rejection({ code: "conflict", message: "Flow changed in another window." });
        if (expectedProjectId !== latest.projectId)
          throw rejection({
            code: "conflict",
            message: "This Flow's owning Project changed elsewhere.",
            issues: [{ code: "stale_owner", path: "expectedProjectId", message: "Compare." }],
          });
        // Studio always sends a fully positioned graph, so no server layout is simulated.
        return append({ name, graph: graph as FlowGraph, ...(workspace && { workspace }) });
      },
    ),
    removeFlow: vi.fn<FlowOperations["removeFlow"]>(async () => {
      removed = true;
    }),
    validateFlow: vi.fn<FlowOperations["validateFlow"]>(async () => validated()),
    getFlow: vi.fn<FlowOperations["getFlow"]>(async () => latest),
  };
}

/** The next call of `operation` waits until the test answers it. */
export function held<T>(operation: Mock<(...args: never[]) => Promise<T>>) {
  let answer!: (value: T) => void;
  let fail!: (error: Error) => void;
  operation.mockReturnValueOnce(
    new Promise<T>((resolve, reject) => {
      answer = resolve;
      fail = reject;
    }),
  );
  return { answer: (value: T) => answer(value), fail: (error: Error) => fail(error) };
}

type StudioChange = Omit<Extract<StudioLiveMessage, { _tag: "changed" }>, "_tag">;

/**
 * A live Studio, with the window's live owner over scripted sockets, whose first snapshot holds
 * `flows` and one saved Agent; `changed` delivers more. The Flow editor sends only the Flow writes.
 */
function liveFlowStudio(factory: MemoryFactory, flows: readonly FlowDraft[]) {
  const live = liveHarness();
  const definitions = createStudioDefinitions(live.owner, {
    ...api,
    updateFlow: factory.updateFlow,
    removeFlow: factory.removeFlow,
  });
  definitions.open();
  const socket = live.sessions[0]!;
  socket.connected();
  const subscription = socket.subscriptions[0]!;
  subscription.message(
    envelope<StudioLiveMessage>([
      { _tag: "snapshot", studio: { agents: [savedAgent()], flows, triggers: [] } },
    ]),
  );
  return {
    definitions,
    socket,
    changed: (change: StudioChange) =>
      subscription.message(envelope<StudioLiveMessage>([{ _tag: "changed", ...change }])),
  };
}

/**
 * The Flow editor's draft of the Flow Factory holds, in a Studio that receives that Flow and one
 * saved Agent live. The returned deliveries are Studio's live updates of what Factory now holds.
 */
function flowDraft(factory = memoryFactory(), others: readonly FlowDraft[] = []) {
  const { definitions, socket, changed } = liveFlowStudio(factory, [factory.latest(), ...others]);
  const draft = createFlowDraft("flow", definitions, factory);
  draft.open();
  return {
    factory,
    draft,
    /** Studio receives Factory's latest revision of the Flow. */
    published: (flow = factory.latest()) => changed({ flows: { upserts: [flow], removals: [] } }),
    flowRemoved: (id: string) => changed({ flows: { upserts: [], removals: [id] } }),
    /** Another client removes the Flow and Studio receives the removal. */
    removedElsewhere: async () => {
      await factory.removeFlow("flow");
      changed({ flows: { upserts: [], removals: ["flow"] } });
    },
    /**
     * Studio receives a save of a saved Agent, by default the one the Flow places, with the
     * Flows whose readiness that save changed.
     */
    agentChanged: (
      agent: AgentDefinition = savedAgent({ revision: 4 }),
      flows: readonly FlowDraft[] = [],
    ) =>
      changed({
        agents: { upserts: [agent], removals: [] },
        flows: { upserts: flows, removals: [] },
      }),
    /** The live connection drops, so Studio's saved definitions are no longer current. */
    disconnected: () => socket.disconnected(),
  };
}

/** Studio has delivered an empty Flow list; a Create answer may precede its first delivery. */
export function unlistedFlow() {
  const factory = memoryFactory();
  const { definitions, changed } = liveFlowStudio(factory, []);
  return { definitions, factory, changed };
}

/** The Flow editor shows a loaded, clean Flow. */
export const openedFlow = () => flowDraft();

export const reviewPanel = (revision = 1): FlowDraft => ({
  ...memoryFactory().latest(),
  id: "review-panel",
  name: "Review panel",
  revision,
});

export function editedComposition() {
  const factory = memoryFactory();
  factory.validateFlow.mockResolvedValue({
    ...validated(),
    closure: {
      stamp: "review-panel-1",
      definitions: [{ kind: "flow", id: "review-panel", revision: 1, projectId: null }],
      missing: [],
    },
  });
  const setup = flowDraft(factory, [reviewPanel()]);
  setup.draft.edit({ name: "Edited" });
  return setup;
}

/** The opened Flow has an unsaved rename. */
export function editedFlow(name = "Edited") {
  const setup = openedFlow();
  setup.draft.edit({ name });
  return setup;
}

/** The opened Flow is being dragged, wired, arranged or typed into; `end` finishes it. */
export function interactingFlow() {
  const setup = openedFlow();
  return { ...setup, end: setup.draft.interact() };
}

/** Another client saved the Flow, and Studio received that revision, before this edit's save. */
function conflictedFlow() {
  const setup = editedFlow("Mine");
  setup.factory.saveElsewhere("Theirs");
  setup.published();
  return setup;
}

/** A save of an unsaved rename was refused because another client saved first unseen. */
export async function refusedFlow() {
  const setup = editedFlow("Mine");
  setup.factory.saveElsewhere("Theirs");
  await setup.draft.save();
  return setup;
}

/** The newer revision saved elsewhere is shown beside the local draft. */
export function comparedFlow() {
  const setup = conflictedFlow();
  setup.draft.compareLatest();
  return setup;
}

/** The opened Flow's rename is being saved; `reply` answers the save. */
export function savingFlow() {
  const setup = editedFlow("Mine");
  const reply = held(setup.factory.updateFlow);
  const saving = setup.draft.save();
  return { ...setup, reply, saving };
}
