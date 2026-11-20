import type { FactoryProject } from "../../packages/contracts/src/index.ts";
import type { Factory } from "../../apps/backend/src/index.ts";
import type { ControlledGitHub } from "../../apps/backend/test/support/controlled-github.ts";
import {
  launchedWorkers,
  observeFor,
  triggerChecked,
  triggerEnabled,
  triggerSaved,
} from "../../apps/backend/test/support/scenarios.ts";
import { draftFlowName } from "./seed-flows.ts";
import type { DemoFlows } from "./seed-scenarios.ts";
import { requireSuccess, type SeedContext } from "./seed-support.ts";

/**
 * Triggers in each state Studio shows, all watching the Atlas Project's repository on the demo's
 * GitHub: healthy with a started Run, in Error, disabled, and manual-only with the schedule off.
 * Answers the Run the healthy Trigger started.
 */
export async function createDemoTriggers(
  context: SeedContext,
  github: ControlledGitHub,
  project: FactoryProject,
  flows: DemoFlows,
) {
  const { factory } = context;
  const repository = github.nameRepository(project.workspaceRoot, "factory-demo/atlas");
  github.openIssue(repository, { number: 41, title: "Index search results" }).open = false;
  github.openIssue(repository, {
    number: 42,
    title: "Show keyboard shortcuts in the help menu",
    labels: ["enhancement", "factory:ready"],
  });
  github.openIssue(repository, {
    number: 43,
    title: "Search is slow on large projects",
    labels: ["bug"],
  });
  const watching = (name: string, query: string, flowId = flows.simple) => ({
    kind: "github_issues" as const,
    name,
    projectId: project.id,
    flowId,
    github: { repositoryNodeId: repository.nodeId, query },
  });
  const healthy = await triggerEnabled(factory, {
    ...watching("Demo · Implement ready issues", "label:factory:ready"),
    schedule: { enabled: true, intervalMinutes: 15 },
    maxActiveRuns: 2,
  });
  await triggerChecked(factory, healthy.id);
  const failing = await triggerEnabled(factory, {
    ...watching(
      "Demo · Release checklist issues",
      "label:release-ready",
      await flowNamed(factory, draftFlowName),
    ),
    schedule: { enabled: true, intervalMinutes: 60 },
  });
  // Its Flow is not ready, so every check records the Error instead of starting a Run.
  await triggerChecked(factory, failing.id);
  await triggerSaved(factory, watching("Demo · Documentation follow-ups", "label:docs-ready"));
  const manual = await triggerEnabled(factory, {
    ...watching("Demo · Hotfix on request", "label:hotfix-ready"),
    schedule: { enabled: false, intervalMinutes: 5 },
  });
  await triggerChecked(factory, manual.id);
  return triggerStartedRun(context, healthy.id);
}

async function flowNamed(factory: Factory, name: string) {
  return requireSuccess(await factory.listFlows()).find((flow) => flow.name === name)!.id;
}

/** The Run `triggerId` started, observed until its worker is at work. */
async function triggerStartedRun(context: SeedContext, triggerId: string) {
  const runId = requireSuccess(await context.factory.listRunNavigation()).find(
    (run) => run.origin?.trigger.id === triggerId,
  )!.id;
  await launchedWorkers(context, runId);
  await observeFor("observe the worker", context, runId, (run) =>
    run.blocks.some((block) => block.state === "working" && block.freshness === "fresh"),
  );
  return runId;
}
