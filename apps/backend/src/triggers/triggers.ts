import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  FactoryOperations,
  FactoryProject,
  FlowReadiness,
  Result,
  TriggerDefinition,
  TriggerPreview,
  TriggerReadiness,
  TriggerRepository,
  TriggerSave,
  ValidationIssue,
} from "@t3-factory/contracts";
import {
  validateCreateTrigger,
  validateSetTriggerEnabled,
  validateUpdateTrigger,
  type TriggerSettings,
} from "@t3-factory/domain-validation";
import {
  gitHubRepairGuidance,
  type GitHubAdapter,
  type GitHubFailure,
  type GitHubRead,
  type GitHubRepository,
} from "../adapters/github.ts";
import type { EffectOperations } from "../effect-operations.ts";
import { isLocalEndpoint } from "../endpoint-local.ts";
import { newId } from "../ids.ts";
import type { LiveChanges } from "../live-changes.ts";
import { failure } from "../result.ts";
import { now } from "../time.ts";
import { makeTriggerCheck, type TriggerStart } from "./trigger-check.ts";
import { deadlineAfter, makeTriggerSchedule } from "./trigger-schedule.ts";
import {
  deleteTrigger,
  readTriggers,
  triggerNameTaken,
  triggersWatching,
  writeNextCheck,
  writeTriggerEnabled,
  writeTriggerSettings,
} from "./trigger-store.ts";

type TriggerOperations = Pick<
  EffectOperations<FactoryOperations>,
  | "getTriggerReadiness"
  | "listTriggers"
  | "createTrigger"
  | "getTrigger"
  | "updateTrigger"
  | "setTriggerEnabled"
  | "runTrigger"
  | "previewNewTrigger"
  | "previewTrigger"
  | "removeTrigger"
>;

/** A GitHub read that did not answer refuses the save; only the query is the author's to fix. */
function gitHubRefusal(failure: GitHubFailure): Result<never> {
  const message = gitHubRepairGuidance(failure);
  if (failure.reason === "query_rejected")
    return refusal("validation", "trigger_query_rejected", "github.query", message);
  if (failure.reason === "no_repository" || failure.reason === "unreadable")
    return refusal("validation", "trigger_repository", "projectId", message);
  return refusal("conflict", "trigger_github", "github", message);
}

const refusal = (
  code: "validation" | "conflict",
  issue: string,
  path: string,
  message: string,
): Result<never> => failure(code, message, [{ code: issue, path, message }]);

const notFound = () => failure("not_found", "This Trigger does not exist.");
const identity = ({ host, nameWithOwner, nodeId }: GitHubRepository): TriggerRepository => ({
  host,
  nameWithOwner,
  nodeId,
});

/** Why the store refuses a save: the Trigger is gone, was saved meanwhile, or the name is taken. */
function storeRefusal(
  target: { readonly expectedRevision: number } | null,
  current: TriggerDefinition | undefined,
  nameTaken: boolean,
): Result<never> | undefined {
  if (target && !current) return notFound();
  if (current && current.revision !== target?.expectedRevision)
    return refusal(
      "conflict",
      "stale_revision",
      "expectedRevision",
      "A newer Trigger revision exists. Keep your edits and reconcile before saving again.",
    );
  if (nameTaken)
    return refusal(
      "validation",
      "trigger_name_taken",
      "name",
      "Another Trigger has this name. Choose a different name.",
    );
  return undefined;
}

/**
 * The next check deadline after a save: kept while the schedule runs at the same interval, one new
 * interval from now when the schedule starts or its interval changes, none when it does not run.
 */
function savedDeadline(
  current: TriggerDefinition | undefined,
  schedule: TriggerSettings["schedule"],
  time: string,
) {
  if (!current?.enabled || !schedule.enabled) return null;
  if (current.schedule.enabled && current.schedule.intervalMinutes === schedule.intervalMinutes)
    return current.nextCheckAt;
  return deadlineAfter(time, schedule.intervalMinutes);
}

/**
 * The deadline after enabling or disabling. Enabling starts the schedule one interval from now; a
 * first check right away is an explicit Run.
 */
const enabledDeadline = (current: TriggerDefinition, enabled: boolean, time: string) => {
  if (!enabled || !current.schedule.enabled) return null;
  return current.enabled
    ? current.nextCheckAt
    : deadlineAfter(time, current.schedule.intervalMinutes);
};

/** Whether `settings` are exactly `saved`'s, so a preview of them reviewed that revision. */
const previewsSaved = (saved: TriggerDefinition, settings: TriggerSettings) =>
  settings.name === saved.name &&
  settings.projectId === saved.projectId &&
  settings.flowId === saved.flowId &&
  settings.schedule.enabled === saved.schedule.enabled &&
  settings.schedule.intervalMinutes === saved.schedule.intervalMinutes &&
  settings.maxActiveRuns === saved.maxActiveRuns &&
  settings.github.repositoryNodeId === saved.github.repository.nodeId &&
  settings.github.query === saved.github.query;

/** The next saved state: new settings, with enablement and health kept. */
function savedTrigger(
  settings: TriggerSettings,
  repository: TriggerRepository,
  current: TriggerDefinition | undefined,
  id: string,
  time: string,
): TriggerDefinition {
  return {
    id,
    kind: settings.kind,
    name: settings.name,
    enabled: current?.enabled ?? false,
    projectId: settings.projectId,
    flowId: settings.flowId,
    schedule: settings.schedule,
    maxActiveRuns: settings.maxActiveRuns,
    revision: (current?.revision ?? 0) + 1,
    nextCheckAt: savedDeadline(current, settings.schedule, time),
    latestCheck: current?.latestCheck ?? null,
    error: current?.error ?? null,
    github: {
      repository,
      query: settings.github.query,
      readyLabel: settings.github.readyLabel,
    },
    createdAt: current?.createdAt ?? time,
    updatedAt: time,
  };
}

/** Anyone who can get the ready label onto an issue of a public repository could start Runs. */
const authorFilterWarnings = (
  repository: GitHubRepository,
  authorFilter: boolean,
): ValidationIssue[] =>
  repository.visibility === "public" && !authorFilter
    ? [
        {
          code: "trigger_author_filter_removed",
          path: "github.query",
          message: `${repository.nameWithOwner} is public and the query has no author: filter, so an issue anyone opens can start a Run once it carries the ready label.`,
        },
      ]
    : [];

const sharedRepositoryWarning = (name: string, trigger: TriggerDefinition): ValidationIssue => ({
  code: "trigger_repository_shared",
  path: "projectId",
  message: `Trigger ${name} already watches ${trigger.github.repository.nameWithOwner}. Each Trigger starts its own Runs for the issues it matches.`,
});

/** A Project refusal or GitHub's answer for the Project's folder. */
function repositoryReadiness(
  repository: GitHubRead<GitHubRepository> | Result<never>,
): TriggerReadiness["repository"] {
  if (repository.ok) return { ready: true, repository: repository.value };
  return {
    ready: false,
    problem:
      "failure" in repository ? gitHubRepairGuidance(repository.failure) : repository.error.message,
  };
}

const missingFlowReadiness: FlowReadiness = {
  ready: false,
  issues: [{ code: "trigger_flow", path: "flowId", message: "Choose a saved Flow." }],
};

/** What GitHub settled for a save: the repository to store and the warnings it raises. */
interface GitHubSettlement {
  readonly repository: TriggerRepository;
  readonly warnings: readonly ValidationIssue[];
  /** The save points the Trigger at a repository it did not read before. */
  readonly newRepository: boolean;
}

export const makeTriggers = (
  github: GitHubAdapter,
  deps: Pick<EffectOperations<FactoryOperations>, "listProjects" | "getFlow"> & {
    readonly startTextRun: TriggerStart;
  },
  changes: LiveChanges,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const readTrigger = (id: string) =>
      readTriggers(sql, id).pipe(Effect.map(([trigger]) => trigger));

    /** Triggers read GitHub with the host's own `gh`, so their Project must be on this host. */
    const hostLocalProject = (projectId: string) =>
      Effect.gen(function* (): Effect.fn.Return<Result<FactoryProject>, unknown> {
        const catalog = yield* deps.listProjects();
        const project = catalog.ok
          ? catalog.value.projects.find((entry) => entry.id === projectId)
          : undefined;
        if (!project)
          return refusal("validation", "trigger_project", "projectId", "Choose a saved Project.");
        if (!isLocalEndpoint(project.endpoint))
          return refusal(
            "validation",
            "trigger_project_remote",
            "projectId",
            `${project.title} is on a remote T3 environment. Triggers read GitHub with the Factory host's gh login, so choose a Project on this computer.`,
          );
        return { ok: true, value: project };
      });

    /**
     * Reads the Project's repository and checks the query against it when the Project, query or
     * confirmed repository changes; other edits keep the repository the Trigger already reads
     * without calling GitHub. A confirmed repository is accepted only while it is the one the
     * Project's folder names now, which is how a Trigger is pointed at a Project's moved remote.
     */
    const settleGitHub = (
      settings: TriggerSettings,
      project: FactoryProject,
      saved: TriggerDefinition | undefined,
    ) =>
      Effect.gen(function* (): Effect.fn.Return<Result<GitHubSettlement>, unknown> {
        const confirmed = settings.github.repositoryNodeId;
        const newRepository =
          saved?.projectId !== settings.projectId || saved.github.repository.nodeId !== confirmed;
        if (!newRepository && saved.github.query === settings.github.query)
          return {
            ok: true,
            value: { repository: saved.github.repository, warnings: [], newRepository },
          };
        const repository = yield* Effect.promise(() => github.repository(project.workspaceRoot));
        if (!repository.ok) return gitHubRefusal(repository.failure);
        if (repository.value.nodeId !== confirmed)
          return refusal(
            "conflict",
            "trigger_repository_mismatch",
            "github.repositoryNodeId",
            `${project.title}'s repository is now ${repository.value.nameWithOwner}. Confirm it again before saving.`,
          );
        const matching = yield* Effect.promise(() =>
          github.openIssues(repository.value, settings.github.query),
        );
        if (!matching.ok) return gitHubRefusal(matching.failure);
        return {
          ok: true,
          value: {
            repository: identity(repository.value),
            newRepository,
            warnings: authorFilterWarnings(repository.value, settings.github.authorFilter),
          },
        };
      });

    /** Validates everything outside the store, then writes in one transaction against `id`'s revision. */
    const save = (
      settings: TriggerSettings,
      target: { readonly id: string; readonly expectedRevision: number } | null,
    ) =>
      Effect.gen(function* (): Effect.fn.Return<Result<TriggerSave>, unknown> {
        const saved = target ? yield* readTrigger(target.id) : undefined;
        if (target && !saved) return notFound();
        const project = yield* hostLocalProject(settings.projectId);
        if (!project.ok) return project;
        const flow = yield* deps.getFlow(settings.flowId);
        if (!flow.ok)
          return refusal("validation", "trigger_flow", "flowId", "Choose a saved Flow.");
        const settled = yield* settleGitHub(settings, project.value, saved);
        if (!settled.ok) return settled;
        return yield* sql.withTransaction(
          Effect.gen(function* (): Effect.fn.Return<Result<TriggerSave>, unknown> {
            const current = target ? yield* readTrigger(target.id) : undefined;
            const refused = storeRefusal(
              target,
              current,
              yield* triggerNameTaken(sql, settings.name, current?.id ?? null),
            );
            if (refused) return refused;
            const trigger = savedTrigger(
              settings,
              settled.value.repository,
              current,
              current?.id ?? (yield* newId),
              yield* now,
            );
            yield* writeTriggerSettings(sql, trigger, current === undefined);
            const watching = settled.value.newRepository
              ? yield* triggersWatching(sql, trigger.github.repository.nodeId, trigger.id)
              : [];
            return {
              ok: true,
              value: {
                trigger,
                warnings: [
                  ...settled.value.warnings,
                  ...watching.map((name) => sharedRepositoryWarning(name, trigger)),
                ],
              },
            };
          }),
        );
      });

    const readiness = (projectId: string, flowId: string) =>
      Effect.gen(function* (): Effect.fn.Return<Result<TriggerReadiness>, unknown> {
        const project = projectId ? yield* hostLocalProject(projectId) : null;
        const repository =
          project &&
          (project.ok
            ? yield* Effect.promise(() => github.repository(project.value.workspaceRoot))
            : project);
        const login = yield* Effect.promise(() =>
          github.readiness(repository?.ok ? repository.value.host : "github.com"),
        );
        const flow = flowId ? yield* deps.getFlow(flowId) : null;
        return {
          ok: true,
          value: {
            gitHub: login.ok
              ? { ready: true, login: login.value.login }
              : { ready: false, problem: gitHubRepairGuidance(login.failure) },
            repository: repository && repositoryReadiness(repository),
            flow: flow && (flow.ok ? flow.value.readiness : missingFlowReadiness),
          },
        };
      });

    /** Publishes after the write committed; a refused write changed nothing. */
    const published = <A>(write: Effect.Effect<Result<A>, unknown>) =>
      write.pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result.ok) changes.triggersChanged();
          }),
        ),
      );

    const triggerCheck = makeTriggerCheck({
      sql,
      github,
      getFlow: deps.getFlow,
      hostLocalProject,
      readTrigger,
      startTextRun: deps.startTextRun,
    });
    const { check, forget } = triggerCheck;

    /**
     * A check's reads and admission rules for `settings`, on the saved Trigger `target` when given;
     * nothing starts and nothing is written.
     */
    const preview = (
      settings: TriggerSettings,
      target: { readonly id: string; readonly expectedRevision: number } | null,
    ) =>
      Effect.gen(function* (): Effect.fn.Return<Result<TriggerPreview>, unknown> {
        const saved = target ? yield* sql.withTransaction(readTrigger(target.id)) : undefined;
        const refused = storeRefusal(target, saved, false);
        if (refused) return refused;
        const { repositoryNodeId, query, readyLabel, authorFilter } = settings.github;
        const planned = yield* triggerCheck.preview({
          id: target?.id ?? null,
          projectId: settings.projectId,
          flowId: settings.flowId,
          maxActiveRuns: settings.maxActiveRuns,
          github: { repository: { nodeId: repositoryNodeId }, query, readyLabel },
        });
        const repository = planned.repository;
        const login = repository
          ? yield* Effect.promise(() => github.readiness(repository.host))
          : null;
        return {
          ok: true,
          value: {
            issues: planned.issues,
            problem: planned.problem,
            warnings: repository ? authorFilterWarnings(repository, authorFilter) : [],
            login: login?.ok ? login.value.login : null,
            revision: saved && previewsSaved(saved, settings) ? saved.revision : null,
          },
        };
      });

    /**
     * A scheduled check, then the deadline one interval after it completed, in one step. A check
     * that failed still sets the next deadline, so one failure does not end the schedule.
     */
    const checkOnSchedule = (id: string) =>
      Effect.exit(check(id)).pipe(
        Effect.andThen(
          sql.withTransaction(
            Effect.gen(function* () {
              const trigger = yield* readTrigger(id);
              if (!trigger?.enabled || !trigger.schedule.enabled) return trigger;
              const nextCheckAt = deadlineAfter(yield* now, trigger.schedule.intervalMinutes);
              yield* writeNextCheck(sql, id, nextCheckAt);
              return { ...trigger, nextCheckAt };
            }),
          ),
        ),
        Effect.tap(() => Effect.sync(() => changes.triggersChanged())),
        Effect.uninterruptible,
      );
    const schedule = yield* makeTriggerSchedule({ readTrigger, checkOnSchedule });

    const operations: TriggerOperations = {
      getTriggerReadiness: readiness,
      listTriggers: () =>
        sql
          .withTransaction(readTriggers(sql))
          .pipe(Effect.map((value) => ({ ok: true as const, value }))),
      getTrigger: (id) =>
        sql
          .withTransaction(readTrigger(id))
          .pipe(
            Effect.map((trigger) => (trigger ? { ok: true as const, value: trigger } : notFound())),
          ),
      createTrigger(input) {
        const validated = validateCreateTrigger(input);
        return validated.ok ? published(save(validated.value, null)) : Effect.succeed(validated);
      },
      updateTrigger(id, input) {
        const validated = validateUpdateTrigger(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { expectedRevision, ...settings } = validated.value;
        return published(save(settings, { id, expectedRevision })).pipe(
          Effect.tap((result) =>
            result.ok ? schedule.follow(id, result.value.trigger) : Effect.void,
          ),
        );
      },
      setTriggerEnabled(id, input) {
        const validated = validateSetTriggerEnabled(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { enabled } = validated.value;
        return published(
          sql.withTransaction(
            Effect.gen(function* (): Effect.fn.Return<Result<TriggerDefinition>, unknown> {
              const current = yield* readTrigger(id);
              if (!current) return notFound();
              if (validated.value.enabled && current.revision !== validated.value.reviewedRevision)
                return refusal(
                  "conflict",
                  "trigger_changed",
                  "reviewedRevision",
                  `Revision ${current.revision} of this Trigger was saved after the reviewed one, so it was not enabled. Review its current settings before enabling it.`,
                );
              const time = yield* now;
              const nextCheckAt = enabledDeadline(current, enabled, time);
              yield* writeTriggerEnabled(sql, id, enabled, nextCheckAt, time);
              return { ok: true, value: (yield* readTrigger(id))! };
            }),
          ),
        ).pipe(
          Effect.tap((result) => (result.ok ? schedule.follow(id, result.value) : Effect.void)),
        );
      },
      runTrigger: (id) => published(check(id)),
      previewNewTrigger(input) {
        const validated = validateCreateTrigger(input);
        return validated.ok ? preview(validated.value, null) : Effect.succeed(validated);
      },
      previewTrigger(id, input) {
        const validated = validateUpdateTrigger(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { expectedRevision, ...settings } = validated.value;
        return preview(settings, { id, expectedRevision });
      },
      // The delete cascades to the guards. A guard only holds an unresolved attempt while its check
      // runs, and that attempt resolves inside Start's acceptance transaction, which refuses once
      // the Trigger and guard are gone; an attempt Start accepted first keeps its Run and origin.
      removeTrigger: (id) =>
        published(
          deleteTrigger(sql, id).pipe(
            Effect.andThen(schedule.follow(id, undefined)),
            Effect.andThen(forget(id)),
            Effect.as({ ok: true as const, value: undefined }),
          ),
        ),
    };
    /** Studio's Trigger list, read inside the caller's Studio transaction. */
    const readStudioTriggers = () => readTriggers(sql);
    /** Starts scheduled checks once Start can accept Runs; they stop before the Runner closes. */
    const startSchedule = readTriggers(sql).pipe(Effect.flatMap(schedule.start));
    return { ...operations, readStudioTriggers, startSchedule };
  });
