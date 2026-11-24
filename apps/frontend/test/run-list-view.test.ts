import { expect, it } from "vite-plus/test";
import type { RunNavigationEntry } from "@agent-easel/contracts";
import type { SavedRunDraft } from "../src/run-draft.ts";
import { runList, runListView, type RunListView } from "../src/run-list-view.ts";
import { runEntry } from "./support/run.ts";

const availability = "available" as const;
const northwind = {
  id: "northwind",
  title: "Northwind",
  workspaceRoot: "~/code/northwind",
  availability,
};
const atlas = { id: "atlas", title: "Atlas", workspaceRoot: "~/code/atlas", availability };
const matchJob = {
  id: "matchjob",
  title: "MatchJob",
  workspaceRoot: "~/code/matchjob",
  availability,
};

function run(
  id: string,
  createdAt: string,
  fields: Partial<RunNavigationEntry> = {},
): RunNavigationEntry {
  return { ...runEntry(), id, creationKey: id, title: id, createdAt, ...fields };
}

function draft(id: string, text: string, fields: Partial<SavedRunDraft> = {}): SavedRunDraft {
  return {
    id,
    segments: [{ type: "text", text }],
    images: [],
    projectId: "",
    flowId: "",
    titleProvenance: "automatic",
    createdAt: "2026-11-01T00:00:00Z",
    listed: true,
    ...fields,
  };
}

const view = (fields: Partial<RunListView> = {}): RunListView => ({
  search: "",
  project: null,
  needsYou: false,
  ...fields,
});

const chosen = (project: { id: string; title: string }) => ({
  id: project.id,
  title: project.title,
});

const ids = (entries: readonly { id: string }[]) => entries.map((entry) => entry.id);

const listOf = (
  runs: readonly RunNavigationEntry[],
  shown: RunListView,
  drafts: readonly SavedRunDraft[] = [],
  loaded = true,
) =>
  runList({
    runs,
    drafts,
    view: shown,
    loaded,
    catalog: { projects: [northwind, atlas, matchJob], flows: [{ id: "ship", name: "Ship it" }] },
  });

it("a #N search finds only the Run with that exact number", () => {
  // Arrange
  const runs = [
    run("twelve", "2026-11-03T00:00:00Z", { number: 12 }),
    run("hundred-twenty", "2026-11-02T00:00:00Z", { number: 120 }),
    run("branch", "2026-11-01T00:00:00Z", { number: 3, boundBranch: "fix/issue-12" }),
  ];

  // Act
  const list = listOf(runs, view({ search: "#12" }));

  // Assert
  expect(ids(list.open)).toEqual(["twelve"]);
  expect(list.matches).toBe(1);
});

it("a bare number finds that Run number and branches holding it as a whole number token, newest first", () => {
  // Arrange
  const branch = (id: string, createdAt: string, boundBranch: string) =>
    run(id, createdAt, { number: 1, boundBranch });
  const runs = [
    branch("issue", "2026-11-07T00:00:00Z", "fix/issue-12"),
    run("titled", "2026-11-06T00:00:00Z", { number: 2, title: "Ship 12 fixes" }),
    branch("factory", "2026-11-05T00:00:00Z", "run-12-8f3a91c2"),
    branch("longer", "2026-11-04T00:00:00Z", "run-120-8f3a91c2"),
    run("number", "2026-11-03T00:00:00Z", { number: 12 }),
    branch("prefix", "2026-11-02T00:00:00Z", "12-login"),
    branch("thousands", "2026-11-01T00:00:00Z", "1234-login"),
    run("unnumbered", "2026-10-31T00:00:00Z", { number: null, title: "12" }),
  ];

  // Act
  const list = listOf(runs, view({ search: " 12 " }));

  // Assert
  expect(ids(list.open)).toEqual(["issue", "factory", "number", "prefix"]);
});

const crossFieldRuns = [
  run("both", "2026-11-03T00:00:00Z", { title: "Fix login", project: northwind }),
  run("title-only", "2026-11-02T00:00:00Z", { title: "Fix login", project: atlas }),
  run("branch", "2026-11-01T00:00:00Z", { project: northwind, boundBranch: "feat/Login-page" }),
];
const crossFieldDrafts = [
  draft("draft-flow", "Northwind follow-up", { projectId: "northwind", flowId: "ship" }),
  draft("draft-unresolved", "Login draft", { projectId: "gone" }),
];

it("every search term must match a Run's title, Project or a branch, in any combination", () => {
  // Arrange
  const shown = view({ search: "LOGIN northwind" });

  // Act
  const list = listOf(crossFieldRuns, shown, crossFieldDrafts);

  // Assert
  expect(ids(list.open)).toEqual(["both", "branch"]);
});

it("a draft matches search terms on its resolvable Project and Flow names", () => {
  // Arrange
  const shown = view({ search: "ship northwind" });

  // Act
  const list = listOf(crossFieldRuns, shown, crossFieldDrafts);

  // Assert
  expect(ids(list.open)).toEqual(["draft-flow"]);
});

it("a Project selection without a search keeps the grouped view narrowed to that Project", () => {
  // Arrange
  const runs = [
    run("open", "2026-11-04T00:00:00Z", { project: northwind }),
    run("snoozed", "2026-11-03T00:00:00Z", {
      project: northwind,
      presentation: { snoozed: true, woke: false },
    }),
    run("settled", "2026-11-02T00:00:00Z", { project: northwind, lifecycle: "settled" }),
    run("other", "2026-11-01T00:00:00Z", { project: atlas, lifecycle: "settled" }),
  ];
  const drafts = [
    draft("draft", "Northwind draft", { projectId: "northwind" }),
    draft("other-draft", "Atlas draft", { projectId: "atlas" }),
  ];

  // Act
  const list = listOf(runs, view({ project: chosen(northwind) }), drafts);

  // Assert
  expect(list.flat).toBe(false);
  expect(ids(list.open)).toEqual(["open", "draft"]);
  expect(ids(list.snoozed)).toEqual(["snoozed"]);
  expect(ids(list.settled)).toEqual(["settled"]);
  expect(list.project).toEqual(chosen(northwind));
});

it("the Project choices are the Projects with a Run or resolvable draft, alphabetically", () => {
  // Arrange
  const runs = [
    run("northwind", "2026-11-02T00:00:00Z", {
      project: { ...northwind, availability: "project-unavailable" },
    }),
    run("atlas", "2026-11-01T00:00:00Z", { project: atlas }),
  ];
  const drafts = [
    draft("draft-only", "MatchJob draft", { projectId: "matchjob" }),
    draft("unresolved", "Lost draft", { projectId: "gone" }),
  ];

  // Act
  const list = listOf(runs, view(), drafts);

  // Assert
  expect(list.projects.map((project) => project.title)).toEqual(["Atlas", "MatchJob", "Northwind"]);
});

it("Needs you clears the search and the Project", () => {
  // Arrange
  runListView.search("login");
  runListView.chooseProject(chosen(northwind));

  // Act
  runListView.showNeedsYou();

  // Assert
  expect(runListView.current()).toEqual({ search: "", project: null, needsYou: true });
});

it("choosing a Project turns Needs you off and narrows to that Project", () => {
  // Arrange
  runListView.showNeedsYou();

  // Act
  runListView.chooseProject(chosen(atlas));

  // Assert
  expect(runListView.current()).toEqual({ search: "", project: chosen(atlas), needsYou: false });
});

it("typing a search turns Needs you off and searches the whole list", () => {
  // Arrange
  runListView.showNeedsYou();

  // Act
  runListView.search("12");

  // Assert
  expect(runListView.current()).toEqual({ search: "12", project: null, needsYou: false });
});

const atlasRuns = [run("atlas", "2026-11-01T00:00:00Z", { project: atlas })];

it("the Project selection is kept while navigation loads", () => {
  // Arrange
  const shown = view({ project: chosen(northwind) });

  // Act
  const list = listOf([], shown, [], false);

  // Assert
  expect(list.project).toEqual(chosen(northwind));
});

it("the Project selection is kept when nothing in it matches the search", () => {
  // Arrange
  const shown = view({ project: chosen(atlas), search: "nothing" });

  // Act
  const list = listOf(atlasRuns, shown);

  // Assert
  expect(list.project).toEqual(chosen(atlas));
  expect(list.matches).toBe(0);
});

it("a Project with only a draft keeps the selection under the name it was chosen by", () => {
  // Arrange
  const drafts = [draft("unresolved", "Draft", { projectId: "gone" })];
  const shown = view({ project: { id: "gone", title: "Gone" } });

  // Act
  const list = listOf(atlasRuns, shown, drafts);

  // Assert
  expect(list.project).toEqual({ id: "gone", title: "Gone" });
});

it("the Project selection falls back to All Projects after load when it has no Run or draft", () => {
  // Arrange
  const shown = view({ project: chosen(northwind) });

  // Act
  const list = listOf(atlasRuns, shown);

  // Assert
  expect(list.project).toBeNull();
});

it("the Project selection takes the Project's current name when the catalog knows it", () => {
  // Arrange
  const shown = view({ project: { id: "atlas", title: "Atlas (old name)" } });

  // Act
  const list = listOf(atlasRuns, shown);

  // Assert
  expect(list.project).toEqual(chosen(atlas));
});
