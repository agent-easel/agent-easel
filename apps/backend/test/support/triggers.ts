import { assert, type TestContext } from "@effect/vitest";
import type {
  CreateTriggerInput,
  TriggerDefinition,
  UpdateTriggerInput,
} from "@t3-factory/contracts";
import type { GitHubIssue, GitHubRepository } from "../../src/adapters/github.ts";
import type { ControlledGitHub, ControlledIssue } from "./controlled-github.ts";
import { holdLaunchInspection } from "./controlled-t3.ts";
import type { Factory } from "../../src/index.ts";
import { prepared } from "./prepared-runner.ts";
import { triggerEnabled } from "./scenarios.ts";

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
  fixture.github.repositories.set(fixture.project.workspaceRoot, repository);
  const triggerInput = {
    kind: "github_issues",
    name: "Ready issues",
    projectId: fixture.project.id,
    flowId: fixture.flow.id,
    github: { repositoryNodeId: repository.nodeId },
  } satisfies CreateTriggerInput;
  return { ...fixture, triggerInput };
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

/**
 * An enabled GitHub Issues Trigger on the prepared world, which has not checked yet.
 * `readyIssue` opens an issue in its repository carrying the ready label.
 */
export async function checkingWorld(
  c: TestContext,
  settings: Partial<Pick<CreateTriggerInput, "maxActiveRuns">> = {},
) {
  const world = await triggerWorld(c);
  const trigger = await triggerEnabled(world.f, { ...world.triggerInput, ...settings });
  const readyIssue = (number: number, title: string, createdAt = "2026-11-10T09:00:00.000Z") =>
    openIssue(world.github, { number, title, createdAt }, "factory:ready");
  return { ...world, trigger, readyIssue };
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
  changes: Partial<Pick<UpdateTriggerInput, "name" | "maxActiveRuns">>,
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
