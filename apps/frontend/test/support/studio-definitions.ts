import { vi, type Mock } from "vite-plus/test";
import type {
  FlowDraft,
  StudioDefinitions as SavedDefinitions,
  StudioLiveMessage,
} from "@t3-factory/contracts";
import {
  createStudioDefinitions,
  type StudioDefinitionsOperations,
} from "../../src/studio-definitions.ts";
import { memoryFactory } from "./flow-draft.ts";
import { savedAgent } from "./agent-draft.ts";
import { connectionScope } from "../../src/live/scopes.ts";
import { envelope, liveHarness, snapshot } from "./live.ts";

type Operations = {
  [K in keyof StudioDefinitionsOperations]: Mock<StudioDefinitionsOperations[K]>;
};

/** A saved Flow named for a test, so a list read can be told apart from another one. */
export const savedFlow = (name: string, change: Partial<FlowDraft> = {}): FlowDraft => ({
  ...memoryFactory().latest(),
  name,
  ...change,
});

/** Studio's writes to Factory in memory; the lists themselves arrive through the subscription. */
export function studioFactory(): Operations {
  return {
    createFlow: vi.fn<StudioDefinitionsOperations["createFlow"]>(async ({ name }) =>
      savedFlow(name),
    ),
    updateFlow: vi.fn<StudioDefinitionsOperations["updateFlow"]>(async (_id, { name }) =>
      savedFlow(name),
    ),
    removeFlow: vi.fn<StudioDefinitionsOperations["removeFlow"]>(async () => undefined),
    createAgent: vi.fn<StudioDefinitionsOperations["createAgent"]>(async (content) =>
      savedAgent({ ...content, id: "created" }),
    ),
    updateAgent: vi.fn<StudioDefinitionsOperations["updateAgent"]>(async (_id, content) =>
      savedAgent(content),
    ),
    duplicateAgent: vi.fn<StudioDefinitionsOperations["duplicateAgent"]>(async () =>
      savedAgent({ id: "copy", name: "Reviewer copy" }),
    ),
    removeAgent: vi.fn<StudioDefinitionsOperations["removeAgent"]>(async () => undefined),
    createTrigger: vi.fn<StudioDefinitionsOperations["createTrigger"]>(),
    updateTrigger: vi.fn<StudioDefinitionsOperations["updateTrigger"]>(),
    setTriggerEnabled: vi.fn<StudioDefinitionsOperations["setTriggerEnabled"]>(),
    runTrigger: vi.fn<StudioDefinitionsOperations["runTrigger"]>(),
    previewNewTrigger: vi.fn<StudioDefinitionsOperations["previewNewTrigger"]>(),
    previewTrigger: vi.fn<StudioDefinitionsOperations["previewTrigger"]>(),
    removeTrigger: vi.fn<StudioDefinitionsOperations["removeTrigger"]>(async () => undefined),
  };
}

/**
 * Studio is open over Factory's saved definitions, with the window's live owner over scripted
 * sockets and the window's socket connected; the Studio subscription has delivered nothing yet.
 * `close` is Studio closing.
 */
export function liveStudio(factory = studioFactory()) {
  const live = liveHarness();
  const definitions = createStudioDefinitions(live.owner, factory);
  const close = definitions.open();
  const setup = { factory, live, definitions, close };
  const socket = setup.live.sessions[0]!;
  socket.connected();
  return { ...setup, socket, studio: socket.subscriptions[0]! };
}

/** One joint read of both lists, as the Studio subscription delivers it. */
export const studioSnapshot = (studio: SavedDefinitions, current = true) =>
  envelope<StudioLiveMessage>([{ _tag: "snapshot", studio }], current);

/** One committed change set of both lists. */
export const studioChanged = (
  change: Omit<Extract<StudioLiveMessage, { _tag: "changed" }>, "_tag">,
) => envelope<StudioLiveMessage>([{ _tag: "changed", ...change }]);

/** Studio is open live and its first snapshot of `studio` applied. */
export function deliveredStudio(studio: SavedDefinitions) {
  const setup = liveStudio();
  setup.studio.message(studioSnapshot(studio));
  return setup;
}

/**
 * A window whose only held scope, the T3 connection status, is current, so mutations are
 * allowed, and a Studio session over it that has not opened yet.
 */
export function currentWindow(factory = studioFactory()) {
  const live = liveHarness();
  live.owner.acquire(connectionScope);
  const socket = live.sessions[0]!;
  socket.connected();
  socket.subscriptions[0]!.message(snapshot("ready"));
  return { factory, live, socket, definitions: createStudioDefinitions(live.owner, factory) };
}
