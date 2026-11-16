/** A GitHub repository as the host user's `gh` login reads it. */
export interface GitHubRepository {
  /** GitHub's host name, such as `github.com`. */
  readonly host: string;
  /** `owner/name`, which changes on rename or transfer. */
  readonly nameWithOwner: string;
  /** GitHub's node id, which survives renames and transfers. */
  readonly nodeId: string;
  /** GitHub's `internal` reads as private: only signed-in members can see it. */
  readonly visibility: "public" | "private";
}

/** The repository a read is bound to; visibility is not part of its identity. */
export type GitHubRepositoryIdentity = Pick<GitHubRepository, "host" | "nameWithOwner" | "nodeId">;

export interface GitHubIssue {
  /** GitHub's node id, the issue's stable identity. */
  readonly nodeId: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** ISO 8601 creation time. */
  readonly createdAt: string;
  readonly labels: readonly string[];
}

/** One `labeled` event; its id and time stay the same each time it is read. */
export interface GitHubLabelling {
  readonly eventId: string;
  /** ISO 8601 time the label was added. */
  readonly createdAt: string;
}

export interface GitHubLabelState {
  /** Whether the issue carries the label now. */
  readonly labelled: boolean;
  /** The latest `labeled` event for the label, or null when GitHub records none. */
  readonly latestLabelling: GitHubLabelling | null;
}

/**
 * Why a GitHub read did not answer. Every read is complete or fails: a timeout, truncated output,
 * a non-zero exit or invalid JSON never reads as an empty answer. Messages are GitHub's or `gh`'s
 * bounded text, never a credential.
 */
export type GitHubFailure =
  /** `gh` was not found on the inherited PATH or in the fallback directories. */
  | { readonly reason: "gh_missing" }
  /** `gh` has no login for the host. */
  | { readonly reason: "signed_out"; readonly host: string }
  /** The folder has no remote that `gh` resolves to a GitHub repository. */
  | { readonly reason: "no_repository"; readonly message: string }
  /** The repository does not exist or the signed-in login cannot read it. */
  | { readonly reason: "unreadable"; readonly message: string }
  /** The bound `owner/name` now names a repository with a different node id. */
  | { readonly reason: "repository_mismatch"; readonly nameWithOwner: string }
  /** GitHub rejected the issue query. */
  | { readonly reason: "query_rejected"; readonly message: string }
  | { readonly reason: "timeout" }
  /** The answer exceeded the output bound. */
  | { readonly reason: "truncated" }
  /** A non-zero exit, invalid JSON or an unreachable GitHub. */
  | { readonly reason: "failed"; readonly message: string };

export type GitHubRead<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly failure: GitHubFailure };

export const gitHubAnswer = <A>(value: A): GitHubRead<A> => ({ ok: true, value });
export const gitHubRefusal = (failure: GitHubFailure): GitHubRead<never> => ({
  ok: false,
  failure,
});

/** GitHub reads through the Factory host user's own `gh` login; Factory never writes to GitHub. */
export interface GitHubAdapter {
  /** `gh` is found and signed in to `host`; answers the login `@me` resolves to there. */
  readiness(host: string): Promise<GitHubRead<{ readonly login: string }>>;
  /** The repository a Project folder's remote names; answering proves the login can read it. */
  repository(workspaceRoot: string): Promise<GitHubRead<GitHubRepository>>;
  /**
   * Every open issue (never a pull request) in the repository that matches the user's `query`.
   * The adapter adds the repository, issue type and open state; GitHub's order is kept.
   */
  openIssues(
    repository: GitHubRepositoryIdentity,
    query: string,
  ): Promise<GitHubRead<readonly GitHubIssue[]>>;
  /**
   * `label`'s current state on each given issue, keyed by node id. An issue missing from the
   * answer no longer exists in the repository.
   */
  labelStates(
    repository: GitHubRepositoryIdentity,
    issueNodeIds: readonly string[],
    label: string,
  ): Promise<GitHubRead<ReadonlyMap<string, GitHubLabelState>>>;
}

/**
 * What the person must do about a failure, naming the steps that only work on the Factory host,
 * so a remote client knows where to act.
 */
export function gitHubRepairGuidance(failure: GitHubFailure): string {
  switch (failure.reason) {
    case "gh_missing":
      return "Install GitHub CLI (gh) on the Factory host. Factory looks for it on its PATH, then in /opt/homebrew/bin and /usr/local/bin; restart a Factory opened from Finder after installing.";
    case "signed_out":
      return `On the Factory host, run gh auth login --hostname ${failure.host} as the user Factory runs as.`;
    case "no_repository":
      return "Add a GitHub remote to the Project's repository on the Factory host.";
    case "unreadable":
      return "Check that the repository exists and that the gh login on the Factory host can read it; run gh auth login on the host to switch accounts.";
    case "repository_mismatch":
      return `${failure.nameWithOwner} now names a different repository than the one confirmed. Confirm the repository again.`;
    case "query_rejected":
      return "Change the issue query so GitHub accepts it.";
    case "truncated":
      return "Narrow the issue query so GitHub's answer fits.";
    case "timeout":
    case "failed":
      return "Check the Factory host's connection to GitHub; the next check tries again.";
  }
}

const notAvailable = {
  ok: false,
  failure: { reason: "failed", message: "GitHub access is not available in this build." },
} as const;

/** Every read fails; for development and test hosts that must never run the host's `gh`. */
export const unavailableGitHub: GitHubAdapter = {
  readiness: async () => notAvailable,
  repository: async () => notAvailable,
  openIssues: async () => notAvailable,
  labelStates: async () => notAvailable,
};
