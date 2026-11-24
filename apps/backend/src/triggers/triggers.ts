import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  FactoryOperations,
  FactoryProject,
  FlowDraft,
  FlowReadiness,
  Result,
  TriggerDefinition,
  TriggerPreview,
  TriggerReadiness,
  TriggerRepository,
  TriggerSave,
  ValidationIssue,
} from "@agent-easel/contracts";
import {
  mayStartFlow,
  validateCreateTrigger,
  validatePreviewNewTrigger,
  validatePreviewTrigger,
  validateRunTrigger,
  validateSetTriggerEnabled,
  validateUpdateTrigger,
  type TriggerPreviewSettings,
  type TriggerSettings,
  type TriggerUpdateSettings,
} from "@agent-easel/domain-validation";
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
import type { Telemetry } from "../telemetry.ts";
import type { LiveChanges } from "../live-changes.ts";
import { failure } from "../result.ts";
import { now } from "../time.ts";
import { makeTriggerCheck, type TriggerCheckDeps } from "./trigger-check.ts";
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

const previewsSaved = (
  saved: TriggerDefinition,
  settings: TriggerPreviewSettings,
  nodeId: string | null,
) =>
  settings.name === saved.name &&
  settings.projectId === saved.projectId &&
  settings.flowId === saved.flowId &&
  settings.schedule.enabled === saved.schedule.enabled &&
  settings.schedule.intervalMinutes === saved.schedule.intervalMinutes &&
  settings.maxActiveRuns === saved.maxActiveRuns &&
  nodeId === saved.github.repository.nodeId &&
  settings.github.query === saved.github.query;

/** The next saved state: new settings, with enablement and health kept. */
function savedTrigger(
  settings: TriggerUpdateSettings,
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

type Watcher = { readonly name: string; readonly nameWithOwner: string };

function sharedRepositoryPreviewWarnings(
  watching: readonly Watcher[],
  nameWithOwner?: string,
): ValidationIssue[] {
  const [first] = watching;
  if (!first) return [];
  const names = watching.map((watcher) => watcher.name);
  return [
    {
      code: "trigger_repository_shared",
      path: "projectId",
      message: `${names.length === 1 ? "Trigger" : "Triggers"} ${names.join(", ")} already ${names.length === 1 ? "watches" : "watch"} ${nameWithOwner ?? first.nameWithOwner}. Each Trigger starts its own Runs for the issues it matches.`,
    },
  ];
}

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

const otherProjectFlow =
  "This Flow belongs to another Project. Choose a global Flow or a Flow of the Trigger's Project.";

/** The Flow's readiness, which a Flow of another Project than the chosen one never has. */
function flowReadiness(flow: Result<FlowDraft>, projectId: string): FlowReadiness {
  if (!flow.ok) return missingFlowReadiness;
  if (projectId && !mayStartFlow(flow.value.projectId, projectId))
    return {
      ready: false,
      issues: [{ code: "flow_project_mismatch", path: "flowId", message: otherProjectFlow }],
    };
  return flow.value.readiness;
}

/** What GitHub settled for a save: the repository to store and the warnings it raises. */
interface GitHubSettlement {
  readonly repository: TriggerRepository;
  readonly warnings: readonly ValidationIssue[];
  /** The save points the Trigger at a repository it did not read before. */
  readonly newRepository: boolean;
}

export const makeTriggers = (
  github: GitHubAdapter,
  deps: Pick<EffectOperations<FactoryOperations>, "listProjects" | "getFlow"> &
    Pick<TriggerCheckDeps, "startTextRun" | "startBlockers">,
  changes: LiveChanges,
  telemetry: Telemetry,
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
        if (
          project.availability === "project-unavailable" ||
          project.availability === "different-environment"
        )
          return refusal(
            "validation",
            "trigger_project_unavailable",
            "projectId",
            `${project.title} is no longer in T3. Choose a Project that is still in T3.`,
          );
        if (!isLocalEndpoint(project.endpoint))
          return refusal(
            "validation",
            "trigger_project_remote",
            "projectId",
            `${project.title} is on a remote T3 environment. Triggers read GitHub with the Factory host's gh login, so choose a Project on this computer.`,
          );
        return { ok: true, value: project };
      });

    const settleGitHub = (
      settings: TriggerUpdateSettings,
      project: FactoryProject,
      saved: TriggerDefinition | undefined,
    ) =>
      Effect.gen(function* (): Effect.fn.Return<Result<GitHubSettlement>, unknown> {
        const named = settings.github.repositoryNodeId;
        if (
          named === null &&
          saved?.projectId === settings.projectId &&
          saved.github.query === settings.github.query
        )
          return {
            ok: true,
            value: { repository: saved.github.repository, warnings: [], newRepository: false },
          };
        const confirmed = named ?? saved?.github.repository.nodeId;
        const newRepository =
          saved?.projectId !== settings.projectId || saved.github.repository.nodeId !== confirmed;
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
      settings: TriggerUpdateSettings,
      target: { readonly id: string; readonly expectedRevision: number } | null,
    ) =>
      Effect.gen(function* (): Effect.fn.Return<Result<TriggerSave>, unknown> {
        const saved = target ? yield* readTrigger(target.id) : undefined;
        const stale = storeRefusal(target, saved, false);
        if (stale) return stale;
        const project = yield* hostLocalProject(settings.projectId);
        if (!project.ok) return project;
        const flow = yield* deps.getFlow(settings.flowId);
        if (!flow.ok)
          return refusal("validation", "trigger_flow", "flowId", "Choose a saved Flow.");
        if (!mayStartFlow(flow.value.projectId, settings.projectId))
          return refusal("validation", "flow_project_mismatch", "flowId", otherProjectFlow);
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
                  ...watching.map(({ name }) => sharedRepositoryWarning(name, trigger)),
                ],
              },
            };
          }),
        );
      });

    const repositoryWarnings = (detected: GitHubRepository | null, triggerId: string) =>
      Effect.gen(function* () {
        const edited = triggerId ? yield* readTrigger(triggerId) : undefined;
        const confirmed = edited?.github.repository;
        const repositories: TriggerRepository[] = detected ? [detected] : [];
        if (confirmed && confirmed.nodeId !== detected?.nodeId) repositories.push(confirmed);
        return yield* Effect.forEach(repositories, (repository) =>
          triggersWatching(sql, repository.nodeId, triggerId || null).pipe(
            Effect.map((watching) => ({
              nodeId: repository.nodeId,
              warnings: sharedRepositoryPreviewWarnings(watching, repository.nameWithOwner),
            })),
          ),
        );
      });

    const readiness = (projectId: string, flowId: string, triggerId: string) =>
      Effect.gen(function* (): Effect.fn.Return<Result<TriggerReadiness>, unknown> {
        const project = projectId ? yield* hostLocalProject(projectId) : null;
        const repository =
          project &&
          (project.ok
            ? yield* Effect.promise(() => github.repository(project.value.workspaceRoot))
            : project);
        const detected = repository?.ok ? repository.value : null;
        const warnings = yield* sql.withTransaction(repositoryWarnings(detected, triggerId));
        const login = yield* Effect.promise(() => github.readiness(detected?.host ?? "github.com"));
        const flow = flowId ? yield* deps.getFlow(flowId) : null;
        return {
          ok: true,
          value: {
            gitHub: login.ok
              ? { ready: true, login: login.value.login }
              : { ready: false, problem: gitHubRepairGuidance(login.failure) },
            repository: repository && repositoryReadiness(repository),
            repositoryWarnings: warnings,
            flow: flow && flowReadiness(flow, projectId),
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

    const saved = (write: Effect.Effect<Result<TriggerSave>, unknown>) =>
      published(write).pipe(
        Effect.tap((result) =>
          result.ok
            ? telemetry.record("trigger.saved", { kind: result.value.trigger.kind })
            : Effect.void,
        ),
      );

    const triggerCheck = makeTriggerCheck({
      telemetry,
      sql,
      github,
      getFlow: deps.getFlow,
      hostLocalProject,
      readTrigger,
      startTextRun: deps.startTextRun,
      startBlockers: deps.startBlockers,
    });
    const { check } = triggerCheck;

    const preview = (
      settings: TriggerPreviewSettings,
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
        const detected = planned.repository;
        const nodeId = repositoryNodeId ?? detected?.nodeId ?? null;
        const evaluated = detected?.nodeId === nodeId ? detected : null;
        const login = detected
          ? yield* Effect.promise(() => github.readiness(detected.host))
          : null;
        const watching = nodeId ? yield* triggersWatching(sql, nodeId, target?.id ?? null) : [];
        return {
          ok: true,
          value: {
            issues: planned.issues,
            problem: planned.problem,
            warnings: [
              ...(evaluated ? authorFilterWarnings(evaluated, authorFilter) : []),
              ...sharedRepositoryPreviewWarnings(watching, evaluated?.nameWithOwner),
            ],
            login: login?.ok ? login.value.login : null,
            revision: saved && previewsSaved(saved, settings, nodeId) ? saved.revision : null,
            repository: evaluated,
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
        return validated.ok ? saved(save(validated.value, null)) : Effect.succeed(validated);
      },
      updateTrigger(id, input) {
        const validated = validateUpdateTrigger(input);
        if (!validated.ok) return Effect.succeed(validated);
        const { expectedRevision, ...settings } = validated.value;
        return saved(save(settings, { id, expectedRevision })).pipe(
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
              // Turning a Trigger on advances its revision, so an edit begun while it was off, which
              // needed no review then, is refused as stale instead of widening the enabled Trigger.
              const revision =
                enabled && !current.enabled ? current.revision + 1 : current.revision;
              yield* writeTriggerEnabled(sql, id, {
                enabled,
                revision,
                nextCheckAt: enabledDeadline(current, enabled, time),
                updatedAt: time,
              });
              return { ok: true, value: (yield* readTrigger(id))! };
            }),
          ),
        ).pipe(
          Effect.tap((result) => (result.ok ? schedule.follow(id, result.value) : Effect.void)),
        );
      },
      runTrigger(id, input) {
        const validated = validateRunTrigger(input);
        return validated.ok
          ? published(check(id, validated.value.expectedRevision))
          : Effect.succeed(validated);
      },
      previewNewTrigger(input) {
        const validated = validatePreviewNewTrigger(input);
        return validated.ok ? preview(validated.value, null) : Effect.succeed(validated);
      },
      previewTrigger(id, input) {
        const validated = validatePreviewTrigger(input);
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
