import { useSyncExternalStore } from "react";
import { mayPlaceAgent } from "@t3-factory/domain-validation";
import type {
  AgentDefinition,
  FactoryProject,
  FlowDraft,
  FlowDuplicate,
  FlowDuplicateChoice,
  FlowDuplicatePlan,
  LaunchChoices,
  OperationError,
  StudioDefinitions as SavedDefinitions,
} from "@t3-factory/contracts";
import { api, ApiError } from "./api.ts";
import type { LiveOwner, LiveScopeView } from "./live/owner.ts";
import { launchChoicesScope } from "./live/launch-choices.ts";
import { studioScope } from "./live/studio.ts";
import { projectAvailabilityLabels } from "./use-projects.ts";

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
  | "changeFlowOwner"
  | "changeAgentOwner"
  | "previewFlowDuplicate"
  | "duplicateFlow"
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
  /** The Project catalog that labels owners and offers owner targets. */
  readonly projects: StudioRead<readonly FactoryProject[]>;
  /** The owner filter both lists share; it starts at All and never follows the Run composer. */
  readonly filter: StudioOwnerFilter;
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
  let snapshot: StudioDefinitionsSnapshot = {
    flows: unread,
    agents: unread,
    projects: unread,
    filter: { kind: "all" },
  };
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
    const projects =
      change.projects && !sameRead(change.projects, snapshot.projects)
        ? change.projects
        : snapshot.projects;
    const filter = change.filter ?? snapshot.filter;
    if (
      flows === snapshot.flows &&
      agents === snapshot.agents &&
      projects === snapshot.projects &&
      filter === snapshot.filter
    )
      return;
    snapshot = { flows, agents, projects, filter };
    listeners.forEach((notify) => notify());
  }

  /**
   * Reads the Project catalog from the composer's launch choices without gating mutations. Its
   * selected Project is the composer's and never changes the owner filter.
   */
  function followProjects() {
    const release = live.acquire(launchChoicesScope, { gates: false });
    function apply() {
      const view = live.view<LaunchChoices>(launchChoicesScope.key);
      const projects = view.value?.catalog.projects ?? snapshot.projects.value;
      update({
        projects: {
          value: projects === snapshot.projects.value ? snapshot.projects.value : projects,
          synchronized: view.synchronized,
          error: view.error ? (snapshot.projects.error ?? new Error(view.error.message)) : null,
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

  /** Follows the Studio scope until the returned function releases it. */
  function follow() {
    const release = live.acquire(studioScope);
    const releaseProjects = followProjects();
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
      releaseProjects();
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
    /** Shows every definition, only global ones, or one Project's with the global ones. */
    setFilter: (filter: StudioOwnerFilter) => update({ filter }),
    createFlow: operations.createFlow,
    updateFlow: operations.updateFlow,
    removeFlow: operations.removeFlow,
    createAgent: operations.createAgent,
    updateAgent: operations.updateAgent,
    duplicateAgent: operations.duplicateAgent,
    removeAgent: operations.removeAgent,
    changeFlowOwner: operations.changeFlowOwner,
    changeAgentOwner: operations.changeAgentOwner,
    previewFlowDuplicate: operations.previewFlowDuplicate,
    duplicateFlow: operations.duplicateFlow,
  };
}

export type StudioDefinitions = ReturnType<typeof createStudioDefinitions>;

/** Studio's Project catalog (empty until read) and the owner filter both lists share. */
export function useStudioOwners(definitions: StudioDefinitions) {
  const projects = useSyncExternalStore(
    definitions.subscribe,
    () => definitions.getSnapshot().projects.value,
  );
  const filter = useSyncExternalStore(
    definitions.subscribe,
    () => definitions.getSnapshot().filter,
  );
  return { projects: projects ?? noProjects, filter, setFilter: definitions.setFilter };
}

const noProjects: readonly FactoryProject[] = [];

export function useStudioRead<K extends StudioList>(
  definitions: StudioDefinitions,
  list: K,
): StudioDefinitionsSnapshot[K] {
  return useSyncExternalStore(definitions.subscribe, () => definitions.getSnapshot()[list]);
}

/** Studio's owner filter: every definition, only global ones, or one Project's with the global ones. */
export type StudioOwnerFilter =
  | { readonly kind: "all" }
  | { readonly kind: "global" }
  | { readonly kind: "project"; readonly projectId: string };

/** A definition's owner as Studio labels it. */
export interface StudioOwner {
  /** The owning Project's Factory id, or null for a global definition. */
  readonly projectId: string | null;
  /** "Global" or the Project's last-known title. */
  readonly title: string;
  /**
   * The Project's repository path, with its environment and endpoint and then an id suffix only
   * while those still leave two Projects alike; null for Global.
   */
  readonly detail: string | null;
  /** The owning Project's availability reason while it is unavailable; otherwise null. */
  readonly unavailable: string | null;
}

/** One owner's definitions in a Studio list. */
export interface OwnerGroup<D> {
  readonly owner: StudioOwner;
  readonly items: readonly D[];
}

/** Whether a definition owned by `projectId` passes the owner filter. */
function shownByFilter(projectId: string | null, filter: StudioOwnerFilter) {
  if (filter.kind === "all") return true;
  if (filter.kind === "global") return projectId === null;
  return projectId === null || projectId === filter.projectId;
}

const globalOwner: StudioOwner = {
  projectId: null,
  title: "Global",
  detail: null,
  unavailable: null,
};

/** The repository path, extended only while another Project still reads the same. */
function projectDetail(project: FactoryProject, projects: readonly FactoryProject[]) {
  const alike = (other: FactoryProject) =>
    other.id !== project.id &&
    other.title === project.title &&
    other.workspaceRoot === project.workspaceRoot;
  if (!projects.some(alike)) return project.workspaceRoot;
  const located = `${project.workspaceRoot} · ${project.environmentId} on ${project.endpoint}`;
  const stillAlike = projects.some(
    (other) =>
      alike(other) &&
      other.environmentId === project.environmentId &&
      other.endpoint === project.endpoint,
  );
  return stillAlike ? `${located} · …${project.id.slice(-6)}` : located;
}

/** Project owners in label order: title, then the detail that tells alike titles apart. */
const byLabel = (a: StudioOwner, b: StudioOwner) =>
  a.title.localeCompare(b.title) || (a.detail ?? "").localeCompare(b.detail ?? "");

/** How Studio labels a definition owned by `projectId`, from the Project catalog. */
export function studioOwner(
  projectId: string | null,
  projects: readonly FactoryProject[],
): StudioOwner {
  if (projectId === null) return globalOwner;
  const project = projects.find((entry) => entry.id === projectId);
  if (!project)
    return { projectId, title: "Unknown Project", detail: projectId, unavailable: null };
  return {
    projectId,
    title: project.title,
    detail: projectDetail(project, projects),
    unavailable:
      project.availability === "available" ? null : projectAvailabilityLabels[project.availability],
  };
}

/**
 * A Studio list grouped by owner: Global first, then one group per owning Project ordered by
 * label. Each group keeps the list's own order.
 */
export function ownerGroups<D extends { readonly projectId: string | null }>(
  items: readonly D[],
  projects: readonly FactoryProject[],
  filter: StudioOwnerFilter,
): OwnerGroup<D>[] {
  const byOwner = new Map<string | null, D[]>();
  for (const item of items) {
    if (!shownByFilter(item.projectId, filter)) continue;
    const group = byOwner.get(item.projectId);
    if (group) group.push(item);
    else byOwner.set(item.projectId, [item]);
  }
  const global = byOwner.get(null);
  const owned = [...byOwner]
    .flatMap(([projectId, group]) =>
      projectId === null ? [] : [{ owner: studioOwner(projectId, projects), items: group }],
    )
    .sort((a, b) => byLabel(a.owner, b.owner));
  return global ? [{ owner: globalOwner, items: global }, ...owned] : owned;
}

/**
 * The owner New Flow and Add agent preselect: the Flow's own owner when an Agent is added from
 * that Flow's editor, otherwise the filtered Project, and Global while the filter shows All or
 * Global. An unavailable default is kept for the user to change, never replaced.
 */
export function defaultOwner(
  filter: StudioOwnerFilter,
  fromFlow?: Pick<FlowDraft, "projectId">,
): string | null {
  if (fromFlow) return fromFlow.projectId;
  return filter.kind === "project" ? filter.projectId : null;
}

/** One owner a new definition may be given; an unavailable Project is offered disabled. */
interface OwnerTarget {
  readonly owner: StudioOwner;
  /** Why the target cannot own a new definition, or null when it can. */
  readonly disabled: string | null;
}

/**
 * The owner choice of New Flow and Add agent: Global and every Project as targets, and the chosen
 * owner. An unavailable chosen owner stays chosen and blocks creating until the user changes it.
 */
export function ownerPicker(chosen: string | null, projects: readonly FactoryProject[]) {
  const owned = projects
    .map((project) => studioOwner(project.id, projects))
    .sort(byLabel)
    .map((owner) => ({ owner, disabled: owner.unavailable }));
  const targets: readonly OwnerTarget[] = [{ owner: globalOwner, disabled: null }, ...owned];
  const owner = studioOwner(chosen, projects);
  return { targets, chosen: owner, blocked: owner.unavailable };
}

/** The Agents a Flow's library offers: those the placement rule lets this Flow place. */
export function placeableAgents(
  agents: readonly AgentDefinition[],
  flow: Pick<FlowDraft, "projectId">,
): AgentDefinition[] {
  return agents.filter((agent) => mayPlaceAgent(flow.projectId, agent.projectId));
}

/** A small store of one dialog's state; each write publishes a new snapshot. */
function dialogStore<S extends object>(initial: S) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => snapshot,
    set(change: Partial<S>) {
      snapshot = { ...snapshot, ...change };
      listeners.forEach((notify) => notify());
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
}

const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** A definition a refused Change owner named because the placement rule would break for it. */
export interface OwnerChangeBlocker {
  /** Factory's sentence naming the blocking definition and its id. */
  readonly message: string;
  /** The blocking Flow or Agent as Studio lists it; null when Studio does not hold it. */
  readonly definition: FlowDraft | AgentDefinition | null;
}

interface ChangeOwnerSnapshot {
  /** The new owner: a Project, or null for Global. */
  readonly target: string | null;
  readonly changing: boolean;
  readonly error: string;
  /** The definitions that refused the last change; empty unless it was blocked. */
  readonly blockers: readonly OwnerChangeBlocker[];
}

/**
 * The Change owner dialog of one Flow or Agent: it sends the owner the dialog opened with as the
 * expected one, and names the Flows or Agents that refuse the move, resolved from Studio's lists
 * by the id Factory's issue names.
 */
export function createChangeOwner(
  subject: {
    readonly kind: "flow" | "agent";
    readonly id: string;
    /** The owning Project the editor shows; Factory refuses the change once it is stale. */
    readonly expected: string | null;
  },
  definitions: Pick<StudioDefinitions, "getSnapshot" | "changeFlowOwner" | "changeAgentOwner">,
) {
  const store = dialogStore<ChangeOwnerSnapshot>({
    target: subject.expected,
    changing: false,
    error: "",
    blockers: [],
  });
  /** A Flow refusal names Agents it places; an Agent refusal names Flows that place it. */
  function blockers(cause: ApiError): OwnerChangeBlocker[] {
    const lists = definitions.getSnapshot();
    const candidates: readonly (FlowDraft | AgentDefinition)[] =
      (subject.kind === "flow" ? lists.agents.value : lists.flows.value) ?? [];
    return cause.detail.issues
      .filter((issue) => issue.code === "owner_change_blocked")
      .map((issue) => ({
        message: issue.message,
        definition: candidates.find((entry) => issue.message.includes(`(${entry.id})`)) ?? null,
      }));
  }
  return {
    getSnapshot: store.get,
    subscribe: store.subscribe,
    setTarget(target: string | null) {
      if (!store.get().changing) store.set({ target, error: "", blockers: [] });
    },
    /** Moves the definition; its new state on success, undefined when refused or failed. */
    async confirm(): Promise<FlowDraft | AgentDefinition | undefined> {
      const { target, changing } = store.get();
      if (changing || target === subject.expected) return undefined;
      store.set({ changing: true, error: "", blockers: [] });
      const input = { expectedProjectId: subject.expected, projectId: target };
      try {
        const moved =
          subject.kind === "flow"
            ? await definitions.changeFlowOwner(subject.id, input)
            : await definitions.changeAgentOwner(subject.id, input);
        store.set({ changing: false });
        return moved;
      } catch (cause) {
        store.set({
          changing: false,
          error: failureMessage(cause, "Factory could not change the owner."),
          blockers: cause instanceof ApiError ? blockers(cause) : [],
        });
        return undefined;
      }
    },
  };
}

export interface FlowDuplicateSnapshot {
  /** The copy's owner: a Project, or null for Global. */
  readonly target: string | null;
  /** The new Flow's name; the plan's default until the user edits it. */
  readonly name: string;
  /** The plan for `target` with the chosen treatment of each Agent; null until previewed. */
  readonly plan: FlowDuplicatePlan | null;
  readonly previewing: boolean;
  readonly committing: boolean;
  readonly error: string;
}

const isStalePlan = (cause: unknown) =>
  cause instanceof ApiError &&
  cause.detail.issues.some((issue) => issue.code === "stale_duplicate_plan");

/**
 * The Flow Duplicate dialog: it previews the plan for the target, defaulting to the source's
 * owning Project, lets each changeable global Agent switch between keep and copy, and commits
 * exactly the previewed plan. A plan gone stale is previewed again and never committed blindly.
 */
export function createFlowDuplicate(
  source: Pick<FlowDraft, "id" | "projectId">,
  definitions: Pick<StudioDefinitions, "previewFlowDuplicate" | "duplicateFlow">,
  target: string | null = source.projectId,
) {
  const store = dialogStore<FlowDuplicateSnapshot>({
    target,
    name: "",
    plan: null,
    previewing: false,
    committing: false,
    error: "",
  });
  let nameEdited = false;
  /** Advances with every preview, so only the latest answer applies. */
  let request = 0;
  async function preview(error = "") {
    const asked = ++request;
    const { target: projectId } = store.get();
    store.set({ previewing: true, plan: null, error });
    try {
      const plan = await definitions.previewFlowDuplicate(source.id, { projectId });
      if (asked !== request) return;
      store.set({ plan, previewing: false, ...(!nameEdited && { name: plan.name }) });
    } catch (cause) {
      if (asked !== request) return;
      store.set({
        previewing: false,
        error: failureMessage(cause, "Factory could not prepare this Duplicate."),
      });
    }
  }
  return {
    getSnapshot: store.get,
    subscribe: store.subscribe,
    /** Asks Factory for the plan of the current target. */
    preview: () => preview(),
    async setTarget(projectId: string | null) {
      if (store.get().committing) return;
      store.set({ target: projectId });
      await preview();
    },
    setName(name: string) {
      nameEdited = true;
      store.set({ name });
    },
    /** Switches a changeable Agent between keep and copy; a choice the plan fixes stays. */
    choose(agentId: string, choice: FlowDuplicateChoice) {
      const { plan, committing } = store.get();
      if (!plan || committing) return;
      const agents = plan.agents.map((agent) =>
        agent.agentId === agentId && agent.changeable ? { ...agent, choice } : agent,
      );
      store.set({ plan: { ...plan, agents } });
    },
    /** Commits the plan shown; the result on success, undefined when refused or failed. */
    async confirm(): Promise<FlowDuplicate | undefined> {
      const { plan, name, committing, previewing } = store.get();
      if (!plan || committing || previewing) return undefined;
      store.set({ committing: true, error: "" });
      try {
        const result = await definitions.duplicateFlow(source.id, {
          name,
          projectId: plan.projectId,
          expectedRevision: plan.revision,
          agents: plan.agents.map(({ agentId, revision, projectId: owner, choice }) => ({
            agentId,
            revision,
            projectId: owner,
            choice,
          })),
        });
        store.set({ committing: false });
        return result;
      } catch (cause) {
        store.set({ committing: false });
        const message = failureMessage(cause, "Factory could not duplicate this Flow.");
        if (isStalePlan(cause))
          await preview(`${message} Review the updated plan, then Duplicate again.`);
        else store.set({ error: message });
        return undefined;
      }
    },
  };
}
