import { timeAgo } from "../../time-format.ts";
import type {
  FactoryProject,
  FlowDraft,
  TriggerDefinition,
  TriggerProblem,
  TriggerSchedule,
} from "@agent-easel/contracts";

/** "every 5 min", "every 2 hours", or "manual" when only Run checks it. */
export function scheduleText(schedule: TriggerSchedule) {
  if (!schedule.enabled) return "manual";
  const minutes = schedule.intervalMinutes;
  if (minutes % 60 !== 0) return `every ${minutes} min`;
  return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
}

/** The names a Trigger refers to, as Studio and the project catalog currently know them. */
export interface TriggerNames {
  readonly projects: readonly FactoryProject[] | undefined;
  readonly flows: readonly FlowDraft[] | null;
}

/** "Acme Web → Implement issue" */
export function triggerRoute(trigger: TriggerDefinition, names: TriggerNames) {
  const project = names.projects?.find((entry) => entry.id === trigger.projectId)?.title;
  const flow = names.flows?.find((entry) => entry.id === trigger.flowId)?.name;
  return `${project ?? "Project"} → ${flow ?? "Flow"}`;
}

/** What kind of problem stops every check, for the line before its guidance. */
export function problemHeadline(problem: Pick<TriggerProblem, "code">) {
  if (problem.code.startsWith("github_")) return "GitHub can't be read";
  if (problem.code === "trigger_project") return "The Project can't be used";
  if (problem.code === "trigger_flow") return "The Flow can't start";
  if (problem.code === "start_blocked") return "Start refuses this Trigger";
  return "The check failed";
}

/** The settings a review describes, whether saved or proposed. */
export interface ReviewedSettings {
  readonly projectId: string;
  readonly flowId: string;
  readonly schedule: TriggerSchedule;
  readonly maxActiveRuns: number;
}

/** "Acme Web · acme/web · Flow Implement issue · every 5 min · max 1 active" */
export function reviewSummary(settings: ReviewedSettings, repository: string, names: TriggerNames) {
  const project = names.projects?.find((entry) => entry.id === settings.projectId)?.title;
  const flow = names.flows?.find((entry) => entry.id === settings.flowId)?.name;
  return [
    project ?? "Project",
    repository,
    flow ?? "Flow",
    scheduleText(settings.schedule),
    `max ${settings.maxActiveRuns} active`,
  ].join(" · ");
}

/** "opened 12 d ago", rounded down to minutes, hours or days. */
export function openedAgo(createdAt: string, now = Date.now()) {
  return `opened ${timeAgo(createdAt, now)}`;
}
