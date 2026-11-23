import type { RunPullRequest } from "@t3-factory/contracts";
import type { DispatchFence, T3Endpoint, T3Target } from "./connection.ts";
import type { DelegatedSettlement } from "./delegated-settlement.ts";

/** Every call that rejects does so only with a `T3Failure`. */
export interface T3Threads {
  /** `t3_thread_wait` for one run with its delegated and background work. Queues, native
   * requests and business completion stay separate. */
  readDelegatedSettlement(
    target: T3Endpoint,
    threadId: string,
    runId: string,
  ): Promise<DelegatedSettlement>;
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
  findStartCall(target: T3Endpoint, threadId: string, requestId: string): Promise<boolean>;
  /** One thread read: active/latest run, recent runs and the pending native request count. */
  readExecution(target: T3Endpoint, threadId: string): Promise<ExecutionObservation>;
  renameThread(
    target: T3Endpoint & DispatchFence,
    request: WorkerTitleRenameRequest,
  ): Promise<WorkerTitleRenameDisposition>;
}

export interface WorkerTitleRenameRequest {
  readonly threadId: string;
  readonly title: string;
  readonly clientRequestId: string;
  readonly environmentId?: string;
}

export type WorkerTitleRenameDisposition =
  | { readonly kind: "acknowledged"; readonly threadId: string; readonly title: string }
  | { readonly kind: "different-title"; readonly threadId: string; readonly title: string }
  | { readonly kind: "thread-not-found" }
  | { readonly kind: "capability-denied" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "unclassified" };

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
export interface PendingBackgroundTask {
  readonly taskId: string;
  readonly kind: string;
  readonly awaited: boolean;
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
  readonly status?: string;
  readonly activeRunId: string | null;
  readonly link: string | null;
  /** T3's `worktreePath`: null is the project checkout. */
  readonly workspaceRoot: string | null;
  readonly pendingRequestCount: number;
  readonly pendingBackgroundTasks?: readonly PendingBackgroundTask[];
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
  readonly freshContext?: true;
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
