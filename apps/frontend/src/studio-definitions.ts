import { useSyncExternalStore } from "react";
import type {
  AgentDefinition,
  FlowDraft,
  OperationError,
  StudioDefinitions as SavedDefinitions,
} from "@t3-factory/contracts";
import { api } from "./api.ts";
import type { LiveOwner, LiveScopeView } from "./live/owner.ts";
import { studioScope } from "./live/studio.ts";

/** The Factory operations one Studio session uses; the HTTP client in the app, fakes in tests. */
export type StudioDefinitionsOperations = Pick<
  typeof api,
  | "createFlow"
  | "updateFlow"
  | "removeFlow"
  | "createAgent"
  | "updateAgent"
  | "duplicateAgent"
  | "removeAgent"
>;

/** One saved list, with the live scope's three facts and their meaning. */
export interface StudioRead<V> {
  /** The last delivered list; null until one arrives. */
  readonly value: V | null;
  readonly synchronized: boolean;
  readonly error: Error | null;
}

export interface StudioDefinitionsSnapshot {
  readonly flows: StudioRead<readonly FlowDraft[]>;
  readonly agents: StudioRead<readonly AgentDefinition[]>;
}

type StudioList = "flows" | "agents";

/** The window's live owner, as Studio holds its scope. */
type StudioLive = Pick<LiveOwner, "acquire" | "view" | "subscribe">;

const unread: StudioRead<never> = { value: null, synchronized: false, error: null };

const sameRead = <V>(a: StudioRead<V>, b: StudioRead<V>) =>
  a.value === b.value && a.synchronized === b.synchronized && a.error === b.error;

/**
 * The saved Flows and saved Agents of one Studio session. The server delivers both lists through
 * the window's Studio scope; while Studio is open its hold gates mutations like every other
 * gating scope. HTTP answers never mark the live scope synchronized.
 */
export function createStudioDefinitions(
  live: StudioLive,
  operations: StudioDefinitionsOperations = api,
) {
  let snapshot: StudioDefinitionsSnapshot = { flows: unread, agents: unread };
  // A Create reply may bridge only its first delivery, never a later removal or navigation.
  const observed = { flows: new Set<string>(), agents: new Set<string>() };
  const listeners = new Set<() => void>();

  /** Publishes changed facts; an unchanged list keeps its identity. */
  function update(change: Partial<StudioDefinitionsSnapshot>) {
    const flows =
      change.flows && !sameRead(change.flows, snapshot.flows) ? change.flows : snapshot.flows;
    const agents =
      change.agents && !sameRead(change.agents, snapshot.agents) ? change.agents : snapshot.agents;
    if (flows.synchronized && agents.synchronized) {
      flows.value?.forEach((flow) => observed.flows.add(flow.id));
      agents.value?.forEach((agent) => observed.agents.add(agent.id));
    }
    if (flows === snapshot.flows && agents === snapshot.agents) return;
    snapshot = { flows, agents };
    listeners.forEach((notify) => notify());
  }

  /** Follows the Studio scope until the returned function releases it. */
  function follow() {
    const release = live.acquire(studioScope);
    let seen: LiveScopeView<SavedDefinitions> | undefined;
    let refusal: { readonly cause: OperationError; readonly error: Error } | undefined;
    function apply() {
      const view = live.view<SavedDefinitions>(studioScope.key);
      if (view === seen) return;
      seen = view;
      if (view.error && refusal?.cause !== view.error)
        refusal = { cause: view.error, error: new Error(view.error.message) };
      const error = view.error ? refusal!.error : null;
      update({
        flows: {
          value: view.value?.flows ?? snapshot.flows.value,
          synchronized: view.synchronized,
          error,
        },
        agents: {
          value: view.value?.agents ?? snapshot.agents.value,
          synchronized: view.synchronized,
          error,
        },
      });
    }
    const unsubscribe = live.subscribe(apply);
    apply();
    return () => {
      unsubscribe();
      release();
    };
  }

  function subscribe(notify: () => void) {
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }

  return {
    getSnapshot: () => snapshot,
    /** Whether Studio has already shown the definition in its joint current lists. */
    hasObserved: (list: StudioList, id: string) => observed[list].has(id),
    /** Settles once Studio's joint current lists have shown the definition. */
    listed(list: StudioList, id: string) {
      return new Promise<void>((resolve) => {
        if (observed[list].has(id)) return resolve();
        const stop = subscribe(() => {
          if (!observed[list].has(id)) return;
          stop();
          resolve();
        });
      });
    },
    subscribe,
    /** Keeps the lists current while Studio is open; the returned function stops when it closes. */
    open: follow,
    createFlow: operations.createFlow,
    updateFlow: operations.updateFlow,
    removeFlow: operations.removeFlow,
    createAgent: operations.createAgent,
    updateAgent: operations.updateAgent,
    duplicateAgent: operations.duplicateAgent,
    removeAgent: operations.removeAgent,
  };
}

export type StudioDefinitions = ReturnType<typeof createStudioDefinitions>;

export function useStudioRead<K extends StudioList>(
  definitions: StudioDefinitions,
  list: K,
): StudioDefinitionsSnapshot[K] {
  return useSyncExternalStore(definitions.subscribe, () => definitions.getSnapshot()[list]);
}
