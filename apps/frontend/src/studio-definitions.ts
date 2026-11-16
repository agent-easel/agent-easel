import { useSyncExternalStore } from "react";
import { mayPlaceAgent } from "@t3-factory/domain-validation";
import type {
  AgentDefinition,
  FactoryProject,
  FlowDraft,
  LaunchChoices,
  OperationError,
  StudioDefinitions as SavedDefinitions,
} from "@t3-factory/contracts";
import { api } from "./api.ts";
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
