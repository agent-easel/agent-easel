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

/** A problem every check currently hits; it stops checks until one succeeds. */
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

/** One saved Trigger. A problem stops checks while `error` is set; none before a check. */
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
  /**
   * Each settings save and each off-to-on enable advances it. Disabling, enabling an already
   * enabled Trigger, and checks keep it.
   */
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

/** A preview's GitHub settings; without a repository it evaluates the one the Project's folder names now. */
type PreviewGitHubInput = Omit<GitHubIssuesInput, "repositoryNodeId"> &
  Partial<Pick<GitHubIssuesInput, "repositoryNodeId">>;

/** The settings of a new Trigger to preview, as a create takes them; the repository may be left out. */
export interface PreviewNewTriggerInput extends Omit<CreateTriggerInput, "github"> {
  readonly github: PreviewGitHubInput;
}

/** A saved Trigger's settings to preview, as a save takes them; the repository may be left out. */
export interface PreviewTriggerInput extends Omit<UpdateTriggerInput, "github"> {
  readonly github: Required<Omit<GitHubIssuesInput, "repositoryNodeId">> & PreviewGitHubInput;
}

/** What a manual check may carry. */
export interface RunTriggerInput {
  /** Checks only this revision: a Trigger saved or enabled since is refused and starts nothing. */
  readonly expectedRevision?: number;
}

/**
 * Disabling is unconditional. Enabling confirms the saved revision whose settings a preview
 * showed, and is refused once another revision was saved.
 */
export type SetTriggerEnabledInput =
  | { readonly enabled: true; readonly reviewedRevision: number }
  | { readonly enabled: false };

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
  /**
   * What the editor shows before any preview for each repository it may save: the one the
   * Project's folder names and the edited Trigger's confirmed one. Each carries the warning a
   * preview carries when another saved Trigger watches that repository.
   */
  readonly repositoryWarnings: readonly {
    readonly nodeId: string;
    readonly warnings: readonly ValidationIssue[];
  }[];
  /** The same readiness New Run shows for the Flow. */
  readonly flow: FlowReadiness | null;
}

/** Whether a previewed issue would start at once or wait for a free Run slot. */
export type TriggerPreviewAdmission = "starts_now" | "waits";

/** A matching issue a check would admit, as the preview lists it. */
export interface TriggerPreviewIssue {
  /** `owner/name#number`. */
  readonly issue: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly createdAt: string;
  readonly admission: TriggerPreviewAdmission;
}

/**
 * What a check with these settings would do now, from the same reads and admission rules, without
 * starting anything or changing the Trigger.
 */
export interface TriggerPreview {
  /** Oldest first. Issues already started for their current ready labelling are left out. */
  readonly issues: readonly TriggerPreviewIssue[];
  /** A problem that would stop the check before any issue starts. */
  readonly problem: { readonly code: string; readonly message: string } | null;
  /** Such as the author filter missing on a public repository. */
  readonly warnings: readonly ValidationIssue[];
  /** The login `@me` resolves to, when GitHub answered. */
  readonly login: string | null;
  /**
   * The saved revision whose settings were previewed, which enabling confirms; null for a new
   * Trigger or an unsaved edit.
   */
  readonly revision: number | null;
  /**
   * The repository the Project's folder names now, as GitHub answered, which a preview without a
   * repository evaluated; null when GitHub could not be read.
   */
  readonly repository: TriggerRepositoryChoice | null;
}

/** A Run this check started, so the list can open it without storing the check. */
export interface TriggerStartedRun {
  readonly id: string;
  /** The Run's number once Factory has assigned one. */
  readonly number: number | null;
  readonly title: string;
}

/**
 * The Trigger revision a check ran, with the latest check and problem that check recorded and the
 * Runs it started. A save or removal while the check ran does not change it.
 */
export interface TriggerCheckReply extends TriggerDefinition {
  readonly startedRuns: readonly TriggerStartedRun[];
}

/** The Trigger operations the Factory facade implements; any approved client may call them. */
export const triggerOperations = {
  /**
   * Query parameters may be empty: readiness then covers only what was chosen. `triggerId` names
   * the saved Trigger being edited, which the shared-repository warning leaves out.
   */
  getTriggerReadiness: operation<never, TriggerReadiness>()({
    method: "GET",
    path: "/api/triggers/readiness",
    query: ["projectId", "flowId", "triggerId"],
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
   * check's summary and the Runs it started. Every limit of a scheduled check applies. Those Runs
   * are not stored on the Trigger. The body may name the revision to check, which is refused as
   * stale when another is saved; a request without a body checks whatever is saved.
   */
  runTrigger: operation<RunTriggerInput, TriggerCheckReply>()({
    method: "POST",
    path: "/api/triggers/:id/run",
    body: "json",
  }),
  /** Previews the settings a new Trigger would be created with. */
  previewNewTrigger: operation<PreviewNewTriggerInput, TriggerPreview>()({
    method: "POST",
    path: "/api/triggers/preview",
    body: "json",
  }),
  /**
   * Previews a saved Trigger with the given settings, its current ones or an edit from its
   * current revision, counting its guards and active Runs.
   */
  previewTrigger: operation<PreviewTriggerInput, TriggerPreview>()({
    method: "POST",
    path: "/api/triggers/:id/preview",
    body: "json",
  }),
  /** Deletes the Trigger and everything it keeps; Runs it started are not affected. */
  removeTrigger: operation()({ method: "DELETE", path: "/api/triggers/:id" }),
};
