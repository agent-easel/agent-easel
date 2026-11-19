import type {
  AgentEnvironment,
  AgentProviderCapability,
  ProjectIcon,
  RunPullRequest,
} from "@t3-factory/contracts";
import type {
  T3Endpoint,
  T3EnvironmentTarget,
  T3ProjectTarget,
  T3Target,
} from "../t3/connection.ts";

/** A provider as T3's catalog publishes it; Factory adds its own reporting support. */
export type T3ProviderCapability = Omit<AgentProviderCapability, "reporting">;

/** Every call that rejects does so only with a `T3Failure`. */
export interface T3Adapter {
  /** `t3_thread_wait` for one run with its delegated and background work. Queues, native
   * requests and business completion stay separate. */
  readDelegatedSettlement(
    target: T3Endpoint,
    threadId: string,
    runId: string,
  ): Promise<import("./delegated-settlement.ts").DelegatedSettlement>;
  settleThread(target: T3Endpoint, payload: { threadId: string }): Promise<void>;
  /** Thread scope, including delegated work; no run fence. */
  stopThread(
    target: T3Endpoint,
    payload: { threadId: string; clientRequestId: string },
  ): Promise<void>;
  sendMessage(target: T3Endpoint, payload: SendPayload): Promise<SendReference>;
  /** Prepares one pending upload and posts its exact bytes; returns its attachment id. */
  uploadAttachment(target: T3Endpoint, upload: AttachmentUpload, data: Uint8Array): Promise<string>;
  /** A `refused` launch was not accepted; any other failure leaves its outcome uncertain. */
  launchThread(target: T3Endpoint, payload: LaunchPayload): Promise<LaunchReference>;
  /** Search one project for a launch that may already exist. Incomplete scans withhold candidates. */
  discoverLaunchCandidates(target: T3Target, title: string): Promise<LaunchDiscovery>;
  /** Independent thread identity. Callers still prove it is the saved worker. */
  readThreadIdentity(target: T3Target, threadId: string): Promise<ThreadIdentityRead>;
  /** One thread read: active/latest run, recent runs and the pending native request count. */
  readExecution(target: T3Endpoint, threadId: string): Promise<ExecutionObservation>;
  listProjects(target: T3EnvironmentTarget): Promise<readonly T3Project[]>;
  createProject(target: T3ProjectTarget): Promise<T3Project>;
  readEnvironment(target: T3Endpoint): Promise<AgentEnvironment>;
  orchestratorCapabilities(target: T3Endpoint): Promise<readonly T3ProviderCapability[]>;
  /**
   * `t3_theme_read` over the MCP connection. Null when T3 does not list the tool; rejects when T3
   * cannot be reached or answers outside the contract.
   */
  readTheme(target: T3Endpoint): Promise<T3ThemeRead | null>;
}

/** A published theme's colors by T3 role name; names and CSS color text are length-bounded. */
export type T3ThemeColors = Readonly<Record<string, string>>;
/**
 * One theme definition T3 publishes for its environment: seeds, role colors or both for its own
 * `appearance`, and optional role colors for the other mode. `definition` is null when the
 * definition is not in the format Factory supports.
 */
export interface PublishedT3Theme {
  readonly id: string;
  readonly name: string;
  readonly definition: {
    readonly appearance: "light" | "dark";
    /** `#rgb` or `#rrggbb` seeds; T3 generates from them only when both are given. */
    readonly seeds: { readonly canvas: string; readonly accent: string } | null;
    readonly colors: T3ThemeColors;
    /** Colors for the mode other than `appearance`; null when the theme declares none. */
    readonly variant: T3ThemeColors | null;
  } | null;
}

/**
 * The only theme facts Factory keeps from T3: the environment that answered, its default theme
 * id and, when that id names a published theme, its definition.
 */
export interface T3ThemeRead {
  readonly environmentId: string | null;
  readonly defaultTheme: string;
  readonly themes: readonly PublishedT3Theme[];
}

export interface T3Project {
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly available: boolean;
  readonly projectIcon?: ProjectIcon | null;
  readonly faviconPath?: string | null;
}

/** `root` is the project checkout. Worktree strategies name the branch every Run worker shares. */
type WorkspaceStrategy =
  | { readonly type: "root" }
  | {
      readonly type: "worktree";
      readonly baseRef: string;
      readonly branch: string;
      readonly startFromOrigin?: boolean;
    }
  | { readonly type: "existing_worktree"; readonly worktreePath: string; readonly branch: string };
/** Starts the thread's first turn with `message`. */
export interface LaunchPayload {
  readonly environmentId: string;
  readonly projectId: string;
  readonly clientRequestId: string;
  readonly title: string;
  readonly workspaceStrategy: WorkspaceStrategy;
  readonly interactionMode: "default";
  readonly modelSelection: {
    readonly instanceId: string;
    readonly model: string;
    readonly options: Readonly<Record<string, string | boolean>>;
  };
  readonly message: string;
  /** Uploaded images for the first turn, named as the message refers to them. */
  readonly attachments?: readonly LaunchAttachment[];
}
export interface AttachmentUpload {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}
export interface LaunchAttachment extends AttachmentUpload {
  readonly type: "image";
  readonly id: string;
}
export interface LaunchReference {
  readonly projectId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly link: string | null;
  readonly status: string;
}
export interface LaunchCandidateExecution {
  readonly runId: string;
  readonly providerInstanceId: string;
  readonly model: string;
  readonly status: string;
}
export interface LaunchCandidate {
  readonly title: string;
  readonly projectId: string;
  readonly parentThreadId: string | null;
  readonly workspaceRoot: string | null;
  readonly branch: string | null;
  readonly interactionMode: string | null;
  readonly providerInstanceId: string;
  readonly model: string;
  readonly options: Readonly<Record<string, string | boolean>> | null;
  readonly threadId: string;
  readonly executions: readonly LaunchCandidateExecution[];
  readonly link?: string | null;
}
export type LaunchDiscovery =
  | { readonly available: false }
  | { readonly available: true; readonly candidates: readonly LaunchCandidate[] };
export interface ThreadIdentityRead {
  readonly threadId: string;
  readonly projectId: string;
  readonly parentThreadId: string | null;
  readonly workspaceRoot: string | null;
  readonly branch: string | null;
  readonly providerInstanceId: string;
  readonly model: string;
  readonly executions: readonly LaunchCandidateExecution[];
}
export interface ExecutionObservation {
  /** Absent when the upstream thread read supplies no repository metadata; a null branch is a
   * thread T3 shows no branch for. */
  readonly repository?: {
    readonly branch: string | null;
    readonly pullRequests: readonly RunPullRequest[];
  };
  readonly projectId: string;
  readonly threadId: string;
  readonly activeRunId: string | null;
  readonly link: string | null;
  /** T3's `worktreePath`: null is the project checkout. */
  readonly workspaceRoot: string | null;
  readonly pendingRequestCount: number;
  readonly latestRunId?: string | null;
  readonly recentRuns: readonly {
    readonly runId: string;
    readonly status: string;
    readonly ordinal?: number;
    readonly sourceAt?: string | null;
    readonly startedAt?: string | null;
    readonly completedAt?: string | null;
  }[];
}

/** Queue always means an independent new turn, never steering or batching. */
export interface SendPayload {
  readonly environmentId: string;
  readonly threadId: string;
  readonly mode: "queue";
  readonly clientRequestId: string;
  readonly message: string;
}
export interface SendReference {
  readonly threadId: string;
  readonly messageId: string;
  /** Exact execution reference returned by send, including a queued execution. */
  readonly runId: string;
  readonly status: string;
  readonly delivery: "started" | "queued";
}
