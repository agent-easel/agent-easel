import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type {
  FactoryOperations,
  FactoryProject,
  FlowReadiness,
  Result,
  TriggerDefinition,
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
import {
  deleteTrigger,
  readTriggers,
  triggerNameTaken,
  triggersWatching,
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

/** The next saved state: new settings, with enablement, schedule state and health kept. */
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
    nextCheckAt: current?.nextCheckAt ?? null,
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
     * Reads the Project's repository and checks the query against it when either changes; other
     * edits keep the repository the Trigger already reads without calling GitHub.
     */
    const settleGitHub = (
      settings: TriggerSettings,
      project: FactoryProject,
      saved: TriggerDefinition | undefined,
    ) =>
      Effect.gen(function* (): Effect.fn.Return<Result<GitHubSettlement>, unknown> {
        const confirmed = settings.github.repositoryNodeId;
        const newRepository = saved?.projectId !== settings.projectId;
        if (!newRepository && saved.github.query === settings.github.query) {
          if (confirmed !== saved.github.repository.nodeId)
            return refusal(
              "conflict",
              "trigger_repository_mismatch",
              "github.repositoryNodeId",
              `This Trigger reads ${saved.github.repository.nameWithOwner}. Confirm that repository before saving.`,
            );
          return {
            ok: true,
            value: { repository: saved.github.repository, warnings: [], newRepository },
          };
        }
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
        const unfiltered =
          repository.value.visibility === "public" && !settings.github.authorFilter;
        return {
          ok: true,
          value: {
            repository: identity(repository.value),
            newRepository,
            warnings: unfiltered
              ? [
                  {
                    code: "trigger_author_filter_removed",
                    path: "github.query",
                    message: `${repository.value.nameWithOwner} is public and the query has no author: filter, so an issue anyone opens can start a Run once it carries the ready label.`,
                  },
                ]
              : [],
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

    const { check } = makeTriggerCheck({
      sql,
      github,
      getFlow: deps.getFlow,
      hostLocalProject,
      readTrigger,
      startTextRun: deps.startTextRun,
    });

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
        return published(save(settings, { id, expectedRevision }));
      },
      setTriggerEnabled(id, input) {
        const validated = validateSetTriggerEnabled(input);
        if (!validated.ok) return Effect.succeed(validated);
        return published(
          sql.withTransaction(
            Effect.gen(function* (): Effect.fn.Return<Result<TriggerDefinition>, unknown> {
              if (!(yield* readTrigger(id))) return notFound();
              yield* writeTriggerEnabled(sql, id, validated.value.enabled, yield* now);
              return { ok: true, value: (yield* readTrigger(id))! };
            }),
          ),
        );
      },
      runTrigger: (id) => published(check(id)),
      removeTrigger: (id) =>
        published(deleteTrigger(sql, id).pipe(Effect.as({ ok: true as const, value: undefined }))),
    };
    /** Studio's Trigger list, read inside the caller's Studio transaction. */
    const readStudioTriggers = () => readTriggers(sql);
    return { ...operations, readStudioTriggers };
  });
