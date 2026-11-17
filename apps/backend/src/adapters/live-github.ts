import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import {
  gitHubAnswer,
  gitHubRefusal,
  type GitHubAdapter,
  type GitHubIssue,
  type GitHubLabelState,
  type GitHubRead,
  type GitHubRepository,
  type GitHubRepositoryIdentity,
} from "./github.ts";

export interface LiveGitHubOptions {
  /** The environment `gh` runs with; its PATH is searched first. */
  readonly environment?: NodeJS.ProcessEnv;
  /** Searched after PATH, because a Factory opened from Finder inherits no shell PATH. */
  readonly fallbackDirectories?: readonly string[];
  readonly timeoutMs?: number;
  /** Bound on each of `gh`'s stdout and stderr per call. */
  readonly outputLimitBytes?: number;
}

/** `gh`'s documented exit status for a missing login. */
const authenticationRequired = 4;
const pageSize = 100;
/** GitHub search answers at most 1000 results, so a longer result cannot be read completely. */
const maxSearchPages = 10;
const messageLimit = 500;

interface GhExit {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

type Json = Record<string, unknown>;

interface GraphQLAnswer {
  readonly data: Json;
  readonly errors: readonly {
    readonly type: string;
    readonly path: string;
    readonly message: string;
  }[];
}

const failed = (message: string): GitHubRead<never> =>
  gitHubRefusal({ reason: "failed", message: bounded(message) });
const unexpected = () => failed("gh answered in an unexpected shape.");

const bounded = (message: string) => message.trim().slice(0, messageLimit);
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown): Json[] | undefined =>
  isRecord(value) && Array.isArray(value.nodes) ? (value.nodes as Json[]) : undefined;

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return undefined;
  }
}

/** The same `gh` the person uses in a terminal, read with their own login; no token is stored. */
export class LiveGitHubAdapter implements GitHubAdapter {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly fallbackDirectories: readonly string[];
  private readonly timeoutMs: number;
  private readonly outputLimitBytes: number;

  constructor(options: LiveGitHubOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.fallbackDirectories = options.fallbackDirectories ?? [
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ];
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.outputLimitBytes = options.outputLimitBytes ?? 8 * 1024 * 1024;
  }

  async readiness(host: string): Promise<GitHubRead<{ readonly login: string }>> {
    const exit = await this.run(["api", "--hostname", host, "user"], host);
    if (!exit.ok) return exit;
    if (exit.value.code !== 0) return failed(exit.value.stderr);
    const user = parseJson(exit.value.stdout);
    return isRecord(user) && typeof user.login === "string"
      ? gitHubAnswer({ login: user.login })
      : unexpected();
  }

  async repository(workspaceRoot: string): Promise<GitHubRead<GitHubRepository>> {
    // Without any login `gh` stops before resolving the remote, so its default host is the one.
    const exit = await this.run(
      ["repo", "view", "--json", "id,nameWithOwner,url,visibility"],
      "github.com",
      workspaceRoot,
    );
    if (!exit.ok) return exit;
    const { code, stdout, stderr } = exit.value;
    if (code !== 0) return repositoryRefusal(stderr);
    return repositoryOf(parseJson(stdout));
  }

  async openIssues(
    repository: GitHubRepositoryIdentity,
    query: string,
  ): Promise<GitHubRead<readonly GitHubIssue[]>> {
    const issues: GitHubIssue[] = [];
    let after: string | undefined;
    for (let page = 0; page < maxSearchPages; page++) {
      const read = await this.repositoryQuery(repository, searchQuery, [
        // The person's query stays one literal argument after the bound qualifiers.
        ["q", `repo:${repository.nameWithOwner} is:issue is:open ${query}`],
        ...(after === undefined ? [] : [["after", after] as const]),
      ]);
      if (!read.ok) return read;
      const searched = searchPage(read.value.search);
      if (!searched.ok) return searched;
      issues.push(...searched.value.issues);
      if (searched.value.next === null) return gitHubAnswer(issues);
      after = searched.value.next;
    }
    return gitHubRefusal({ reason: "truncated" });
  }

  async labelStates(
    repository: GitHubRepositoryIdentity,
    issueNodeIds: readonly string[],
    label: string,
  ): Promise<GitHubRead<ReadonlyMap<string, GitHubLabelState>>> {
    const states = new Map<string, GitHubLabelState>();
    for (let start = 0; start < issueNodeIds.length; start += pageSize) {
      const ids = issueNodeIds.slice(start, start + pageSize);
      const read = await this.repositoryQuery(
        repository,
        labelQuery,
        ids.map((id) => ["ids[]", id] as const),
      );
      if (!read.ok) return read;
      for (const node of read.value.nodes) {
        const state = labelStateOf(node, repository.nodeId, label);
        if (!state.ok) return state;
        if (state.value) states.set(state.value.nodeId, state.value.state);
      }
    }
    return gitHubAnswer(states);
  }

  /**
   * One GraphQL request that also reads the bound repository, so a name now pointing at another
   * repository refuses the answer. A deleted node in `nodes` is GitHub's partial answer, not a
   * failure: it reads as an issue missing from the repository.
   */
  private async repositoryQuery(
    repository: GitHubRepositoryIdentity,
    query: string,
    fields: readonly (readonly [string, string])[],
  ): Promise<GitHubRead<{ readonly search: unknown; readonly nodes: readonly unknown[] }>> {
    const [owner, name] = repository.nameWithOwner.split("/") as [string, string];
    const read = await this.graphql(repository.host, query, [
      ["owner", owner],
      ["name", name],
      ...fields,
    ]);
    if (!read.ok) return read;
    const { data, errors } = read.value;
    const rejected = errors.find((error) => error.path !== "nodes" || error.type !== "NOT_FOUND");
    if (rejected) return graphQLRefusal(rejected);
    if (!isRecord(data.repository) || typeof data.repository.id !== "string") return unexpected();
    if (data.repository.id !== repository.nodeId)
      return gitHubRefusal({
        reason: "repository_mismatch",
        nameWithOwner: repository.nameWithOwner,
      });
    return gitHubAnswer({
      search: data.search,
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
    });
  }

  /** `gh` exits 1 with the body on stdout when GraphQL answers errors, possibly beside data. */
  private async graphql(
    host: string,
    query: string,
    fields: readonly (readonly [string, string])[],
  ): Promise<GitHubRead<GraphQLAnswer>> {
    const exit = await this.run(
      [
        "api",
        "--hostname",
        host,
        "graphql",
        // -f sends each value as a literal string; -F would read `@file` values from disk.
        ...[["query", query] as const, ...fields].flatMap(([key, value]) => [
          "-f",
          `${key}=${value}`,
        ]),
      ],
      host,
    );
    if (!exit.ok) return exit;
    const body = parseJson(exit.value.stdout);
    if (!isRecord(body) || !isRecord(body.data))
      return failed(exit.value.stderr || "gh answered no JSON.");
    const errors = Array.isArray(body.errors) ? body.errors.map(graphQLError) : [];
    if (exit.value.code !== 0 && errors.length === 0) return failed(exit.value.stderr);
    return gitHubAnswer({ data: body.data, errors });
  }

  /** Runs the found `gh` without a shell; only process-level failures are decided here. */
  private async run(
    args: readonly string[],
    host: string,
    cwd?: string,
  ): Promise<GitHubRead<GhExit>> {
    const gh = await this.findGh();
    if (gh === null) return gitHubRefusal({ reason: "gh_missing" });
    const exit = await new Promise<GitHubRead<GhExit>>((resolve) =>
      execFile(
        gh,
        args,
        {
          ...(cwd === undefined ? {} : { cwd }),
          env: this.environment,
          encoding: "utf8",
          timeout: this.timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: this.outputLimitBytes,
        },
        (error, stdout, stderr) => resolve(processExit(error, stdout, stderr)),
      ),
    );
    if (exit.ok && exit.value.code === authenticationRequired)
      return gitHubRefusal({ reason: "signed_out", host });
    return exit;
  }

  /** Relative PATH entries are skipped: they would resolve inside the Project folder. */
  private async findGh(): Promise<string | null> {
    const directories = [
      ...(this.environment.PATH ?? "").split(delimiter).filter((entry) => isAbsolute(entry)),
      ...this.fallbackDirectories,
    ];
    for (const directory of directories) {
      const candidate = join(directory, "gh");
      if (
        await access(candidate, constants.X_OK).then(
          () => true,
          () => false,
        )
      )
        return candidate;
    }
    return null;
  }
}

function processExit(
  error: (Error & { code?: unknown; killed?: boolean }) | null,
  stdout: string,
  stderr: string,
): GitHubRead<GhExit> {
  if (error === null) return gitHubAnswer({ code: 0, stdout, stderr });
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return gitHubRefusal({ reason: "truncated" });
  if (error.killed) return gitHubRefusal({ reason: "timeout" });
  if (typeof error.code === "number") return gitHubAnswer({ code: error.code, stdout, stderr });
  return failed(error.message);
}

const graphQLError = (error: unknown) => {
  const fields = isRecord(error) ? error : {};
  return {
    type: typeof fields.type === "string" ? fields.type : "",
    path: Array.isArray(fields.path) ? String(fields.path[0]) : "",
    message: typeof fields.message === "string" ? fields.message : "GitHub answered an error.",
  };
};

function graphQLRefusal(error: GraphQLAnswer["errors"][number]): GitHubRead<never> {
  if (error.path === "repository" && error.type === "NOT_FOUND")
    return gitHubRefusal({ reason: "unreadable", message: bounded(error.message) });
  if (error.path === "search")
    return gitHubRefusal({ reason: "query_rejected", message: bounded(error.message) });
  return failed(error.message);
}

function repositoryRefusal(stderr: string): GitHubRead<never> {
  if (/Could not resolve to a Repository/.test(stderr))
    return gitHubRefusal({ reason: "unreadable", message: bounded(stderr) });
  if (/not a git repository|no git remotes|none of the git remotes/.test(stderr))
    return gitHubRefusal({ reason: "no_repository", message: bounded(stderr) });
  return failed(stderr);
}

function repositoryOf(value: unknown): GitHubRead<GitHubRepository> {
  if (!isRecord(value)) return unexpected();
  const { id, nameWithOwner, url, visibility } = value;
  const host = typeof url === "string" && URL.canParse(url) ? new URL(url).hostname : "";
  if (
    typeof id !== "string" ||
    typeof nameWithOwner !== "string" ||
    !/^[^/\s]+\/[^/\s]+$/.test(nameWithOwner) ||
    host === "" ||
    !(visibility === "PUBLIC" || visibility === "PRIVATE" || visibility === "INTERNAL")
  )
    return unexpected();
  return gitHubAnswer({
    host,
    nameWithOwner,
    nodeId: id,
    visibility: visibility === "PUBLIC" ? "public" : "private",
  });
}

const searchQuery = `query($owner: String!, $name: String!, $q: String!, $after: String) {
  repository(owner: $owner, name: $name) { id }
  search(query: $q, type: ISSUE, first: ${pageSize}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on Issue { id number title url createdAt labels(first: 100) { nodes { name } } } }
  }
}`;

const labelQuery = `query($owner: String!, $name: String!, $ids: [ID!]!) {
  repository(owner: $owner, name: $name) { id }
  nodes(ids: $ids) {
    ... on Issue {
      id
      repository { id }
      labels(first: 100) { nodes { name } }
      timelineItems(itemTypes: [LABELED_EVENT], last: 100) {
        pageInfo { hasPreviousPage }
        nodes { ... on LabeledEvent { id createdAt label { name } } }
      }
    }
  }
}`;

function searchPage(
  search: unknown,
): GitHubRead<{ readonly issues: readonly GitHubIssue[]; readonly next: string | null }> {
  const nodes = records(search);
  const pageInfo = isRecord(search) ? search.pageInfo : undefined;
  if (!nodes || !isRecord(pageInfo) || typeof pageInfo.hasNextPage !== "boolean")
    return unexpected();
  const issues = nodes.map(issueOf);
  if (!issues.every((issue) => issue !== undefined)) return unexpected();
  if (!pageInfo.hasNextPage) return gitHubAnswer({ issues, next: null });
  // Ending here would pass a partial list off as every matching issue.
  if (typeof pageInfo.endCursor !== "string" || !pageInfo.endCursor)
    return failed("GitHub said more issues match but gave no cursor to read them.");
  return gitHubAnswer({ issues, next: pageInfo.endCursor });
}

function issueOf(node: Json): GitHubIssue | undefined {
  const { id, number, title, url, createdAt } = node;
  const labels = labelNames(node.labels);
  if (
    typeof id !== "string" ||
    typeof number !== "number" ||
    typeof title !== "string" ||
    typeof url !== "string" ||
    typeof createdAt !== "string" ||
    !labels
  )
    return undefined;
  return { nodeId: id, number, title, url, createdAt, labels };
}

function labelNames(connection: unknown): string[] | undefined {
  const names = records(connection)?.map((label) => label.name);
  return names?.every((name) => typeof name === "string") ? names : undefined;
}

/**
 * An issue's state for `label`, or null when the node is gone or now belongs to another
 * repository. Without the label among its latest 100 `labeled` events while older ones exist,
 * the latest labelling cannot be read completely.
 */
function labelStateOf(
  node: unknown,
  repositoryNodeId: string,
  label: string,
): GitHubRead<{ readonly nodeId: string; readonly state: GitHubLabelState } | null> {
  if (node === null) return gitHubAnswer(null);
  if (!isRecord(node) || typeof node.id !== "string" || !isRecord(node.timelineItems))
    return unexpected();
  const labels = labelNames(node.labels);
  const events = records(node.timelineItems)?.map(labellingOf);
  if (!labels || !events || events.includes(undefined)) return unexpected();
  if (!isRecord(node.repository) || node.repository.id !== repositoryNodeId)
    return gitHubAnswer(null);
  const latest = events.findLast((event) => event?.label === label);
  const pageInfo = node.timelineItems.pageInfo;
  if (!latest && isRecord(pageInfo) && pageInfo.hasPreviousPage === true)
    return gitHubRefusal({ reason: "truncated" });
  return gitHubAnswer({
    nodeId: node.id,
    state: {
      labelled: labels.includes(label),
      latestLabelling: latest ? { eventId: latest.eventId, createdAt: latest.createdAt } : null,
    },
  });
}

/** A `labeled` event, or undefined when GitHub answered something else. */
function labellingOf(event: Json) {
  const { id, createdAt, label } = event;
  return typeof id === "string" &&
    typeof createdAt === "string" &&
    isRecord(label) &&
    typeof label.name === "string"
    ? { eventId: id, createdAt, label: label.name }
    : undefined;
}
