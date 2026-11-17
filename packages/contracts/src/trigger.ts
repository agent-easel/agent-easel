/** Triggers: saved rules that start Runs from outside Factory, and their operations. */
import type { FlowReadiness } from "./flow.ts";
import { operation } from "./operation.ts";
import type { ValidationIssue } from "./result.ts";

/** The closed set of Trigger kinds; a Trigger's kind is fixed when it is created. */
export type TriggerKind = "github_issues";

export interface TriggerSchedule {
  /** Off: the Trigger checks only when someone asks it to. */
  readonly enabled: boolean;
  /** 1 minute to 24 hours. */
  readonly intervalMinutes: number;
}

/** The GitHub repository a Trigger reads; the node id survives renames and transfers. */
export interface TriggerRepository {
  /** GitHub's host name, such as `github.com`. */
  readonly host: string;
  /** `owner/name` when the repository was confirmed. */
  readonly nameWithOwner: string;
  readonly nodeId: string;
}

/** An issue the latest check did not start, and why. */
export interface TriggerMissedIssue {
  /** `owner/name#number`. */
  readonly issue: string;
  readonly reason: string;
}

/** What the latest completed check did; each check replaces the previous summary. */
export interface TriggerLatestCheck {
  readonly checkedAt: string;
  readonly started: number;
  /** Matching issues left for a later check because no Run slot was free. */
  readonly waiting: number;
  readonly notStarted: readonly TriggerMissedIssue[];
}

/** A problem every check currently hits; it puts the Trigger in Error until a check succeeds. */
export interface TriggerProblem {
  readonly code: string;
  readonly message: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  /** Consecutive checks that hit it. */
  readonly count: number;
}

export interface GitHubIssuesSettings {
  readonly repository: TriggerRepository;
  /** The query as saved; Factory adds the repository, issue type and open state. */
  readonly query: string;
  /** The value of the query's single `label:` qualifier. */
  readonly readyLabel: string;
}

/** One saved Trigger. Health is derived: Error while `error` is set, none before a check. */
export interface TriggerDefinition {
  readonly id: string;
  readonly kind: "github_issues";
  readonly name: string;
  readonly enabled: boolean;
  /** A host-local Project. */
  readonly projectId: string;
  readonly flowId: string;
  readonly schedule: TriggerSchedule;
  /** 1 to 10 Runs from this Trigger that are neither Settled nor Archived. */
  readonly maxActiveRuns: number;
  /** Counts saved settings; enabling or disabling keeps it. */
  readonly revision: number;
  readonly nextCheckAt: string | null;
  readonly latestCheck: TriggerLatestCheck | null;
  readonly error: TriggerProblem | null;
  readonly github: GitHubIssuesSettings;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GitHubIssuesInput {
  /** The node id of the repository the client confirmed for the Project. */
  readonly repositoryNodeId: string;
  /** Defaults to `label:factory:ready author:@me` on create. */
  readonly query?: string;
}

/** Only these typed fields are accepted; any other key is refused. */
export interface CreateTriggerInput {
  readonly kind: TriggerKind;
  readonly name: string;
  readonly projectId: string;
  readonly flowId: string;
  /** Defaults to on, every 5 minutes. */
  readonly schedule?: TriggerSchedule;
  /** Defaults to 1. */
  readonly maxActiveRuns?: number;
  readonly github: GitHubIssuesInput;
}

/** A complete replacement of the saved settings; the kind must stay the same. */
export interface UpdateTriggerInput {
  readonly expectedRevision: number;
  readonly kind: TriggerKind;
  readonly name: string;
  readonly projectId: string;
  readonly flowId: string;
  readonly schedule: TriggerSchedule;
  readonly maxActiveRuns: number;
  readonly github: Required<GitHubIssuesInput>;
}

export interface SetTriggerEnabledInput {
  readonly enabled: boolean;
}

/** A saved Trigger and what the save should make its author aware of without refusing it. */
export interface TriggerSave {
  readonly trigger: TriggerDefinition;
  readonly warnings: readonly ValidationIssue[];
}

/** The repository Factory derived from a Project, for the client to confirm. */
export interface TriggerRepositoryChoice extends TriggerRepository {
  readonly visibility: "public" | "private";
}

/**
 * What a GitHub Issues Trigger needs before it can be saved and check. Each part names its
 * problem; `repository` and `flow` are null until a Project or Flow is chosen.
 */
export interface TriggerReadiness {
  /** `gh` is found on the Factory host and signed in, and the login `@me` resolves to. */
  readonly gitHub:
    | { readonly ready: true; readonly login: string }
    | { readonly ready: false; readonly problem: string };
  readonly repository:
    | { readonly ready: true; readonly repository: TriggerRepositoryChoice }
    | { readonly ready: false; readonly problem: string }
    | null;
  /** The same readiness New Run shows for the Flow. */
  readonly flow: FlowReadiness | null;
}

/** The Trigger operations the Factory facade implements; any approved client may call them. */
export const triggerOperations = {
  /** Query parameters may be empty: readiness then covers only what was chosen. */
  getTriggerReadiness: operation<never, TriggerReadiness>()({
    method: "GET",
    path: "/api/triggers/readiness",
    query: ["projectId", "flowId"],
  }),
  listTriggers: operation<never, readonly TriggerDefinition[]>()({
    method: "GET",
    path: "/api/triggers",
  }),
  createTrigger: operation<CreateTriggerInput, TriggerSave>()({
    method: "POST",
    path: "/api/triggers",
    body: "json",
  }),
  getTrigger: operation<never, TriggerDefinition>()({ method: "GET", path: "/api/triggers/:id" }),
  updateTrigger: operation<UpdateTriggerInput, TriggerSave>()({
    method: "PUT",
    path: "/api/triggers/:id",
    body: "json",
  }),
  setTriggerEnabled: operation<SetTriggerEnabledInput, TriggerDefinition>()({
    method: "PUT",
    path: "/api/triggers/:id/enabled",
    body: "json",
  }),
  /**
   * Checks an enabled Trigger once, whether or not its schedule is on, and answers it with the
   * check's summary. Every limit of a scheduled check applies.
   */
  runTrigger: operation<never, TriggerDefinition>()({
    method: "POST",
    path: "/api/triggers/:id/run",
  }),
  /** Deletes the Trigger and everything it keeps; Runs it started are not affected. */
  removeTrigger: operation()({ method: "DELETE", path: "/api/triggers/:id" }),
};
