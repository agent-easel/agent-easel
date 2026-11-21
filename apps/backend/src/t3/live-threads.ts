import {
  T3Failure,
  structured,
  type DispatchFence,
  type T3Calls,
  type T3Endpoint,
  type T3Target,
} from "./connection.ts";
import { readDelegatedSettlement } from "./delegated-settlement.ts";
import { discoverLaunches, threadIdentityRead } from "./launch-discovery.ts";
import { workerTitleRenameDisposition } from "./rename-disposition.ts";
import type {
  AttachmentUpload,
  ExecutionObservation,
  LaunchDiscovery,
  LaunchPayload,
  LaunchReference,
  SendPayload,
  SendReference,
  T3Threads,
  ThreadIdentityRead,
  WorkerTitleRenameDisposition,
  WorkerTitleRenameRequest,
} from "./threads.ts";
import { threadRepository } from "./worker-repository.ts";

type ThreadExecutionRead = {
  thread: {
    threadId: string;
    projectId: string;
    activeRunId: string | null;
    link: string | null;
    worktreePath: string | null;
    pendingRequestCount: number;
    latestRunId?: string | null;
    branch?: unknown;
    pullRequests?: unknown;
    linkedPullRequest?: unknown;
  };
  recentRuns: RecentRun[];
};
type RecentRun = {
  runId: string;
  status: string;
  ordinal?: number;
  requestedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

const isNullableString = (value: unknown) => value === null || typeof value === "string";

function isObservedThread(thread: ThreadExecutionRead["thread"] | undefined, threadId: string) {
  return (
    thread?.threadId === threadId &&
    typeof thread.projectId === "string" &&
    isNullableString(thread.activeRunId) &&
    isNullableString(thread.link) &&
    isNullableString(thread.worktreePath) &&
    Number.isInteger(thread.pendingRequestCount) &&
    thread.pendingRequestCount >= 0
  );
}

const isRunReference = (value: unknown) => value === undefined || isNullableString(value);

const isRecentRun = (recentRun: RecentRun) =>
  typeof recentRun.runId === "string" &&
  typeof recentRun.status === "string" &&
  (recentRun.ordinal === undefined ||
    (Number.isInteger(recentRun.ordinal) && recentRun.ordinal >= 1));

function executionObservation(threadId: string, body: ThreadExecutionRead): ExecutionObservation {
  const repository = threadRepository(body.thread);
  return {
    ...(repository ? { repository } : {}),
    threadId,
    projectId: body.thread.projectId,
    activeRunId: body.thread.activeRunId,
    link: body.thread.link,
    workspaceRoot: body.thread.worktreePath,
    pendingRequestCount: body.thread.pendingRequestCount,
    ...(body.thread.latestRunId !== undefined ? { latestRunId: body.thread.latestRunId } : {}),
    recentRuns: body.recentRuns.map((recentRun) => {
      const source = recentRun.completedAt ?? recentRun.startedAt ?? recentRun.requestedAt;
      return {
        runId: recentRun.runId,
        status: recentRun.status,
        ...(recentRun.ordinal !== undefined ? { ordinal: recentRun.ordinal } : {}),
        // T3 advertises a nullable start: null is a run that never started, absence is no evidence.
        ...(recentRun.startedAt !== undefined ? { startedAt: recentRun.startedAt } : {}),
        completedAt: recentRun.completedAt ?? null,
        sourceAt: typeof source === "string" && Number.isFinite(Date.parse(source)) ? source : null,
      };
    }),
  };
}

export class LiveT3Threads implements T3Threads {
  private readonly connection: T3Calls;

  constructor(connection: T3Calls) {
    this.connection = connection;
  }
  /** The upload URL is a signed capability on the MCP origin: it is sent without the OAuth bearer
   * and never logged or included in errors. */
  async uploadAttachment(
    target: T3Endpoint,
    upload: AttachmentUpload,
    data: Uint8Array,
  ): Promise<string> {
    const prepared = await this.connection
      .authorized(target, async (session) =>
        structured(
          await session.call(
            "t3_attachment_prepare_upload",
            { upload: { type: "image", ...upload } },
            30_000,
          ),
        ),
      )
      .catch((error: T3Failure) => {
        throw new T3Failure(error.kind, "T3 did not prepare the upload.");
      });
    const { attachmentId, relativeUrl } = (prepared ?? {}) as Record<string, unknown>;
    const origin = new URL(target.endpoint).origin;
    const url = typeof relativeUrl === "string" ? URL.parse(relativeUrl, origin) : null;
    if (typeof attachmentId !== "string" || !attachmentId || !url || url.origin !== origin)
      throw new T3Failure("invalid-response", "T3 returned an invalid upload address.");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": upload.mimeType },
      body: Buffer.from(data),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => {
      throw new T3Failure("unavailable", "T3 upload is temporarily unavailable.");
    });
    await response.body?.cancel().catch(() => {});
    if (!response.ok)
      throw new T3Failure(
        response.status >= 500 ? "unavailable" : "refused",
        `T3 answered the upload with HTTP ${response.status}.`,
      );
    return attachmentId;
  }
  async launchThread(target: T3Endpoint, payload: LaunchPayload): Promise<LaunchReference> {
    return this.connection.authorized(target, async (session) => {
      const result = await session.call("t3_thread_launch", { ...payload }, 30_000);
      if (result.isError) throw new T3Failure("refused", "T3 rejected the worker launch");
      const body = structured(result) as LaunchReference | undefined;
      if (
        !body ||
        !body.threadId ||
        typeof body.threadId !== "string" ||
        !body.runId ||
        typeof body.runId !== "string" ||
        typeof body.status !== "string" ||
        body.projectId !== payload.projectId ||
        !(body.link === null || typeof body.link === "string")
      )
        throw Error("Invalid launch reference; outcome is uncertain");
      return {
        projectId: body.projectId,
        threadId: body.threadId,
        runId: body.runId,
        status: body.status,
        link: body.link,
      };
    });
  }
  async discoverLaunchCandidates(target: T3Target, title: string): Promise<LaunchDiscovery> {
    try {
      return await this.connection.authorized(target, async (session) =>
        discoverLaunches(
          async (name, args) => structured(await session.call(name, args, 30_000)),
          target.projectId,
          title,
        ),
      );
    } catch {
      return { available: false };
    }
  }
  async readThreadIdentity(target: T3Target, threadId: string): Promise<ThreadIdentityRead> {
    return this.connection.authorized(target, async (session) =>
      threadIdentityRead(
        structured(await session.call("t3_thread_read", { threadId, runLimit: 50 }, 30_000)),
        threadId,
      ),
    );
  }
  async settleThread(target: T3Endpoint, payload: { threadId: string }) {
    await this.connection.authorized(target, async (session) => {
      const result = await session.call(
        "t3_thread_organize",
        { threadId: payload.threadId, action: "settle" },
        10_000,
      );
      if (result.isError) throw new T3Failure("refused", "Thread settlement outcome unresolved");
    });
  }
  async sendMessage(target: T3Endpoint, payload: SendPayload): Promise<SendReference> {
    if (
      payload.mode !== "queue" ||
      !payload.clientRequestId ||
      payload.clientRequestId.length > 256
    )
      throw new T3Failure("refused", "Invalid queue request");
    return this.connection.authorized(target, async (session) => {
      const body = structured(
        await session.call("t3_thread_send", { ...payload }, 30_000),
      ) as SendReference;
      if (
        !body ||
        body.threadId !== payload.threadId ||
        typeof body.messageId !== "string" ||
        !body.messageId ||
        typeof body.runId !== "string" ||
        !body.runId ||
        typeof body.status !== "string" ||
        !["started", "queued"].includes(body.delivery)
      )
        throw Error("Invalid send reference; outcome is uncertain");
      return {
        threadId: body.threadId,
        messageId: body.messageId,
        runId: body.runId,
        status: body.status,
        delivery: body.delivery,
      };
    });
  }
  async stopThread(target: T3Endpoint, payload: { threadId: string; clientRequestId: string }) {
    await this.connection.authorized(target, async (session) => {
      const result = await session.call("t3_thread_interrupt", { ...payload, stop: true }, 30_000);
      if (result.isError) throw new T3Failure("refused", "Thread Stop outcome unresolved");
    });
  }
  async readExecution(target: T3Endpoint, threadId: string): Promise<ExecutionObservation> {
    return this.connection.authorized(target, async (session) => {
      const body = structured(
        await session.call(
          "t3_thread_read",
          { threadId, limit: 1, maxCharsPerItem: 1, runLimit: 50 },
          10_000,
        ),
      ) as ThreadExecutionRead;
      if (
        !body ||
        !isObservedThread(body.thread, threadId) ||
        !Array.isArray(body.recentRuns) ||
        !body.recentRuns.every(isRecentRun) ||
        !isRunReference(body.thread.latestRunId)
      )
        throw Error("Invalid thread observation");
      return executionObservation(threadId, body);
    });
  }
  async renameThread(
    target: T3Endpoint & DispatchFence,
    request: WorkerTitleRenameRequest,
  ): Promise<WorkerTitleRenameDisposition> {
    const unavailable = (): WorkerTitleRenameDisposition => ({ kind: "unavailable" });
    try {
      return await this.connection.authorized(
        target,
        async (session) => {
          const answer = await session.call(
            "t3_thread_update",
            {
              threadId: request.threadId,
              action: "rename",
              title: request.title,
              clientRequestId: request.clientRequestId,
              ...(request.environmentId !== undefined
                ? { environmentId: request.environmentId }
                : {}),
            },
            10_000,
          );
          return workerTitleRenameDisposition(request, answer);
        },
        target,
      );
    } catch (error) {
      if (error instanceof T3Failure && error.kind === "refused") return { kind: "unclassified" };
      if (error instanceof T3Failure && error.kind === "authorization-required")
        return { kind: "unclassified" };
      return unavailable();
    }
  }
  readDelegatedSettlement(target: T3Endpoint, threadId: string, runId: string) {
    return readDelegatedSettlement(
      (args) =>
        this.connection.authorized(target, async (session) =>
          structured(await session.call("t3_thread_wait", args, 10_000)),
        ),
      threadId,
      runId,
    );
  }
}
