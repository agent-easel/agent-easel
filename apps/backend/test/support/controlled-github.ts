import {
  gitHubAnswer,
  gitHubRefusal,
  type GitHubAdapter,
  type GitHubFailure,
  type GitHubIssue,
  type GitHubLabelling,
  type GitHubLabelState,
  type GitHubRead,
  type GitHubRepository,
  type GitHubRepositoryIdentity,
} from "../../src/adapters/github.ts";

type GitHubCall = keyof GitHubAdapter;

/** An issue as GitHub holds it, with every `labeled` event it has had. */
export interface ControlledIssue extends GitHubIssue {
  readonly repositoryNodeId: string;
  open: boolean;
  /** False when the issue no longer meets the query's conditions other than its labels. */
  matchesQuery: boolean;
  labels: string[];
  readonly labellings: (GitHubLabelling & { readonly label: string })[];
}

/** Each positive `label:` qualifier a query names; a matching issue carries all of them. */
const queryLabels = (query: string) =>
  [...query.matchAll(/(?:^|\s)label:(?:"([^"]+)"|(\S+))/g)].map((match) => match[1] ?? match[2]!);

/** Independent GitHub and host `gh` login; no SQL or Factory internals. */
export class ControlledGitHub implements GitHubAdapter {
  found = true;
  signedIn = true;
  login = "factory-maintainer";
  /** Repositories by the Project folder whose remote names them. */
  readonly repositories = new Map<string, GitHubRepository>();
  readonly issues: ControlledIssue[] = [];
  /** A call named here fails with its failure until the entry is removed. */
  readonly failures = new Map<GitHubCall, GitHubFailure>();
  readonly calls: GitHubCall[] = [];
  /** Runs after a call is received and before it reads GitHub's state; a barrier holds it here. */
  beforeAnswer?: (call: GitHubCall) => Promise<void>;

  async readiness(_host: string) {
    return this.answer("readiness", () => gitHubAnswer({ login: this.login }));
  }

  async repository(workspaceRoot: string) {
    return this.answer("repository", () => {
      const repository = this.repositories.get(workspaceRoot);
      return repository
        ? gitHubAnswer(repository)
        : gitHubRefusal({ reason: "no_repository", message: "No GitHub remote." });
    });
  }

  async openIssues(repository: GitHubRepositoryIdentity, query: string) {
    return this.answer("openIssues", () => {
      const labels = queryLabels(query);
      return gitHubAnswer(
        this.repositoryIssues(repository).filter(
          (issue) =>
            issue.open &&
            issue.matchesQuery &&
            labels.every((label) => issue.labels.includes(label)),
        ),
      );
    });
  }

  async labelStates(
    repository: GitHubRepositoryIdentity,
    issueNodeIds: readonly string[],
    label: string,
  ) {
    return this.answer("labelStates", () => {
      const states = new Map<string, GitHubLabelState>();
      for (const issue of this.repositoryIssues(repository))
        if (issueNodeIds.includes(issue.nodeId)) {
          const latest = issue.labellings.findLast((labelling) => labelling.label === label);
          states.set(issue.nodeId, {
            labelled: issue.labels.includes(label),
            latestLabelling: latest
              ? { eventId: latest.eventId, createdAt: latest.createdAt }
              : null,
          });
        }
      return gitHubAnswer(states);
    });
  }

  private repositoryIssues(repository: GitHubRepositoryIdentity) {
    return this.issues.filter((issue) => issue.repositoryNodeId === repository.nodeId);
  }

  private async answer<A>(call: GitHubCall, read: () => GitHubRead<A>): Promise<GitHubRead<A>> {
    this.calls.push(call);
    await this.beforeAnswer?.(call);
    if (!this.found) return gitHubRefusal({ reason: "gh_missing" });
    if (!this.signedIn) return gitHubRefusal({ reason: "signed_out", host: "github.com" });
    const failure = this.failures.get(call);
    return failure ? gitHubRefusal(failure) : read();
  }
}
