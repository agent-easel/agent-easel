import { useSyncExternalStore } from "react";
import type { AgentDefinition, FlowDraft, FlowGraph, FlowReadiness } from "@t3-factory/contracts";
import { flowAgentRevisions } from "@t3-factory/domain-validation";
import { api, ApiError } from "./api.ts";
import type { StudioDefinitions } from "./studio-definitions.ts";
import { canonical, createRevisionedDraft, type RevisionedDraftState } from "./revisioned-draft.ts";

/** The part of a Flow its editor changes: what a save writes and a revision conflict compares. */
export type FlowContent = Pick<FlowDraft, "name" | "workspace" | "graph">;

/** Studio's saved definitions, which hold this Flow's saved revisions, and its Flow writes. */
export type FlowDraftSource = Pick<
  StudioDefinitions,
  "getSnapshot" | "hasObserved" | "subscribe" | "updateFlow" | "removeFlow"
>;

/** The Factory operations one Flow draft uses beyond Studio's; the HTTP client in the app. */
export type FlowDraftOperations = Pick<typeof api, "validateFlow">;

export interface FlowDraftSnapshot extends RevisionedDraftState<FlowDraft, FlowContent> {
  readonly status: "loading" | "failed" | "loaded";
  /** A save or readiness check is in flight; edits wait for it. */
  readonly busy: boolean;
  /** Null while readiness is unknown. */
  readonly readiness: FlowReadiness | null;
  /** An Agent this unsaved draft places changed since readiness was last known; check again. */
  readonly agentsChanged: boolean;
  readonly canStartRun: boolean;
}

/** Shown until the Flow loads. */
const unloaded: FlowContent = {
  name: "",
  workspace: { mode: "checkout" },
  graph: {
    blocks: [],
    connections: [],
    flowInput: { position: { x: 40, y: 50 }, targetBlockIds: [] },
  },
};

const contentOf = (flow: FlowDraft): FlowContent => ({
  name: flow.name,
  workspace: flow.workspace,
  graph: flow.graph,
});

/**
 * The saved revisions and owning Projects of the Agents `graph` places, comparable with a
 * validation answer's; null while Studio holds no Agents.
 */
const agentStamp = (graph: FlowGraph, agents: readonly AgentDefinition[] | null) =>
  agents ? canonical(flowAgentRevisions(graph, agents)) : null;

const unknownOutcome =
  "Save outcome unknown. The connection was lost before Factory answered; your draft is kept and nothing is sent again.";

/**
 * One opened Flow on the shared revision protocol: loading it from Studio's saved Flows or this
 * editor's create answer, readiness, and adoption of a newer revision waiting for an interaction.
 * It follows the Flow through Studio's saved definitions while open.
 */
export function createFlowDraft(
  id: string,
  source: FlowDraftSource,
  operations: FlowDraftOperations = api,
  /** This editor's own create answer, which can arrive before Studio receives the Flow. */
  created?: FlowDraft,
) {
  const opened = created && !source.hasObserved("flows", created.id) ? created : null;
  let status: FlowDraftSnapshot["status"] = opened ? "loaded" : "loading";
  let checking = false;
  let checked: FlowReadiness | null = null;
  let agentsChanged = false;
  /** Advances whenever a pending readiness answer must no longer apply. */
  let readinessRequest = 0;
  /** Drags, wire gestures, Auto-arrange runs and text entry in progress; adoption waits for them. */
  let interactions = 0;
  /** This editor's removal was accepted; readiness is unknown even before Studio delivers it. */
  let removedHere = false;

  /** The Flow as Studio's saved definitions hold it now; undefined while unknown or absent. */
  function latest() {
    return source.getSnapshot().flows.value?.find((flow) => flow.id === id);
  }
  /** A shown readiness check no longer applies, and an answer still pending is dropped. */
  function forgetCheck() {
    checked = null;
    ++readinessRequest;
  }
  const draft = createRevisionedDraft({
    saved: opened,
    content: opened ? contentOf(opened) : unloaded,
    contentOf,
    list: () => source.getSnapshot().flows,
    // Only adoption into a clean draft waits for an interaction; it would replace the graph.
    hold: () => interactions > 0,
    onAdopt() {
      agentsChanged = false;
      forgetCheck();
    },
    view(state): FlowDraftSnapshot {
      const loaded = status === "loaded";
      const busy = state.saving || checking;
      const flow = latest();
      // A clean draft shows the saved readiness of its revision while Studio currently holds it.
      const savedReadiness =
        flow &&
        flow.revision === state.saved?.revision &&
        source.getSnapshot().flows.synchronized &&
        !state.dirty &&
        !busy &&
        !state.removed
          ? flow.readiness
          : null;
      const readiness = removedHere ? null : (checked ?? savedReadiness);
      return {
        ...state,
        status,
        busy: busy && !state.removed,
        readiness,
        agentsChanged,
        canSave: loaded && state.canSave && !checking,
        canStartRun: loaded && !state.removed && !busy && !state.dirty && !!readiness?.ready,
      };
    },
  });
  function observed() {
    const { flows, agents } = source.getSnapshot();
    return { flow: latest()?.revision, synchronized: flows.synchronized, agents: agents.value };
  }
  let seen = observed();
  /**
   * A shown readiness result stops applying as soon as the Flow's saved revision changes, the
   * Flow is removed, Studio loses synchronization or an Agent the draft places changes, also
   * while adoption waits for an interaction. A clean draft then shows the saved Flow's
   * readiness, delivered with those Agents; an unsaved draft waits for another check.
   */
  function observe() {
    const next = observed();
    const { content, dirty } = draft.getSnapshot();
    const placed =
      seen.agents !== null &&
      next.agents !== null &&
      agentStamp(content.graph, seen.agents) !== agentStamp(content.graph, next.agents);
    if (placed && dirty) agentsChanged = true;
    if (next.flow !== seen.flow || (seen.synchronized && !next.synchronized) || placed)
      forgetCheck();
    seen = next;
  }
  /** Opens the Flow from Studio's saved Flows, or reports why it cannot be opened. */
  function load() {
    const { flows } = source.getSnapshot();
    const flow = latest();
    if (flow) {
      status = "loaded";
      draft.load(flow);
    } else if (flows.synchronized || flows.error) {
      status = "failed";
      draft.report(flows.error?.message ?? "Flow not found.");
    }
  }
  /** Brings the draft up to what Studio's saved definitions hold now. */
  function reconcile() {
    if (status !== "loaded") load();
    if (status === "loaded") draft.reconcile();
  }
  reconcile();

  return {
    getSnapshot: draft.getSnapshot,
    subscribe: draft.subscribe,
    /** Follows the Flow through Studio's saved definitions until the returned function runs. */
    open() {
      const follow = () => {
        observe();
        reconcile();
        // Readiness also comes from Studio's saved definitions, so every delivery is shown.
        draft.publish();
      };
      follow();
      return source.subscribe(follow);
    },
    /**
     * A drag, wire gesture, Auto-arrange run or text entry begins. A newer revision for a clean
     * draft waits until every one has ended, then is adopted only if the draft is still clean;
     * the returned function ends this one and does nothing when called again.
     */
    interact() {
      ++interactions;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        --interactions;
        reconcile();
      };
    },
    /** Any edit makes readiness unknown; errors stay shown. */
    edit(change: Partial<FlowContent>) {
      if (status !== "loaded" || draft.getSnapshot().busy) return;
      forgetCheck();
      draft.edit(change);
    },
    /** Saves the content against the saved revision; a stale revision enters the conflict. */
    async save() {
      const { saved, content, canSave } = draft.getSnapshot();
      if (!saved || !canSave) return;
      await draft.save({
        submitted: content,
        send: () => source.updateFlow(id, { ...content, expectedRevision: saved.revision }),
        unknownMessage: unknownOutcome,
        fallback: "Could not save Flow.",
      });
    },
    /**
     * Accepted removal clears the guard and readiness before the caller navigates away, before
     * Studio delivers the absence.
     */
    async remove() {
      if (checking) return false;
      return draft.remove(async (flowId) => {
        await source.removeFlow(flowId);
        removedHere = true;
      }, "Could not remove Flow.");
    },
    clearRemovalError: draft.clearRemovalError,
    /** Validates the content without saving it. */
    async check() {
      const { saved, content, removed, busy } = draft.getSnapshot();
      if (!saved || removed || busy) return;
      checking = true;
      const asked = ++readinessRequest;
      draft.report("");
      try {
        const { agentRevisions, ...answer } = await operations.validateFlow(id, {
          ...content,
          expectedRevision: saved.revision,
        });
        // An Agent change Studio has not delivered yet also makes the answer stale.
        const shown = agentStamp(content.graph, source.getSnapshot().agents.value);
        if (asked !== readinessRequest || canonical(agentRevisions) !== shown) return;
        checked = answer;
        agentsChanged = false;
      } catch (cause) {
        if (asked === readinessRequest)
          draft.report(
            cause instanceof Error ? cause.message : "Could not check Flow.",
            cause instanceof ApiError ? cause.detail.issues : [],
          );
      } finally {
        checking = false;
        draft.publish();
      }
    },
    /** The editor was hidden: a readiness check shown or still in flight no longer applies. */
    hide() {
      forgetCheck();
      draft.publish();
    },
    /** Shows the latest saved Flow beside the local draft, which stays as it is. */
    compareLatest() {
      if (!checking) draft.compare();
    },
    /** Replaces the local draft with compared `revision` while it is still the one compared. */
    takeLatest: draft.takeLatest,
    /**
     * Keeps the local content, unsaved, against compared `revision` for another explicit save,
     * only while that revision is still the one compared; its readiness check no longer applies.
     */
    keepLocal(revision: number) {
      const { conflict } = draft.getSnapshot();
      if (conflict.status !== "compared" || conflict.latest.revision !== revision) return;
      forgetCheck();
      draft.keep(revision);
    },
  };
}

export type FlowDraftModel = ReturnType<typeof createFlowDraft>;

export function useFlowDraftSnapshot(draft: FlowDraftModel) {
  return useSyncExternalStore(draft.subscribe, draft.getSnapshot);
}
