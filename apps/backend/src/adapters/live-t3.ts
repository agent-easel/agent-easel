import { AsyncLocalStorage } from "node:async_hooks";
import { chmodSync, mkdirSync, readdirSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { isAbsolute, basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { threadRepository } from "./worker-repository.ts";
import {
  credentialPath,
  readCredentialFile,
  removeCredentialFile,
  writeCredentialFile,
} from "./credential-files.ts";
import { themeListing, themeRead } from "./t3-theme-read.ts";
import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  UnsupportedProtocolVersionError,
  SdkHttpError,
  SdkError,
  SdkErrorCode,
  ProtocolError,
  type OAuthClientProvider,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import type {
  AttachmentUpload,
  AuthorizationResumption,
  T3Adapter,
  T3Endpoint,
  T3EnvironmentTarget,
  T3Inspection,
  T3Support,
  T3ConnectionReason,
  T3Project,
  T3ProjectTarget,
  ExecutionObservation,
  LaunchDiscovery,
  LaunchPayload,
  LaunchReference,
  LaunchSupport,
  T3Target,
  ThreadIdentityRead,
  SendPayload,
  SendReference,
  T3ProviderCapability,
} from "./t3.ts";
import { contractSupport } from "./t3-contract.ts";
import { discoverLaunches, threadIdentityRead } from "../launch-discovery.ts";
import { T3Failure } from "./t3.ts";
import type { AgentEnvironment } from "@t3-factory/contracts";
import { parseProjectFaviconPath, parseProjectIcon } from "@t3-factory/domain-validation";
import { readDelegatedSettlement } from "./delegated-settlement.ts";
import { isLocalEndpoint } from "../endpoint-local.ts";
import { parseProviderCapabilities } from "./t3-capabilities.ts";
import {
  listenOAuthCallback,
  type CallbackListener,
  type CallbackReply,
  type CallbackRequest,
} from "./oauth-callback-listener.ts";

type Credentials = {
  endpoint: string;
  identity?: string;
  client?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  discovery?: OAuthDiscoveryState;
  verifier?: string;
  state?: string;
  /** `authorizationUrl` lets the host reopen the same consent page; it never leaves this file. */
  pending?: { expiresAt: number; redirectUrl: string; authorizationUrl?: string };
  reason?: T3ConnectionReason;
};
export interface LiveT3Options {
  readonly credentialsDirectory: string;
  readonly callbackPort?: number;
  /** Integration-only proof of server continuity and request-key retention. No proof = no replay.
   * The verifier must return a stable scope only while those conditions are established. */
  readonly sendRecoveryScope?: (endpoint: string) => Promise<string | null>;
  readonly launchRecoveryScope?: (endpoint: string) => Promise<string | null>;
  readonly openBrowser?: (url: string) => Promise<void>;
}
const browser = async (url: string) => {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
  await promisify(execFile)(
    command,
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url],
    { timeout: 10_000 },
  );
};
const equalState = (leftState: string, rightState: string) => {
  const left = Buffer.from(leftState),
    right = Buffer.from(rightState);
  return left.length === right.length && timingSafeEqual(left, right);
};

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
type ListedTool = Pick<
  Awaited<ReturnType<Client["listTools"]>>["tools"][number],
  "name" | "inputSchema"
>;
/** An inspection before its support answers are derived from the listed tools. */
type Inspected = Omit<T3Inspection, "support">;

/** Structured content, else the first text item that parses as JSON; undefined when neither exists. */
function toolContent(result: ToolResult): unknown {
  if (result.structuredContent) return result.structuredContent;
  for (const item of result.content)
    if (item.type === "text") {
      try {
        return JSON.parse(item.text) as unknown;
      } catch {
        /* Other text is not a contract. */
      }
    }
  return undefined;
}

/** Collects every tools/list page; repeated or runaway cursors fail with `invalidPagination`. */
async function listAllTools(client: Client, invalidPagination: () => Error): Promise<ListedTool[]> {
  const tools: ListedTool[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 10_000 });
    tools.push(...page.tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema })));
    cursor = page.nextCursor;
    if (cursor && (seen.has(cursor) || seen.size >= 100)) throw invalidPagination();
    if (cursor) seen.add(cursor);
  } while (cursor);
  return tools;
}

const serverIdentity = (client: Client | undefined) => {
  const server = client?.getServerVersion();
  return { serverName: server?.name ?? "Unknown", serverVersion: server?.version ?? "Unknown" };
};

const hasEnvironmentIdentity = (body: unknown): body is { environmentId: string } =>
  typeof body === "object" &&
  body !== null &&
  "environmentId" in body &&
  typeof body.environmentId === "string" &&
  body.environmentId !== "";

function acceptsEmptyArguments(tool: ListedTool | undefined): boolean {
  if (!tool || tool.inputSchema.type !== "object") return false;
  const required = tool.inputSchema.required;
  return !(Array.isArray(required) && required.length > 0);
}

async function readEnvironmentIdentity(client: Client): Promise<string | null> {
  const result = await client.callTool(
    { name: "t3_environment_read", arguments: {} },
    { timeout: 10_000 },
  );
  const body = toolContent(result);
  return !result.isError && hasEnvironmentIdentity(body) ? body.environmentId : null;
}

const isAuthorizationRejection = (error: unknown) =>
  error instanceof UnauthorizedError ||
  (error instanceof SdkHttpError && [401, 403].includes(error.status));

const isContractFailure = (error: unknown) =>
  error instanceof UnsupportedProtocolVersionError ||
  error instanceof ProtocolError ||
  (error instanceof SdkError &&
    [
      SdkErrorCode.InvalidResult,
      SdkErrorCode.UnsupportedResultType,
      SdkErrorCode.CapabilityNotSupported,
    ].includes(error.code));

/** What one adapter call's own requests met. The transport marks the current call, including an
 * OAuth refresh the SDK makes inside it, so concurrent calls never see each other's failures. */
interface CallRecord {
  unavailable: boolean;
}
const currentCall = new AsyncLocalStorage<CallRecord>();

/** An answer outside the MCP connection contract, which an inspection reports as incompatible. */
class ContractFailure extends T3Failure {
  constructor(message: string) {
    super("invalid-response", message);
  }
}

/** Classifies a call's failure once: other SDK failures mean T3 did not answer, and Factory's own
 * checks of T3's answers mean it answered outside the contract. */
function classifiedFailure(record: CallRecord, error: unknown): T3Failure {
  if (error instanceof T3Failure) return error;
  const message = error instanceof Error && error.message ? error.message : "T3 call failed.";
  if (record.unavailable) return new T3Failure("unavailable", message);
  if (isAuthorizationRejection(error)) return new T3Failure("authorization-required", message);
  if (isContractFailure(error)) return new ContractFailure(message);
  if (!(error instanceof SdkError)) return new T3Failure("invalid-response", message);
  return new T3Failure("unavailable", message);
}

/** Runs one adapter call with its own record; it rejects only with that call's classified failure. */
async function classifiedCall<A>(work: (record: CallRecord) => Promise<A>): Promise<A> {
  const record: CallRecord = { unavailable: false };
  try {
    return await currentCall.run(record, () => work(record));
  } catch (error) {
    throw classifiedFailure(record, error);
  }
}

/** T3 rejected the request without running it: its MCP session is gone (for example after a T3
 * restart) or the client closed before sending. Only then may the request be sent again. */
const isDeadConnection = (error: unknown) =>
  (error instanceof SdkHttpError && error.status === 404) ||
  (error instanceof SdkError && error.code === SdkErrorCode.NotConnected);

/** The one authorized MCP connection kept for an endpoint while its grant is unchanged. */
interface Connection {
  readonly client: Promise<Client>;
  /** Calls running on it now. */
  active: number;
  /** No longer handed out; it closes once `active` reaches zero. */
  retired: boolean;
}
const closeConnection = (connection: Connection) =>
  connection.client.then(
    (client) => client.close().catch(() => {}),
    () => {},
  );

const markCallUnavailable = () => {
  const record = currentCall.getStore();
  if (record) record.unavailable = true;
};

/** The SDK reads a reply's body after the fetch has returned, outside the transport. A body that
 * breaks off after its headers is a lost reply, so its read error marks the call that sent it. */
function marksLostBody(response: Response, record: CallRecord): Response {
  const source = response.body?.getReader();
  if (!source) return response;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await source.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch {
        record.unavailable = true;
        controller.error(new T3Failure("unavailable", "T3 request is temporarily unavailable."));
      }
    },
    cancel: (reason) => source.cancel(reason),
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

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
  tools: readonly ListedTool[],
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

/** OAuth files are endpoint-bound; only opaque grant lineage leaves this boundary. */
export class LiveT3Adapter implements T3Adapter {
  private readonly options: LiveT3Options;
  private callback: CallbackListener | undefined;
  private released: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private endpoint: string | undefined;
  private completing = false;
  private completion: Promise<void> | undefined;
  private readonly connections = new Map<string, Connection>();
  constructor(options: LiveT3Options) {
    this.options = options;
    mkdirSync(options.credentialsDirectory, { recursive: true, mode: 0o700 });
    chmodSync(options.credentialsDirectory, 0o700);
    // Theme colors once used a separately paired orchestration:read session; its stored token
    // has no use now, so Factory's copy is deleted. T3 keeps that session until it expires.
    for (const name of readdirSync(options.credentialsDirectory))
      if (/^t3-appearance-[0-9a-f]{64}\.json$/.test(name))
        removeCredentialFile(join(options.credentialsDirectory, name));
  }
  private path(endpoint: string) {
    return credentialPath(this.options.credentialsDirectory, "t3", endpoint);
  }
  private read(endpoint: string): Credentials {
    const data = readCredentialFile(this.path(endpoint)) as Credentials | undefined;
    if (!data) return { endpoint };
    if (data.endpoint !== endpoint) throw new Error("Credential endpoint mismatch");
    return data;
  }
  private save(data: Credentials) {
    writeCredentialFile(this.path(data.endpoint), data);
  }
  private provider(endpoint: string, interactive: boolean): OAuthClientProvider {
    const update = (change: (data: Credentials) => void) => {
      const data = this.read(endpoint);
      change(data);
      this.save(data);
    };
    const redirectUrl =
      this.read(endpoint).pending?.redirectUrl ??
      `http://127.0.0.1:${this.options.callbackPort ?? 43827}/callback`;
    return {
      redirectUrl,
      clientMetadata: {
        client_name: "T3 Factory",
        redirect_uris: [redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      state: () => {
        const state = randomUUID();
        update((data) => {
          data.state = state;
        });
        return state;
      },
      clientInformation: () => this.read(endpoint).client,
      saveClientInformation: (client) =>
        update((data) => {
          data.client = client;
        }),
      tokens: () => this.read(endpoint).tokens,
      // Refresh preserves grant lineage. A new code grant already has a new identity.
      saveTokens: (tokens) =>
        update((data) => {
          data.tokens = tokens;
          data.identity ??= randomUUID();
        }),
      discoveryState: () => this.read(endpoint).discovery,
      saveDiscoveryState: (discovery) =>
        update((data) => {
          data.discovery = discovery;
        }),
      saveCodeVerifier: (verifier) =>
        update((data) => {
          data.verifier = verifier;
        }),
      codeVerifier: () => {
        const verifier = this.read(endpoint).verifier;
        if (!verifier) throw new Error("Missing verifier");
        return verifier;
      },
      redirectToAuthorization: async (url) => {
        if (!interactive) throw new UnauthorizedError("Explicit approval required");
        update((data) => {
          if (data.pending) data.pending.authorizationUrl = url.href;
        });
        try {
          await (this.options.openBrowser ?? browser)(url.href);
        } catch {
          update((data) => {
            data.reason = "browser-unavailable";
          });
          throw new UnauthorizedError("Backend browser unavailable");
        }
      },
      invalidateCredentials: (scope) =>
        update((data) => {
          if (scope === "all") {
            const pending = data.pending;
            for (const key of Object.keys(data) as (keyof Credentials)[])
              if (key !== "endpoint") delete data[key];
            if (pending) data.pending = pending;
            data.identity = randomUUID();
          } else if (scope === "tokens") delete data.tokens;
          else if (scope === "client") {
            delete data.client;
            delete data.tokens;
            data.identity = randomUUID();
          } else if (scope === "verifier") delete data.verifier;
          else if (scope === "discovery") delete data.discovery;
        }),
    };
  }
  private transport(endpoint: string, provider?: OAuthClientProvider) {
    return new StreamableHTTPClientTransport(new URL(endpoint), {
      ...(provider ? { authProvider: provider } : {}),
      fetch: async (input, init) => {
        // The standalone event stream lives as long as the reused connection; a timeout would only
        // make the SDK reopen it again and again. Requests and OAuth discovery keep the timeout.
        const stream =
          init?.method === "GET" &&
          new Headers(init.headers).get("accept")?.includes("text/event-stream");
        let response: Response;
        try {
          response = await fetch(input, {
            ...init,
            signal: AbortSignal.any([
              ...(init?.signal ? [init.signal] : []),
              ...(stream ? [] : [AbortSignal.timeout(10_000)]),
            ]),
          });
        } catch {
          markCallUnavailable();
          // SDK refresh warnings include error messages. Never let URLs/bodies reach them.
          throw new T3Failure("unavailable", "T3 request is temporarily unavailable.");
        }
        if (response.status >= 500) markCallUnavailable();
        if (response.ok || response.status === 405) {
          const record = currentCall.getStore();
          return stream || !record ? response : marksLostBody(response, record);
        }
        // The SDK logs OAuth error descriptions verbatim. Keep only a fixed OAuth error code.
        const safeCodes = new Set([
          "invalid_grant",
          "invalid_client",
          "unauthorized_client",
          "invalid_scope",
          "access_denied",
          "server_error",
          "temporarily_unavailable",
          "unsupported_grant_type",
          "invalid_request",
          "invalid_dpop_proof",
        ]);
        let code = "server_error";
        try {
          const body = (await response.json()) as { error?: unknown };
          if (typeof body.error === "string" && safeCodes.has(body.error)) code = body.error;
        } catch {
          /* Discard raw body. */
        }
        return new Response(JSON.stringify({ error: code }), {
          status: response.status,
          headers: response.headers,
        });
      },
    });
  }
  private stopCallback() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.releaseCallback();
  }
  /** Stops accepting callbacks now; the port is free once `released` settles. */
  private releaseCallback() {
    const listener = this.callback;
    this.callback = undefined;
    if (!listener) return;
    const previous = this.released;
    this.released = listener.close().then(
      () => previous,
      () => previous,
    );
  }
  private expire(endpoint: string, reason: T3ConnectionReason) {
    const data = this.read(endpoint);
    delete data.pending;
    delete data.state;
    delete data.verifier;
    delete data.tokens;
    data.reason = reason;
    this.save(data);
    void this.dropConnection(endpoint);
    this.stopCallback();
  }
  private async listen(endpoint: string, port: number): Promise<string> {
    if (this.callback) return this.read(endpoint).pending!.redirectUrl;
    await this.released;
    const listener = await listenOAuthCallback(port, (request) =>
      this.answerCallback(endpoint, request),
    );
    this.callback = listener;
    const remaining = (this.read(endpoint).pending?.expiresAt ?? Date.now() + 600_000) - Date.now();
    this.timer = setTimeout(
      () => this.expire(endpoint, "approval-expired"),
      Math.max(1, remaining),
    );
    this.timer.unref();
    return listener.redirectUrl;
  }
  private async answerCallback(endpoint: string, request: CallbackRequest): Promise<CallbackReply> {
    const { url } = request;
    const data = this.read(endpoint);
    const state = url.searchParams.get("state");
    if (
      request.method !== "GET" ||
      url.pathname !== "/callback" ||
      this.completing ||
      !data.pending ||
      data.pending.expiresAt <= Date.now() ||
      !data.state ||
      !state ||
      !equalState(data.state, state)
    ) {
      return { status: 400, body: "Invalid or expired OAuth callback." };
    }
    if (!url.searchParams.get("code") || url.searchParams.has("error")) {
      this.expire(endpoint, "approval-expired");
      return {
        status: 400,
        body: "Authorization was not granted. Return to Factory and authorize again.",
      };
    }
    this.completing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    // Claim the callback durably. State/verifier/discovery stay private until exchange completes.
    delete data.state;
    this.save(data);
    const completion = this.completeAuthorization(endpoint, url.searchParams);
    this.completion = completion.then(() => {});
    return completion;
  }
  private async completeAuthorization(
    endpoint: string,
    params: URLSearchParams,
  ): Promise<CallbackReply> {
    const transport = this.transport(endpoint, this.provider(endpoint, false));
    try {
      await transport.finishAuth(params);
      const complete = this.read(endpoint);
      delete complete.pending;
      delete complete.state;
      delete complete.verifier;
      delete complete.reason;
      this.save(complete);
      // Calls continue with the new grant, never on the previous grant's connection.
      await this.dropConnection(endpoint);
      return {
        status: 200,
        body: "T3 authorization complete. Return to Factory; it will recheck automatically.",
      };
    } catch {
      const failed = this.read(endpoint);
      delete failed.pending;
      delete failed.state;
      delete failed.verifier;
      delete failed.tokens;
      failed.reason = "approval-expired";
      this.save(failed);
      return {
        status: 400,
        body: "Authorization could not complete. Return to Factory and authorize again.",
      };
    } finally {
      this.completing = false;
      await transport.close().catch(() => {});
      // Stop listening without waiting: the reply above still has to flush through this listener.
      this.stopCallback();
    }
  }
  authorize(target: T3Endpoint) {
    return classifiedCall(() => this.startAuthorization(target.endpoint));
  }
  private async startAuthorization(endpoint: string) {
    await this.completion;
    this.stopCallback();
    this.changeEndpoint(endpoint);
    const data = this.read(endpoint);
    delete data.tokens;
    delete data.state;
    delete data.verifier;
    delete data.reason;
    // Rediscover on explicit reauthorization; issuer changes cannot reuse stale client registration.
    delete data.discovery;
    delete data.client;
    data.identity = randomUUID();
    data.pending = {
      expiresAt: Date.now() + 600_000,
      redirectUrl: `http://127.0.0.1:${this.options.callbackPort ?? 43827}/callback`,
    };
    this.save(data);
    await this.dropConnection(endpoint);
    try {
      data.pending.redirectUrl = await this.listen(endpoint, this.options.callbackPort ?? 43827);
      this.save(data);
    } catch {
      this.expire(endpoint, "callback-unavailable");
      return;
    }
    const transport = this.transport(endpoint, this.provider(endpoint, true));
    const client = new Client({ name: "t3-factory", version: "0.0.0" });
    try {
      await client.connect(transport, { timeout: 10_000 });
      // No OAuth challenge is not evidence of an approved identity.
      if (!this.read(endpoint).tokens) this.expire(endpoint, "approval-required");
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) {
        this.expire(endpoint, "approval-required");
        throw error;
      }
      if (this.read(endpoint).reason === "browser-unavailable")
        this.expire(endpoint, "browser-unavailable");
    } finally {
      await client.close().catch(() => {});
    }
  }
  resumeAuthorization(target: T3Endpoint): Promise<AuthorizationResumption> {
    return classifiedCall(() => this.reopenAuthorization(target.endpoint));
  }
  private async reopenAuthorization(endpoint: string): Promise<AuthorizationResumption> {
    await this.completion;
    if (this.endpoint !== endpoint) this.stopCallback();
    this.changeEndpoint(endpoint);
    // A resumed authorization ends with a different grant; no call keeps the current connection.
    await this.dropConnection(endpoint);
    // Consent may finish after the caller inspected pending status. Preserve that grant.
    if (this.read(endpoint).tokens) return "completing";
    const pending = await this.resumePendingApproval(endpoint);
    if (this.completing) return "completing";
    // An expired, denied, completed or unbound attempt is gone; only a new attempt can follow.
    if (pending?.reason !== "approval-pending") return "none";
    const data = this.read(endpoint);
    // A claimed state means the callback arrived; its exchange decides the outcome.
    if (!data.state) return "completing";
    // Attempts saved before the page address was kept cannot be reopened.
    const page = data.pending?.authorizationUrl;
    if (!page) {
      // Retire an old, un-reopenable attempt synchronously before offering a new one.
      // Otherwise its callback could succeed between returning and starting authorization.
      this.expire(endpoint, "approval-expired");
      return "none";
    }
    try {
      await (this.options.openBrowser ?? browser)(page);
    } catch {
      throw new T3Failure("unavailable", "Backend browser unavailable");
    }
    return "reopened";
  }
  inspect(target: T3Endpoint): Promise<T3Inspection> {
    return classifiedCall(async (record) => {
      const inspection = await this.inspectEndpoint(target.endpoint, record);
      return { ...inspection, support: await this.support(target.endpoint, inspection) };
    });
  }
  /** Replay scopes are asked for only when the answer they would qualify is supported. A proof
   * that cannot be established leaves only that answer unknown, never the whole inspection. */
  private async support(endpoint: string, inspection: Inspected): Promise<T3Support> {
    const support = contractSupport(inspection.state === "ready", inspection.contract?.tools ?? []);
    const { checkout, worktree } = support.launch;
    /** undefined: the proof was asked for and could not be established. */
    const proven = async (proof: LiveT3Options["launchRecoveryScope"]) => {
      try {
        return (await proof?.(endpoint)) ?? null;
      } catch {
        return undefined;
      }
    };
    // A supported worktree launch implies a supported checkout launch.
    const launchScope = checkout.supported ? await proven(this.options.launchRecoveryScope) : null;
    const sendScope = support.send.supported ? await proven(this.options.sendRecoveryScope) : null;
    const scoped = (answer: LaunchSupport, retryScope: string | null | undefined) =>
      !answer.supported
        ? answer
        : retryScope === undefined
          ? { supported: false, retryScope: null, explanation: null }
          : { ...answer, retryScope };
    return {
      ...support,
      launch: { checkout: scoped(checkout, launchScope), worktree: scoped(worktree, launchScope) },
      send: scoped(support.send, sendScope),
    };
  }
  private async inspectEndpoint(endpoint: string, record: CallRecord): Promise<Inspected> {
    if (this.endpoint !== endpoint) {
      await this.completion;
      this.stopCallback();
      this.changeEndpoint(endpoint);
    }
    const pending = await this.resumePendingApproval(endpoint);
    if (pending) return pending;
    const latest = this.read(endpoint);
    if (!latest.tokens) return this.inspectWithoutGrant(endpoint, latest.reason, record);
    let client: Client | undefined;
    try {
      return await this.onConnection(endpoint, (connected) => {
        client = connected;
        return this.inspectContract(endpoint, connected);
      });
    } catch (error) {
      return this.inspectionFailure(
        endpoint,
        latest.reason,
        serverIdentity(client),
        classifiedFailure(record, error),
      );
    }
  }
  /** Without a grant there is nothing to reuse: the probe's own connection never becomes the
   * authorized one. */
  private async inspectWithoutGrant(
    endpoint: string,
    previousReason: T3ConnectionReason | undefined,
    record: CallRecord,
  ): Promise<Inspected> {
    const client = new Client({ name: "t3-factory", version: "0.0.0" });
    try {
      await client.connect(this.transport(endpoint), { timeout: 10_000 });
      return await this.inspectContract(endpoint, client);
    } catch (error) {
      return this.inspectionFailure(
        endpoint,
        previousReason,
        serverIdentity(client),
        classifiedFailure(record, error),
      );
    } finally {
      await client.close().catch(() => {});
    }
  }
  /** Keeps a pending approval's callback listening; an expired approval falls through to inspection. */
  private async resumePendingApproval(endpoint: string): Promise<Inspected | undefined> {
    const pending = this.read(endpoint).pending;
    if (!pending) return undefined;
    if (pending.expiresAt <= Date.now()) {
      this.expire(endpoint, "approval-expired");
      return undefined;
    }
    try {
      await this.listen(endpoint, Number(new URL(pending.redirectUrl).port));
    } catch {
      this.expire(endpoint, "callback-unavailable");
      return { state: "authorization-required", reason: "callback-unavailable" };
    }
    return { state: "authorization-required", reason: "approval-pending" };
  }
  private async inspectContract(endpoint: string, client: Client): Promise<Inspected> {
    const tools = await listAllTools(
      client,
      () => new SdkError(SdkErrorCode.InvalidResult, "Invalid tool pagination"),
    );
    const problems: string[] = [];
    let environmentId: string | null = null;
    if (!acceptsEmptyArguments(tools.find((tool) => tool.name === "t3_environment_read"))) {
      problems.push("t3_environment_read must accept an empty object.");
    } else {
      environmentId = await readEnvironmentIdentity(client);
      if (!environmentId)
        problems.push("t3_environment_read did not return an environment identity.");
    }
    const credentials = this.read(endpoint);
    if (!credentials.tokens || !credentials.identity)
      problems.push("An approved OAuth grant is required to bind authorization context.");
    return {
      state: problems.length ? "incompatible" : "ready",
      reason: problems.length ? "contract-missing" : "connected",
      ...(credentials.identity ? { authorizationIdentity: credentials.identity } : {}),
      contract: {
        ...serverIdentity(client),
        environmentId,
        tools,
        problems,
        executionVerified: false,
      },
    };
  }
  /** Rejected grants require reauthorization and contract failures are incompatible; anything else
   * throws. A rejection after this call met a transient failure, such as a token refresh answered
   * with a server error, keeps the grant. */
  private inspectionFailure(
    endpoint: string,
    previousReason: T3ConnectionReason | undefined,
    server: ReturnType<typeof serverIdentity>,
    failure: T3Failure,
  ): Inspected {
    if (failure.kind === "unavailable")
      throw new T3Failure("unavailable", "T3 is temporarily unavailable.");
    if (failure.kind === "authorization-required") {
      const revoked = this.read(endpoint);
      delete revoked.tokens;
      delete revoked.discovery;
      delete revoked.state;
      delete revoked.verifier;
      revoked.reason = previousReason ?? "approval-required";
      this.save(revoked);
      void this.dropConnection(endpoint);
      return { state: "authorization-required", reason: previousReason ?? "approval-required" };
    }
    if (!(failure instanceof ContractFailure)) throw failure;
    return {
      state: "incompatible",
      reason: "contract-missing",
      contract: {
        ...server,
        environmentId: null,
        tools: [],
        problems: ["T3 returned an unsupported MCP protocol or invalid connection contract."],
        executionVerified: false,
      },
    };
  }
  private structuredToolResult(result: ToolResult): unknown {
    if (result.isError) throw new T3Failure("refused", "T3 tool returned isError");
    const content = toolContent(result);
    if (content === undefined) throw new Error("T3 tool returned no structured JSON");
    return content;
  }
  /** The endpoint's connection with the saved grant, opened once and shared by concurrent callers.
   * The handshake runs as its own call, so every waiter receives the same classified failure. */
  private connection(endpoint: string): Connection {
    const existing = this.connections.get(endpoint);
    if (existing) return existing;
    const client = new Client({ name: "t3-factory", version: "0.0.0" });
    const connection: Connection = {
      client: classifiedCall(async () => {
        await client.connect(this.transport(endpoint, this.provider(endpoint, false)), {
          timeout: 10_000,
        });
        return client;
      }),
      active: 0,
      retired: false,
    };
    this.connections.set(endpoint, connection);
    connection.client.catch(() => this.retire(endpoint, connection));
    return connection;
  }
  /** Closes the endpoint's connection now; its in-flight requests fail and nothing reuses it. */
  private dropConnection(endpoint: string): Promise<void> {
    const connection = this.connections.get(endpoint);
    if (!connection) return Promise.resolve();
    this.connections.delete(endpoint);
    connection.retired = true;
    return closeConnection(connection);
  }
  /** Stops handing out a connection T3 no longer knows. Requests already on it keep their own
   * answers, so it closes once they finish. */
  private retire(endpoint: string, connection: Connection) {
    if (this.connections.get(endpoint) === connection) this.connections.delete(endpoint);
    connection.retired = true;
    if (connection.active === 0) void closeConnection(connection);
  }
  private changeEndpoint(endpoint: string) {
    if (this.endpoint !== endpoint)
      for (const previous of this.connections.keys()) void this.dropConnection(previous);
    this.endpoint = endpoint;
  }
  /** Runs `action` on the reused connection. A connection T3 no longer knows is replaced once and
   * the action sent again: T3 ran none of it. Any other failure is reported as it is, so an
   * action T3 may have executed is never repeated. */
  private async onConnection<A>(
    endpoint: string,
    action: (client: Client) => Promise<A>,
  ): Promise<A> {
    const connection = this.connection(endpoint);
    try {
      return await this.use(connection, action);
    } catch (error) {
      if (!isDeadConnection(error)) throw error;
      this.retire(endpoint, connection);
      return this.use(this.connection(endpoint), action);
    }
  }
  private async use<A>(connection: Connection, action: (client: Client) => Promise<A>): Promise<A> {
    const client = await connection.client;
    connection.active++;
    try {
      return await action(client);
    } finally {
      connection.active--;
      if (connection.retired && connection.active === 0) void closeConnection(connection);
    }
  }
  private withAuthorizedClient<A>(
    target: T3Endpoint,
    action: (client: Client) => Promise<A>,
  ): Promise<A> {
    return classifiedCall(async () => {
      await this.completion;
      const latest = this.read(target.endpoint);
      if (!latest.tokens)
        throw new T3Failure("authorization-required", "T3 authorization is required.");
      return this.onConnection(target.endpoint, action);
    });
  }
  /** The upload URL is a signed capability on the MCP origin: it is sent without the OAuth bearer
   * and never logged or included in errors. */
  async uploadAttachment(
    target: T3Endpoint,
    upload: AttachmentUpload,
    data: Uint8Array,
  ): Promise<string> {
    const prepared = await this.withAuthorizedClient(target, async (client) =>
      this.structuredToolResult(
        await client.callTool(
          {
            name: "t3_attachment_prepare_upload",
            arguments: { upload: { type: "image", ...upload } },
          },
          { timeout: 30_000 },
        ),
      ),
    ).catch((error: T3Failure) => {
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
    return this.withAuthorizedClient(target, async (client) => {
      const result = await client.callTool(
        { name: "t3_thread_launch", arguments: { ...payload } },
        { timeout: 30_000 },
      );
      if (result.isError) throw new T3Failure("refused", "T3 rejected the worker launch");
      const body = this.structuredToolResult(result) as LaunchReference | undefined;
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
      return await this.withAuthorizedClient(target, async (client) =>
        discoverLaunches(
          async (name, args) =>
            this.structuredToolResult(
              await client.callTool({ name, arguments: args }, { timeout: 30_000 }),
            ),
          target.projectId,
          title,
        ),
      );
    } catch {
      return { available: false };
    }
  }
  async readThreadIdentity(target: T3Target, threadId: string): Promise<ThreadIdentityRead> {
    return this.withAuthorizedClient(target, async (client) =>
      threadIdentityRead(
        this.structuredToolResult(
          await client.callTool(
            { name: "t3_thread_read", arguments: { threadId, runLimit: 50 } },
            { timeout: 30_000 },
          ),
        ),
        threadId,
      ),
    );
  }
  async settleThread(target: T3Endpoint, payload: { threadId: string }) {
    await this.withAuthorizedClient(target, async (client) => {
      const result = await client.callTool(
        { name: "t3_thread_organize", arguments: { threadId: payload.threadId, action: "settle" } },
        { timeout: 10_000 },
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
    return this.withAuthorizedClient(target, async (client) => {
      const body = this.structuredToolResult(
        await client.callTool(
          { name: "t3_thread_send", arguments: { ...payload } },
          { timeout: 30_000 },
        ),
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
    await this.withAuthorizedClient(target, async (client) => {
      const result = await client.callTool(
        { name: "t3_thread_interrupt", arguments: { ...payload, stop: true } },
        { timeout: 30_000 },
      );
      if (result.isError) throw new T3Failure("refused", "Thread Stop outcome unresolved");
    });
  }
  async readExecution(target: T3Endpoint, threadId: string): Promise<ExecutionObservation> {
    return this.withAuthorizedClient(target, async (client) => {
      const body = this.structuredToolResult(
        await client.callTool(
          {
            name: "t3_thread_read",
            arguments: { threadId, limit: 1, maxCharsPerItem: 1, runLimit: 50 },
          },
          { timeout: 10_000 },
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
    return this.withAuthorizedClient(target, async (client) => {
      const body = this.structuredToolResult(
        await client.callTool({ name: "t3_environment_read", arguments: {} }, { timeout: 10_000 }),
      );
      if (!hasEnvironmentIdentity(body))
        throw new Error("t3_environment_read did not return an environment identity.");
      const label =
        "label" in body && typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : body.environmentId;
      return { environmentId: body.environmentId, label };
    });
  }
  async readTheme(target: T3Endpoint) {
    return this.withAuthorizedClient(target, async (client) => {
      const tools = await listAllTools(client, () => new Error("Invalid pagination"));
      if (!tools.some((tool) => tool.name === "t3_theme_read")) return null;
      const read = async (args: Record<string, string>) =>
        this.structuredToolResult(
          await client.callTool({ name: "t3_theme_read", arguments: args }, { timeout: 10_000 }),
        );
      const environmentId = await readEnvironmentIdentity(client);
      const listing = themeListing(await read({}));
      const file = listing.published.includes(listing.defaultTheme)
        ? await read({ themeId: listing.defaultTheme })
        : null;
      return themeRead(environmentId, listing, file);
    });
  }
  async orchestratorCapabilities(target: T3Endpoint): Promise<readonly T3ProviderCapability[]> {
    return this.withAuthorizedClient(target, async (client) =>
      parseProviderCapabilities(
        this.structuredToolResult(
          await client.callTool(
            { name: "orchestrator_capabilities", arguments: {} },
            {
              timeout: 15_000,
            },
          ),
        ),
      ),
    );
  }
  /** Every Project call first checks that T3 still lists both Project tools as Factory uses them. */
  private withProjectContract<A>(
    target: T3Endpoint,
    action: (client: Client) => Promise<A>,
  ): Promise<A> {
    return this.withAuthorizedClient(target, async (client) => {
      const tools = await listAllTools(client, () => new Error("Invalid pagination"));
      for (const [name, fields] of PROJECT_TOOL_FIELDS)
        if (!supportsProjectTool(tools, name, fields))
          throw new T3Failure("refused", "Unsupported project contract");
      return action(client);
    });
  }
  private async projectCall(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await client.callTool({ name, arguments: args }, { timeout: 10_000 });
    if (result.isError) throw new T3Failure("refused", "T3 project operation failed.");
    const content = toolContent(result);
    if (content === undefined) throw new Error("Invalid project result.");
    return content;
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
    return this.withProjectContract(target, async (client) => {
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
        const page = await this.projectPage(client, target.environmentId, cursor);
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
    client: Client,
    environmentId: string,
    cursor: number | undefined,
  ): Promise<{ projects: unknown[]; nextCursor: number | null }> {
    const body = (await this.projectCall(client, "t3_project_list", {
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
    return this.withProjectContract(target, async (client) => {
      const value = await this.projectCall(client, "t3_project_create", {
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
        this.withAuthorizedClient(target, async (client) =>
          this.structuredToolResult(
            await client.callTool({ name: "t3_thread_wait", arguments: args }, { timeout: 10_000 }),
          ),
        ),
      threadId,
      runId,
    );
  }
  async close() {
    await this.completion;
    this.stopCallback();
    await Promise.all(
      [...this.connections.keys()].map((endpoint) => this.dropConnection(endpoint)),
    );
    await this.released;
  }
}
