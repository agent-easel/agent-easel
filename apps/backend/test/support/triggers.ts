import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, type TestContext } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type {
  CreateTriggerInput,
  FactoryProject,
  TriggerDefinition,
  UpdateTriggerInput,
} from "@t3-factory/contracts";
import type { GitHubIssue, GitHubRepository } from "../../src/adapters/github.ts";
import type { LiveStreams } from "../../src/live-streams.ts";
import type { ControlledGitHub, ControlledIssue } from "./controlled-github.ts";
import { holdLaunchInspection } from "./controlled-t3.ts";
import type { Factory } from "../../src/index.ts";
import { spawnFactoryProcess } from "./factory-process.ts";
import { appliedStudio, subscribe } from "./live.ts";
import { prepared, preparedService } from "./prepared-runner.ts";
import { triggerEnabled, triggerSaved } from "./scenarios.ts";

/** The repository the prepared Project's folder names on GitHub. */
export const atlasRepository: GitHubRepository = {
  host: "github.com",
  nameWithOwner: "factory-maintainer/atlas",
  nodeId: "R_atlas",
  visibility: "private",
};

/**
 * The prepared Project and ready Flow, with the Project's folder naming `repository` on GitHub,
 * and the least a client sends to create a GitHub Issues Trigger for them.
 */
export async function triggerWorld(c: TestContext, repository = atlasRepository) {
  const fixture = await prepared(c);
  return { ...fixture, triggerInput: watching(fixture, repository) };
}

/** Points the Project's folder at `repository` and returns the least input creating a Trigger. */
function watching(
  fixture: {
    readonly github: ControlledGitHub;
    readonly project: FactoryProject;
    readonly flow: { readonly id: string };
  },
  repository: GitHubRepository,
) {
  fixture.github.repositories.set(fixture.project.workspaceRoot, repository);
  return {
    kind: "github_issues",
    name: "Ready issues",
    projectId: fixture.project.id,
    flowId: fixture.flow.id,
    github: { repositoryNodeId: repository.nodeId },
  } satisfies CreateTriggerInput;
}

/** The prepared Project as T3 lists it once the connection points at a remote T3. */
export async function remoteProject(f: Factory) {
  assert((await f.configureConnection({ endpoint: "https://t3.example/mcp" })).ok);
  const catalog = await f.recheckProjects();
  assert(catalog.ok);
  const project = catalog.value.projects.find(
    (entry) => entry.endpoint === "https://t3.example/mcp",
  );
  assert(project);
  return project;
}

/** Adds `label` to the issue with a new `labeled` event. */
export function labelIssue(github: ControlledGitHub, issue: ControlledIssue, label: string) {
  issue.labels.push(label);
  issue.labellings.push({
    label,
    eventId: `LE_${github.issues.flatMap((each) => each.labellings).length + 1}`,
    createdAt: issue.createdAt,
  });
}

export function unlabelIssue(issue: ControlledIssue, label: string) {
  issue.labels = issue.labels.filter((candidate) => candidate !== label);
}

/** Opens an issue in the atlas repository and adds `label` to it. */
function openIssue(
  github: ControlledGitHub,
  issue: Pick<GitHubIssue, "number" | "title" | "createdAt">,
  label: string,
) {
  const opened: ControlledIssue = {
    ...issue,
    nodeId: `I_atlas_${issue.number}`,
    url: `https://github.com/${atlasRepository.nameWithOwner}/issues/${issue.number}`,
    repositoryNodeId: atlasRepository.nodeId,
    open: true,
    matchesQuery: true,
    labels: [],
    labellings: [],
  };
  github.issues.push(opened);
  labelIssue(github, opened, label);
  return opened;
}

/** Opens an issue in the atlas repository that carries the ready label. */
const readyIssues =
  (github: ControlledGitHub) =>
  (number: number, title: string, createdAt = "2026-11-10T09:00:00.000Z") =>
    openIssue(github, { number, title, createdAt }, "factory:ready");

type TriggerSettings = Partial<Pick<CreateTriggerInput, "maxActiveRuns" | "schedule">>;

/**
 * An enabled GitHub Issues Trigger on the prepared world, which has not checked yet.
 * `readyIssue` opens an issue in its repository carrying the ready label.
 */
export async function checkingWorld(c: TestContext, settings: TriggerSettings = {}) {
  const world = await triggerWorld(c);
  const trigger = await triggerEnabled(world.f, { ...world.triggerInput, ...settings });
  return { ...world, trigger, readyIssue: readyIssues(world.github) };
}

/**
 * A saved GitHub Issues Trigger that is still disabled, as its author reviews it before enabling.
 * `readyIssue` opens an issue in its repository carrying the ready label.
 */
export async function reviewingWorld(c: TestContext, settings: TriggerSettings = {}) {
  const world = await triggerWorld(c);
  const trigger = await triggerSaved(world.f, { ...world.triggerInput, ...settings });
  return { ...world, trigger, readyIssue: readyIssues(world.github) };
}

/**
 * As `checkingWorld`, on backend services in the test's scope so TestClock drives the schedule.
 * The periodic reconcile is left off the clock; the default schedule checks every 5 minutes.
 * GitHub's call log starts after the save, so it holds only what checks read.
 */
export const scheduledWorld = (c: TestContext, settings: TriggerSettings = {}) =>
  Effect.gen(function* () {
    const fixture = yield* preparedService(c, undefined, { connectionRetryMs: 24 * 60 * 60_000 });
    const trigger = yield* Effect.promise(() =>
      triggerEnabled(fixture.world.factory, { ...watching(fixture, atlasRepository), ...settings }),
    );
    fixture.github.calls.length = 0;
    return { ...fixture, trigger, readyIssue: readyIssues(fixture.github) };
  });

/** Resolves with the Trigger once a Studio subscriber sees it meet `condition`. */
export async function studioTrigger(
  c: TestContext,
  live: LiveStreams,
  triggerId: string,
  condition: (trigger: TriggerDefinition) => boolean,
) {
  const shown = (messages: Parameters<typeof appliedStudio>[0]) =>
    appliedStudio(messages)?.triggers.find((trigger) => trigger.id === triggerId);
  const messages = await subscribe(c, live.watchStudio()).until((received) => {
    const trigger = shown(received);
    return trigger !== undefined && condition(trigger);
  });
  return shown(messages)!;
}

/**
 * Closes the world's Factory, lets another process check the Trigger and die at `stage` (see
 * `trigger-process.ts`), and reopens the database here with the world's T3 and GitHub.
 */
export async function reopenedAfterCrashedCheck(
  world: Awaited<ReturnType<typeof checkingWorld>>,
  stage: "preflight" | "accepted",
) {
  await world.f.close();
  const fixturePath = join(dirname(world.h.databasePath), "trigger-crash.json");
  await writeFile(
    fixturePath,
    JSON.stringify({
      projects: world.t3.projects,
      repositories: [...world.github.repositories],
      issues: world.github.issues,
    }),
  );
  const child = spawnFactoryProcess(
    [
      fileURLToPath(new URL("./trigger-process.ts", import.meta.url)),
      world.h.databasePath,
      fixturePath,
      stage,
      world.trigger.id,
    ],
    dirname(world.h.databasePath),
  );
  const [code] = await once(child, "exit");
  assert(code === 86, `The checking process exited with ${String(code)} instead of crashing.`);
  return world.h.open({ t3: world.t3, github: world.github, connectionRetryMs: 60_000 });
}

/** The issue numbers of the Runs started in the Project, as their origins name them. */
export async function startedIssues(f: Factory, projectId: string) {
  const runs = await f.listRuns(projectId);
  assert(runs.ok);
  const details = await Promise.all(runs.value.map((run) => f.getRun(run.id)));
  return details
    .map((detail) => {
      assert(detail.ok);
      return detail.value.origin?.issueNumber ?? 0;
    })
    .sort((left, right) => left - right);
}

/** Holds a check's first Start at external preflight until the test releases it. */
export async function pendingCheck(world: Awaited<ReturnType<typeof checkingWorld>>) {
  const { inspecting, release } = holdLaunchInspection(world.t3);
  const checked = world.f.runTrigger(world.trigger.id);
  await inspecting;
  return { checked, release };
}

/** The saved Trigger's settings as an edit from its current revision, with `changes` applied. */
export const triggerEdit = (
  trigger: TriggerDefinition,
  changes: Partial<Pick<UpdateTriggerInput, "name" | "maxActiveRuns" | "schedule">>,
): UpdateTriggerInput => ({
  expectedRevision: trigger.revision,
  kind: trigger.kind,
  name: trigger.name,
  projectId: trigger.projectId,
  flowId: trigger.flowId,
  schedule: trigger.schedule,
  maxActiveRuns: trigger.maxActiveRuns,
  github: { repositoryNodeId: trigger.github.repository.nodeId, query: trigger.github.query },
  ...changes,
});
