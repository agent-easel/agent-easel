import { useSyncExternalStore } from "react";
import {
  mattersNeedingOwner,
  type FactoryProject,
  type RunNavigationEntry,
} from "@t3-factory/contracts";
import { byCreation, draftTitle, type SavedRunDraft } from "./run-draft.ts";
import { runBranches } from "./components/run-repositories.tsx";

export type RunListView = {
  readonly search: string;
  readonly project: string | null;
  readonly needsYou: boolean;
};

let view: RunListView = { search: "", project: null, needsYou: false };
const listeners = new Set<() => void>();

function change(next: RunListView) {
  view = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const runListView = {
  current: () => view,
  search: (search: string) => change({ ...view, search, needsYou: view.needsYou && !search }),
  chooseProject: (project: string | null) =>
    change({ ...view, project, needsYou: view.needsYou && project === null }),
  showNeedsYou: () => change({ search: "", project: null, needsYou: true }),
  clearNeedsYou: () => change({ ...view, needsYou: false }),
};

export function useRunListView(): RunListView {
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => view,
  );
}

export type RunListProject = Pick<
  FactoryProject,
  "id" | "title" | "workspaceRoot" | "projectIcon" | "faviconUrl"
>;

export interface RunListCatalog {
  readonly projects: readonly RunListProject[];
  readonly flows: readonly { readonly id: string; readonly name: string }[];
}

type Entry = RunNavigationEntry | SavedRunDraft;

export function runList({
  runs,
  drafts,
  view,
  loaded,
  catalog,
}: {
  runs: readonly RunNavigationEntry[];
  drafts: readonly SavedRunDraft[];
  view: RunListView;
  loaded: boolean;
  catalog: RunListCatalog | undefined;
}) {
  const projects = projectsById(runs, catalog);
  const absent =
    loaded &&
    !runs.some((run) => run.project.id === view.project) &&
    !drafts.some((draft) => draft.projectId === view.project);
  const project = view.project !== null && absent ? null : view.project;
  const choices = projectChoices(runs, drafts, projects);
  const query = view.search.trim();
  const shared = { projects: choices, project, flat: !!query || view.needsYou };
  if (view.needsYou) return { ...shared, ...needsYouGroup(runs) };
  const inProject = <T extends Entry>(entries: readonly T[]) =>
    project === null ? entries : entries.filter((entry) => projectOf(entry) === project);
  const matches = searchMatcher(query, projects, catalog);
  const groups = navigationGroups(
    inProject(runs).filter(matches),
    inProject(drafts).filter(matches),
    query,
  );
  return { ...shared, ...groups, total: runs.length + drafts.length };
}

const projectOf = (entry: Entry) => ("presentation" in entry ? entry.project.id : entry.projectId);

function projectsById(runs: readonly RunNavigationEntry[], catalog: RunListCatalog | undefined) {
  const projects = new Map<string, RunListProject>(
    (catalog?.projects ?? []).map((project) => [project.id, project]),
  );
  for (const run of runs) projects.set(run.project.id, run.project);
  return projects;
}

function projectChoices(
  runs: readonly RunNavigationEntry[],
  drafts: readonly SavedRunDraft[],
  projects: ReadonlyMap<string, RunListProject>,
) {
  const listed = new Set([...runs, ...drafts].map(projectOf));
  return [...projects.values()]
    .filter((project) => listed.has(project.id))
    .toSorted((a, b) => a.title.localeCompare(b.title));
}

function searchMatcher(
  query: string,
  projects: ReadonlyMap<string, RunListProject>,
  catalog: RunListCatalog | undefined,
) {
  if (!query) return () => true;
  const numbered = /^#(\d+)$/.exec(query);
  if (numbered)
    return (entry: Entry) => "presentation" in entry && String(entry.number) === numbered[1];
  if (/^\d+$/.test(query)) {
    const token = new RegExp(`(?:^|\\D)${query}(?:\\D|$)`);
    return (entry: Entry) =>
      "presentation" in entry &&
      entry.number !== null &&
      (String(entry.number) === query || runBranches(entry).some((branch) => token.test(branch)));
  }
  const terms = query.toLocaleLowerCase().split(/\s+/);
  const flowName = (id: string) => catalog?.flows.find((flow) => flow.id === id)?.name ?? "";
  const fields = (entry: Entry) =>
    "presentation" in entry
      ? [entry.title, entry.project.title, entry.flowName, ...runBranches(entry)]
      : [draftTitle(entry), projects.get(entry.projectId)?.title ?? "", flowName(entry.flowId)];
  return (entry: Entry) => {
    const values = fields(entry).map((value) => value.toLocaleLowerCase());
    return terms.every((term) => values.some((value) => value.includes(term)));
  };
}

function isActive(run: RunNavigationEntry) {
  return run.lifecycle === "active";
}

function needRank(entry: Entry) {
  if (!("presentation" in entry)) return 2;
  if (entry.attention.needsInput) return 0;
  return entry.attention.problem ? 1 : 2;
}

const byNeed = (left: Entry, right: Entry) => needRank(left) - needRank(right);

function navigationGroups(
  runs: readonly RunNavigationEntry[],
  drafts: readonly SavedRunDraft[],
  query: string,
) {
  const active = runs.filter(isActive);
  const main = active.filter((run) => !run.presentation.snoozed);
  return {
    open: query
      ? [...runs, ...drafts].toSorted(byCreation)
      : [...main, ...drafts].toSorted(byCreation).toSorted(byNeed),
    snoozed: active.filter((run) => run.presentation.snoozed),
    settled: runs.filter((run) => !isActive(run)),
    matches: runs.length + drafts.length,
  };
}

function needsYouGroup(runs: readonly RunNavigationEntry[]) {
  const waiting = runs.filter((run) => mattersNeedingOwner(run).length > 0).toSorted(byCreation);
  return {
    open: waiting,
    snoozed: [],
    settled: [],
    matches: waiting.length,
    total: runs.length,
  };
}
