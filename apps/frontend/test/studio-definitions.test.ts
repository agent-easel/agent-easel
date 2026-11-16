import { expect, it, vi } from "vite-plus/test";
import { notReady } from "./support/flow-draft.ts";
import { savedAgent } from "./support/agent-draft.ts";
import {
  defaultOwner,
  ownerGroups,
  ownerPicker,
  placeableAgents,
} from "../src/studio-definitions.ts";
import {
  currentWindow,
  deliveredStudio,
  factoryProject,
  liveStudio,
  projectCatalog,
  savedFlow,
  studioChanged,
  studioSnapshot,
} from "./support/studio-definitions.ts";

it("both lists come from one Studio subscription", () => {
  // Arrange
  const { definitions, studio, socket } = liveStudio();

  // Act
  studio.message(studioSnapshot({ agents: [savedAgent()], flows: [savedFlow("Live")] }));

  // Assert
  expect(definitions.getSnapshot()).toStrictEqual({
    flows: { value: [savedFlow("Live")], synchronized: true, error: null },
    agents: { value: [savedAgent()], synchronized: true, error: null },
    projects: { value: null, synchronized: false, error: null },
    filter: { kind: "all" },
  });
  expect(socket.watches).toStrictEqual([{ rpc: "WatchStudio" }, { rpc: "WatchLaunchChoices" }]);
});

it("a committed change updates both lists in one publication, keeping untouched entities, backend order and readiness-only Flow changes", () => {
  // Arrange
  const untouched = savedAgent({ id: "untouched", updatedAt: "2026-11-09T08:00:00.000Z" });
  const edited = savedAgent({ id: "edited", updatedAt: "2026-11-08T08:00:00.000Z" });
  const flow = savedFlow("Review");
  const { definitions, studio } = deliveredStudio({ agents: [untouched, edited], flows: [flow] });
  const notify = vi.fn();
  definitions.subscribe(notify);
  const saved = { ...edited, revision: 4, updatedAt: "2026-11-11T08:00:00.000Z" };
  const blocked = { ...flow, readiness: notReady };

  // Act
  studio.message(
    studioChanged({
      agents: { upserts: [saved], removals: [] },
      flows: { upserts: [blocked], removals: [] },
    }),
  );

  // Assert
  const { agents, flows } = definitions.getSnapshot();
  expect(agents.value).toStrictEqual([saved, untouched]);
  expect(agents.value?.[1]).toBe(untouched);
  expect(flows.value).toStrictEqual([blocked]);
  expect(notify).toHaveBeenCalledTimes(1);
});

it("opening Studio holds back mutations until its subscription is current", () => {
  // Arrange
  const { definitions, live, socket } = currentWindow();

  // Act
  definitions.open();

  // Assert
  expect(socket.watches).toContainEqual({ rpc: "WatchStudio" });
  expect(live.delivery()).toBe("synchronizing");
});

it("closing Studio releases its subscription, so it no longer holds back mutations", () => {
  // Arrange
  const { definitions, live } = currentWindow();
  const close = definitions.open();

  // Act
  close();
  live.elapse();

  // Assert
  expect(live.owner.view("studio")).toStrictEqual({
    value: null,
    synchronized: false,
    error: null,
  });
  expect(live.delivery()).toBe("current");
});

it("a refused subscription keeps the lists unsynchronized with its error", () => {
  // Arrange
  const { definitions, studio, live } = deliveredStudio({
    agents: [savedAgent()],
    flows: [savedFlow("Live")],
  });

  // Act
  studio.failed({ code: "internal", message: "Studio could not be read.", issues: [] });

  // Assert
  expect(definitions.getSnapshot().flows).toStrictEqual({
    value: [savedFlow("Live")],
    synchronized: false,
    error: new Error("Studio could not be read."),
  });
  expect(definitions.getSnapshot().agents.synchronized).toBe(false);
  expect(live.delivery()).toBe("synchronizing");
});

it("an accepted write cannot mark the lists synchronized", async () => {
  // Arrange
  const { definitions } = liveStudio();

  // Act
  await definitions.createFlow({ name: "Release" });

  // Assert
  expect(definitions.getSnapshot().flows).toStrictEqual({
    value: null,
    synchronized: false,
    error: null,
  });
});

it("lists group as Global first, then each owning Project by title, keeping the backend order within a group", () => {
  // Arrange
  const northwind = factoryProject("northwind", "Northwind");
  const ledgerly = factoryProject("ledgerly", "Ledgerly");
  const release = savedFlow("Release", { id: "release", projectId: northwind.id });
  const review = savedFlow("Review", { id: "review" });
  const migrations = savedFlow("Migrations", { id: "migrations", projectId: ledgerly.id });
  const triage = savedFlow("Triage", { id: "triage", projectId: northwind.id });
  const pair = savedFlow("Pair", { id: "pair" });

  // Act
  const groups = ownerGroups([release, review, migrations, triage, pair], [northwind, ledgerly], {
    kind: "all",
  });

  // Assert
  expect(groups).toMatchObject([
    { owner: { projectId: null, title: "Global" }, items: [review, pair] },
    { owner: { projectId: "ledgerly", title: "Ledgerly" }, items: [migrations] },
    { owner: { projectId: "northwind", title: "Northwind" }, items: [release, triage] },
  ]);
});

it("a Project owner filter shows the global definitions and that Project's, never another Project's", () => {
  // Arrange
  const northwind = factoryProject("northwind", "Northwind");
  const ledgerly = factoryProject("ledgerly", "Ledgerly");
  const review = savedAgent({ id: "review" });
  const qa = savedAgent({ id: "qa", projectId: northwind.id });
  const migrations = savedAgent({ id: "migrations", projectId: ledgerly.id });

  // Act
  const groups = ownerGroups([review, qa, migrations], [northwind, ledgerly], {
    kind: "project",
    projectId: northwind.id,
  });

  // Assert
  expect(groups).toMatchObject([
    { owner: { projectId: null }, items: [review] },
    { owner: { projectId: "northwind" }, items: [qa] },
  ]);
});

it("the Global owner filter shows only global definitions", () => {
  // Arrange
  const northwind = factoryProject("northwind", "Northwind");
  const review = savedFlow("Review", { id: "review" });
  const release = savedFlow("Release", { id: "release", projectId: northwind.id });

  // Act
  const groups = ownerGroups([review, release], [northwind], { kind: "global" });

  // Assert
  expect(groups).toMatchObject([{ owner: { projectId: null }, items: [review] }]);
});

it("a Project group shows its title and repository path, and an unavailable one its availability reason", () => {
  // Arrange
  const docs = factoryProject("docs", "Docs site", {
    workspaceRoot: "~/code/docs",
    availability: "project-unavailable",
  });
  const refresh = savedFlow("Docs refresh", { projectId: docs.id });

  // Act
  const groups = ownerGroups([refresh], [docs], { kind: "all" });

  // Assert
  expect(groups[0]?.owner).toStrictEqual({
    projectId: "docs",
    title: "Docs site",
    detail: "~/code/docs",
    unavailable: "Project unavailable",
  });
});

it("Projects sharing a title and repository path are told apart by their environment", () => {
  // Arrange
  const local = factoryProject("local-app", "App", { workspaceRoot: "~/code/app" });
  const remote = factoryProject("remote-app", "App", {
    workspaceRoot: "~/code/app",
    environmentId: "studio-mac",
  });
  const flow = savedFlow("Release", { projectId: remote.id });

  // Act
  const groups = ownerGroups([flow], [local, remote], { kind: "all" });

  // Assert
  expect(groups[0]?.owner.detail).toBe("~/code/app · studio-mac on http://127.0.0.1:3773");
});

it("Studio's owner filter starts at All whatever Project the Run composer selected", () => {
  // Arrange
  const northwind = factoryProject("northwind", "Northwind");
  const { definitions, projects } = liveStudio();

  // Act
  projects.message(
    projectCatalog({ projects: [northwind], selectedProjectId: northwind.id, problem: null }),
  );

  // Assert
  const snapshot = definitions.getSnapshot();
  expect(snapshot.filter).toStrictEqual({ kind: "all" });
  expect(snapshot.projects).toStrictEqual({ value: [northwind], synchronized: true, error: null });
});

it("New Flow and Add agent default to Global while the owner filter shows All", () => {
  // Arrange
  const filter = { kind: "all" } as const;

  // Act
  const owner = defaultOwner(filter);

  // Assert
  expect(owner).toBe(null);
});

it("New Flow and Add agent default to the Project the owner filter shows", () => {
  // Arrange
  const filter = { kind: "project", projectId: "northwind" } as const;

  // Act
  const owner = defaultOwner(filter);

  // Assert
  expect(owner).toBe("northwind");
});

it("an Agent added from a Flow editor defaults to that Flow's owner whatever the filter shows", () => {
  // Arrange
  const flow = savedFlow("Release", { projectId: "ledgerly" });
  const filter = { kind: "project", projectId: "northwind" } as const;

  // Act
  const owner = defaultOwner(filter, flow);

  // Assert
  expect(owner).toBe("ledgerly");
});

it("owner targets offer Global and every Project, an unavailable one disabled with its reason", () => {
  // Arrange
  const northwind = factoryProject("northwind", "Northwind");
  const docs = factoryProject("docs", "Docs site", { availability: "directory-unavailable" });

  // Act
  const picker = ownerPicker(null, [northwind, docs]);

  // Assert
  expect(picker.targets).toMatchObject([
    { owner: { projectId: null }, disabled: null },
    { owner: { projectId: "docs" }, disabled: "Repository unavailable" },
    { owner: { projectId: "northwind" }, disabled: null },
  ]);
});

it("an unavailable owner stays chosen and blocks creating until the user picks another", () => {
  // Arrange
  const docs = factoryProject("docs", "Docs site", { availability: "project-unavailable" });

  // Act
  const picker = ownerPicker(docs.id, [docs]);

  // Assert
  expect(picker.chosen.projectId).toBe("docs");
  expect(picker.blocked).toBe("Project unavailable");
});

it("a Project Flow's Agent library offers global Agents and its Project's, never another Project's", () => {
  // Arrange
  const coder = savedAgent({ id: "coder" });
  const qa = savedAgent({ id: "qa", projectId: "northwind" });
  const migrations = savedAgent({ id: "migrations", projectId: "ledgerly" });
  const flow = savedFlow("Release", { projectId: "northwind" });

  // Act
  const library = placeableAgents([coder, qa, migrations], flow);

  // Assert
  expect(library).toStrictEqual([coder, qa]);
});

it("a global Flow's Agent library offers only global Agents", () => {
  // Arrange
  const coder = savedAgent({ id: "coder" });
  const qa = savedAgent({ id: "qa", projectId: "northwind" });
  const flow = savedFlow("Review");

  // Act
  const library = placeableAgents([coder, qa], flow);

  // Assert
  expect(library).toStrictEqual([coder]);
});
