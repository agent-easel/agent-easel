import { expect, it, vi } from "vite-plus/test";
import { ApiError } from "../src/api.ts";
import { notReady } from "./support/flow-draft.ts";
import { savedAgent } from "./support/agent-draft.ts";
import {
  createChangeOwner,
  createFlowDuplicate,
  defaultOwner,
  ownerGroups,
  ownerPicker,
  placeableAgents,
} from "../src/studio-definitions.ts";
import {
  currentWindow,
  deliveredStudio,
  duplicatePlan,
  factoryProject,
  liveStudio,
  projectCatalog,
  savedFlow,
  studioChanged,
  studioSnapshot,
} from "./support/studio-definitions.ts";

it("every list comes from one Studio subscription", () => {
  // Arrange
  const { definitions, studio, socket } = liveStudio();

  // Act
  studio.message(
    studioSnapshot({ agents: [savedAgent()], flows: [savedFlow("Live")], triggers: [] }),
  );

  // Assert
  expect(definitions.getSnapshot()).toStrictEqual({
    flows: { value: [savedFlow("Live")], synchronized: true, error: null },
    agents: { value: [savedAgent()], synchronized: true, error: null },
    triggers: { value: [], synchronized: true, error: null },
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
  const { definitions, studio } = deliveredStudio({
    agents: [untouched, edited],
    flows: [flow],
    triggers: [],
  });
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
    triggers: [],
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
    detail: null,
    unavailable: "Project unavailable",
    gone: true,
    folderMissing: false,
  });
});

it("a Project no longer in T3 groups last, and a missing folder or a lost connection does not", () => {
  // Arrange
  const alpha = factoryProject("alpha", "Alpha");
  const gone = factoryProject("gone", "Aardvark", {
    availability: "project-unavailable",
    workspaceRoot: "~/gone",
  });
  const folder = factoryProject("folder", "Folder", {
    availability: "directory-unavailable",
    workspaceRoot: "~/folder",
  });
  const offline = factoryProject("offline", "Offline", {
    availability: "connection-unavailable",
    workspaceRoot: "~/offline",
  });
  const other = factoryProject("other", "Zebra", { availability: "different-environment" });

  // Act
  const groups = ownerGroups(
    [
      savedFlow("Gone", { projectId: gone.id }),
      savedFlow("Alpha", { projectId: alpha.id }),
      savedFlow("Folder", { projectId: folder.id }),
      savedFlow("Offline", { projectId: offline.id }),
      savedFlow("Other", { projectId: other.id }),
    ],
    [gone, alpha, folder, offline, other],
    { kind: "all" },
  );

  // Assert
  expect(groups.map((group) => group.owner.title)).toStrictEqual([
    "Alpha",
    "Folder",
    "Offline",
    "Aardvark",
    "Zebra",
  ]);
  expect(groups[1]?.owner).toMatchObject({
    gone: false,
    folderMissing: true,
    detail: "~/folder",
    unavailable: "Repository unavailable",
  });
  expect(groups[2]?.owner).toMatchObject({
    gone: false,
    folderMissing: false,
    unavailable: "T3 connection unavailable",
  });
  expect(groups[3]?.owner).toMatchObject({
    gone: true,
    folderMissing: false,
    detail: null,
  });
  expect(groups[4]?.owner.gone).toBe(true);
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

it("New Flow and New Agent default to Global while the owner filter shows All", () => {
  // Arrange
  const filter = { kind: "all" } as const;

  // Act
  const owner = defaultOwner(filter);

  // Assert
  expect(owner).toBe(null);
});

it("New Flow and New Agent default to the Project the owner filter shows", () => {
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

it("owner targets offer Global and only the available Projects, like the Run composer", () => {
  // Arrange
  const northwind = factoryProject("northwind", "Northwind");
  const removed = factoryProject("removed", "Removed in T3", {
    availability: "project-unavailable",
  });

  // Act
  const picker = ownerPicker(null, [northwind, removed]);

  // Assert
  expect(picker.targets).toMatchObject([
    { owner: { projectId: null }, disabled: null },
    { owner: { projectId: "northwind" }, disabled: null },
  ]);
  expect(picker.targets).toHaveLength(2);
});

it("a chosen unavailable Project stays among the owner targets, disabled with its reason", () => {
  // Arrange
  const northwind = factoryProject("northwind", "Northwind");
  const docs = factoryProject("docs", "Docs site", { availability: "directory-unavailable" });

  // Act
  const picker = ownerPicker(docs.id, [northwind, docs]);

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

it("Change owner sends the owner the dialog opened with as expected and the chosen new owner", async () => {
  // Arrange
  const { definitions, factory } = deliveredStudio({ agents: [savedAgent()], flows: [] });
  const change = createChangeOwner({ kind: "agent", id: "agent", expected: null }, definitions);
  change.setTarget("northwind");

  // Act
  const moved = await change.confirm();

  // Assert
  expect(factory.changeAgentOwner).toHaveBeenCalledWith("agent", {
    expectedProjectId: null,
    projectId: "northwind",
  });
  expect(moved).toMatchObject({ id: "agent", projectId: "northwind" });
});

it("a refused Change owner names each blocking Flow as Studio lists it", async () => {
  // Arrange
  const implement = savedFlow("Implement + Review", { id: "implement" });
  const migrations = savedFlow("Ledgerly migrations", { id: "migrations", projectId: "ledgerly" });
  const { definitions, factory } = deliveredStudio({
    agents: [savedAgent()],
    flows: [implement, migrations],
  });
  const blocked = (flow: string, id: string) => ({
    code: "owner_change_blocked",
    path: "projectId",
    message: `Flow "${flow}" (${id}) places this Agent outside the new owner.`,
  });
  factory.changeAgentOwner.mockRejectedValueOnce(
    new ApiError({
      code: "conflict",
      message: "Flows outside the new owner place this Agent.",
      issues: [blocked("Implement + Review", "implement"), blocked("Gone", "removed-flow")],
    }),
  );
  const change = createChangeOwner({ kind: "agent", id: "agent", expected: null }, definitions);
  change.setTarget("northwind");

  // Act
  const moved = await change.confirm();

  // Assert
  expect(moved).toBeUndefined();
  expect(change.getSnapshot()).toMatchObject({
    target: "northwind",
    changing: false,
    error: "Flows outside the new owner place this Agent.",
    blockers: [
      { definition: implement },
      {
        definition: null,
        message: 'Flow "Gone" (removed-flow) places this Agent outside the new owner.',
      },
    ],
  });
});

it("Flow Duplicate previews into the source's owning Project and starts from the plan's defaults", async () => {
  // Arrange
  const { definitions, factory } = deliveredStudio({ agents: [], flows: [] });
  const duplicate = createFlowDuplicate({ id: "release", projectId: "northwind" }, definitions);

  // Act
  await duplicate.preview();

  // Assert
  expect(factory.previewFlowDuplicate).toHaveBeenCalledWith("release", { projectId: "northwind" });
  expect(duplicate.getSnapshot()).toMatchObject({
    target: "northwind",
    name: "Release copy",
    plan: {
      agents: [
        { agentId: "coder", choice: "keep", changeable: true },
        { agentId: "qa", choice: "copy", changeable: false },
      ],
    },
  });
});

it("changing the Duplicate target previews the plan again for that target, keeping an edited name", async () => {
  // Arrange
  const { definitions, factory } = deliveredStudio({ agents: [], flows: [] });
  const duplicate = createFlowDuplicate({ id: "release", projectId: "northwind" }, definitions);
  await duplicate.preview();
  duplicate.setName("Release (Ledgerly)");

  // Act
  await duplicate.setTarget("ledgerly");

  // Assert
  expect(factory.previewFlowDuplicate).toHaveBeenLastCalledWith("release", {
    projectId: "ledgerly",
  });
  expect(duplicate.getSnapshot()).toMatchObject({
    target: "ledgerly",
    name: "Release (Ledgerly)",
    plan: { projectId: "ledgerly" },
  });
});

it("Duplicate commits the previewed revision, the target and every Agent's choice, a global Agent switched to Copy", async () => {
  // Arrange
  const { definitions, factory } = deliveredStudio({ agents: [], flows: [] });
  const duplicate = createFlowDuplicate(
    { id: "release", projectId: "northwind" },
    definitions,
    "ledgerly",
  );
  await duplicate.preview();
  duplicate.choose("coder", "copy");

  // Act
  const result = await duplicate.confirm();

  // Assert
  expect(factory.duplicateFlow).toHaveBeenCalledWith("release", {
    name: "Release copy",
    projectId: "ledgerly",
    expectedRevision: 2,
    agents: [
      { agentId: "coder", revision: 3, projectId: null, choice: "copy" },
      { agentId: "qa", revision: 1, projectId: "northwind", choice: "copy" },
    ],
  });
  expect(result).toMatchObject({ flow: { id: "release-copy" } });
});

it("a Duplicate choice the plan fixes cannot be changed", async () => {
  // Arrange
  const { definitions } = deliveredStudio({ agents: [], flows: [] });
  const duplicate = createFlowDuplicate({ id: "release", projectId: "northwind" }, definitions);
  await duplicate.preview();

  // Act
  duplicate.choose("qa", "keep");

  // Assert
  expect(duplicate.getSnapshot().plan?.agents[1]).toMatchObject({ agentId: "qa", choice: "copy" });
});

it("a Duplicate refused as a stale plan previews the plan again and says why", async () => {
  // Arrange
  const { definitions, factory } = deliveredStudio({ agents: [], flows: [] });
  const duplicate = createFlowDuplicate({ id: "release", projectId: "northwind" }, definitions);
  await duplicate.preview();
  factory.duplicateFlow.mockRejectedValueOnce(
    new ApiError({
      code: "conflict",
      message: "The Flow or an Agent it places changed after this Duplicate was previewed.",
      issues: [{ code: "stale_duplicate_plan", path: "agents", message: "Preview again." }],
    }),
  );
  factory.previewFlowDuplicate.mockResolvedValueOnce(
    duplicatePlan({ revision: 3, projectId: "northwind" }),
  );

  // Act
  const result = await duplicate.confirm();

  // Assert
  expect(result).toBeUndefined();
  expect(factory.duplicateFlow).toHaveBeenCalledTimes(1);
  expect(duplicate.getSnapshot()).toMatchObject({
    committing: false,
    plan: { revision: 3 },
    error:
      "The Flow or an Agent it places changed after this Duplicate was previewed. Review the updated plan, then Duplicate again.",
  });
});
