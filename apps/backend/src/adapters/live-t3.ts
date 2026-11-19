import { stat } from "node:fs/promises";
import { isAbsolute, basename } from "node:path";
import { threadRepository } from "./worker-repository.ts";
import type {
  AttachmentUpload,
  T3Adapter,
  T3Project,
  ExecutionObservation,
  LaunchDiscovery,
  LaunchPayload,
  LaunchReference,
  ThreadIdentityRead,
  SendPayload,
  SendReference,
  T3ProviderCapability,
} from "./t3.ts";
import { discoverLaunches, threadIdentityRead } from "../launch-discovery.ts";
import {
  T3Failure,
  structured,
  type T3Calls,
  type T3Endpoint,
  type T3EnvironmentTarget,
  type T3ListedTool,
  type T3ProjectTarget,
  type T3Session,
  type T3Target,
} from "../t3/connection.ts";
import { hasEnvironmentIdentity } from "../t3/environment-identity.ts";
import type { AgentEnvironment } from "@t3-factory/contracts";
import { parseProjectFaviconPath, parseProjectIcon } from "@t3-factory/domain-validation";
import { readDelegatedSettlement } from "./delegated-settlement.ts";
import { isLocalEndpoint } from "../endpoint-local.ts";
import { parseProviderCapabilities } from "./t3-capabilities.ts";

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
        startedAt: recentRun.startedAt ?? null,
        completedAt: recentRun.completedAt ?? null,
        sourceAt: typeof source === "string" && Number.isFinite(Date.parse(source)) ? source : null,
      };
    }),
  };
}

const PROJECT_TOOL_FIELDS = [
  ["t3_project_list", ["environmentId", "cursor", "limit"]],
  [
    "t3_project_create",
    ["environmentId", "title", "workspaceRoot", "createWorkspaceRootIfMissing"],
  ],
] as const;

const projectFieldType = (field: string) =>
  field === "cursor" || field === "limit"
    ? "integer"
    : field === "createWorkspaceRootIfMissing"
      ? "boolean"
      : "string";

function supportsProjectTool(
  tools: readonly T3ListedTool[],
  name: string,
  fields: readonly string[],
): boolean {
  const schema = tools.find((tool) => tool.name === name)?.inputSchema;
  const properties = schema?.properties as Record<string, { type?: string }> | undefined;
  if (schema?.type !== "object" || !properties) return false;
  return (
    fields.every((field) => properties[field]?.type === projectFieldType(field)) &&
    (schema.required ?? []).every((field) => fields.includes(field))
  );
}

/** Every T3 call over one live connection, which owns authorization and classifies failures. */
export class LiveT3Adapter implements T3Adapter {
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
  async readEnvironment(target: T3Endpoint): Promise<AgentEnvironment> {
    return this.connection.authorized(target, async (session) => {
      const body = structured(await session.call("t3_environment_read", {}, 10_000));
      if (!hasEnvironmentIdentity(body))
        throw new Error("t3_environment_read did not return an environment identity.");
      const label =
        "label" in body && typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : body.environmentId;
      return { environmentId: body.environmentId, label };
    });
  }
  async orchestratorCapabilities(target: T3Endpoint): Promise<readonly T3ProviderCapability[]> {
    return this.connection.authorized(target, async (session) =>
      parseProviderCapabilities(
        structured(await session.call("orchestrator_capabilities", {}, 15_000)),
      ),
    );
  }
  /** Every Project call first checks that T3 still lists both Project tools as Factory uses them. */
  private withProjectContract<A>(
    target: T3Endpoint,
    action: (session: T3Session) => Promise<A>,
  ): Promise<A> {
    return this.connection.authorized(target, async (session) => {
      const tools = await session.tools();
      for (const [name, fields] of PROJECT_TOOL_FIELDS)
        if (!supportsProjectTool(tools, name, fields))
          throw new T3Failure("refused", "Unsupported project contract");
      return action(session);
    });
  }
  private async projectCall(
    session: T3Session,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const answer = await session.call(name, args, 10_000);
    if (answer.isError) throw new T3Failure("refused", "T3 project operation failed.");
    if (answer.content === undefined) throw new Error("Invalid project result.");
    return answer.content;
  }
  private async projectValue(endpoint: string, value: unknown): Promise<T3Project | null> {
    if (!value || typeof value !== "object") throw new Error("Invalid project");
    const project = value as Record<string, unknown>;
    if (
      typeof project.id !== "string" ||
      !project.id ||
      typeof project.title !== "string" ||
      typeof project.workspaceRoot !== "string" ||
      !isAbsolute(project.workspaceRoot)
    )
      throw new Error("Invalid project");
    if (project.deletedAt || project.archivedAt) return null;
    let available = false;
    // Only local T3 paths can be checked on this backend host. Remote execution is unverified.
    if (isLocalEndpoint(endpoint)) {
      available = await stat(project.workspaceRoot).then(
        (stats) => stats.isDirectory(),
        () => false,
      );
    }
    return {
      projectId: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      available,
      projectIcon: parseProjectIcon(project.projectIcon),
      faviconPath: parseProjectFaviconPath(project.faviconPath),
    };
  }
  async listProjects(target: T3EnvironmentTarget): Promise<readonly T3Project[]> {
    return this.withProjectContract(target, async (session) => {
      const projects: T3Project[] = [];
      const ids = new Set<string>();
      const add = (project: T3Project | null) => {
        if (!project) return;
        if (ids.has(project.projectId)) throw new Error("Project pages shifted; recheck.");
        ids.add(project.projectId);
        projects.push(project);
      };
      let cursor: number | undefined;
      const seen = new Set<number>();
      do {
        const page = await this.projectPage(session, target.environmentId, cursor);
        for (const raw of page.projects) add(await this.projectValue(target.endpoint, raw));
        cursor = page.nextCursor ?? undefined;
        if (cursor !== undefined && (seen.has(cursor) || seen.size >= 100))
          throw new Error("Invalid project pagination");
        if (cursor !== undefined) seen.add(cursor);
      } while (cursor !== undefined);
      return projects;
    });
  }
  private async projectPage(
    session: T3Session,
    environmentId: string,
    cursor: number | undefined,
  ): Promise<{ projects: unknown[]; nextCursor: number | null }> {
    const body = (await this.projectCall(session, "t3_project_list", {
      environmentId,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    })) as { projects?: unknown; nextCursor?: unknown };
    if (
      !body ||
      !Array.isArray(body.projects) ||
      !(
        body.nextCursor === null ||
        (Number.isInteger(body.nextCursor) && (body.nextCursor as number) >= 0)
      )
    )
      throw new Error("Invalid project page");
    return { projects: body.projects, nextCursor: body.nextCursor as number | null };
  }
  async createProject(target: T3ProjectTarget): Promise<T3Project> {
    return this.withProjectContract(target, async (session) => {
      const value = await this.projectCall(session, "t3_project_create", {
        environmentId: target.environmentId,
        title: basename(target.workspaceRoot),
        workspaceRoot: target.workspaceRoot,
        createWorkspaceRootIfMissing: false,
      });
      const project = await this.projectValue(target.endpoint, value);
      if (!project) throw new Error("Project unavailable");
      return project;
    });
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
