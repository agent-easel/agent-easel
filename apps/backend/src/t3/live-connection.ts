import { AsyncLocalStorage } from "node:async_hooks";
import { chmodSync, mkdirSync, readdirSync } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  credentialPath,
  readCredentialFile,
  removeCredentialFile,
  writeCredentialFile,
} from "../adapters/credential-files.ts";
import {
  Client,
  InMemoryResponseCacheStore,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  UnsupportedProtocolVersionError,
  SdkHttpError,
  SdkError,
  SdkErrorCode,
  ProtocolError,
  type JsonSchemaType,
  type JsonSchemaValidator,
  type ListToolsResult,
  type OAuthClientProvider,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/client";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import {
  T3Failure,
  isApprovalPending,
  type AuthorizationResumption,
  type DispatchFence,
  type T3Authorization,
  type T3Calls,
  type T3ConnectionReason,
  type T3Endpoint,
  type T3ListedTool,
  type T3Probe,
  type T3ServerIdentity,
  type T3Session,
} from "./connection.ts";
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
  /**
   * The approval attempt waiting for consent; a restarted backend resumes it from here.
   * `authorizationUrl` lets the host reopen the same consent page; it never leaves this file.
   * `reopenFailed`: the host's browser could not open that page again.
   */
  pending?: {
    expiresAt: number;
    redirectUrl: string;
    authorizationUrl?: string;
    reopenFailed?: true;
  };
  reason?: T3ConnectionReason;
};
export interface LiveT3ConnectionOptions {
  readonly credentialsDirectory: string;
  readonly callbackPort?: number;
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

function firstToolText(result: ToolResult) {
  for (const item of result.content) if (item.type === "text" && item.text) return item.text;
  return undefined;
}

/** Collects every tools/list page; repeated or runaway cursors fail with `invalidPagination`. */
async function listAllTools(
  client: Client,
  invalidPagination: () => Error,
): Promise<T3ListedTool[]> {
  const tools: T3ListedTool[] = [];
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

const session = (client: Client, invalidPagination: () => Error): T3Session => ({
  tools: () => listAllTools(client, invalidPagination),
  call: async (name, args, timeout) => {
    const result = await client.callTool({ name, arguments: args }, { timeout });
    const text = firstToolText(result);
    return {
      isError: Boolean(result.isError),
      content: toolContent(result),
      ...(text !== undefined ? { text } : {}),
    };
  },
});
/** An inspection answers an invalid catalog as a contract failure. */
const inspectedSession = (client: Client) =>
  session(client, () => new SdkError(SdkErrorCode.InvalidResult, "Invalid tool pagination"));
const authorizedSession = (client: Client) =>
  session(client, () => new Error("Invalid pagination"));

const serverIdentity = (client: Client | undefined): T3ServerIdentity => {
  const server = client?.getServerVersion();
  return { serverName: server?.name ?? "Unknown", serverVersion: server?.version ?? "Unknown" };
};

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

/** What one T3 call's own requests met. The transport marks the current call, including an
 * OAuth refresh the SDK makes inside it, so concurrent calls never see each other's failures. */
interface CallRecord {
  unavailable: boolean;
  fence?: DispatchFence;
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

/** Runs one T3 call with its own record; it rejects only with that call's classified failure. */
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

function connectedT3Client(): Client {
  let validators = new Map<string, JsonSchemaValidator<unknown> | undefined>();
  const responseCacheStore = new (class extends InMemoryResponseCacheStore {
    override set(...args: Parameters<InMemoryResponseCacheStore["set"]>): number {
      const [key, entry] = args;
      if (key.method === "tools/list" && this.get(key)?.value !== entry.value) {
        // The SDK stores the completed, decoded catalog before compiling its validators.
        const catalog = JSON.parse(entry.value) as ListToolsResult;
        const current = new Map<string, JsonSchemaValidator<unknown> | undefined>();
        for (const { outputSchema } of catalog.tools) {
          if (outputSchema === undefined) continue;
          const schemaKey = JSON.stringify(outputSchema);
          current.set(schemaKey, validators.get(schemaKey));
        }
        validators = current;
      }
      return super.set(...args);
    }
  })();
  return new Client(
    { name: "t3-factory", version: "0.0.0" },
    {
      responseCacheStore,
      jsonSchemaValidator: {
        getValidator<T>(schema: JsonSchemaType): JsonSchemaValidator<T> {
          const key = JSON.stringify(schema);
          const cached = validators.get(key);
          if (cached) return cached as JsonSchemaValidator<T>;
          // A fresh AJV instance allows a changed schema to keep its previous $id.
          const validator = new AjvJsonSchemaValidator().getValidator<T>(schema);
          // A call already reading the previous catalog must not put a retired schema back.
          if (validators.has(key)) validators.set(key, validator);
          return validator;
        },
      },
    },
  );
}

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

/** OAuth files are endpoint-bound; only opaque grant lineage leaves this boundary. */
export class LiveT3Connection implements T3Authorization, T3Calls {
  private readonly options: LiveT3ConnectionOptions;
  private callback: CallbackListener | undefined;
  private released: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private endpoint: string | undefined;
  private completing = false;
  private completion: Promise<void> | undefined;
  private readonly connections = new Map<string, Connection>();
  constructor(options: LiveT3ConnectionOptions) {
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
  private dispatchCredentials(endpoint: string) {
    const credentials = this.read(endpoint);
    const fence = currentCall.getStore()?.fence;
    if (fence && (fence.signal.aborted || credentials.identity !== fence.authorizationIdentity))
      throw new T3Failure("authorization-required", "The dispatch authorization has expired.");
    return credentials;
  }
  private save(data: Credentials) {
    writeCredentialFile(this.path(data.endpoint), data);
  }
  private provider(endpoint: string, interactive: boolean): OAuthClientProvider {
    const update = (change: (data: Credentials) => void) => {
      const data = this.dispatchCredentials(endpoint);
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
      tokens: () => this.dispatchCredentials(endpoint).tokens,
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
  private async fetchRequest(
    endpoint: string,
    input: Parameters<typeof fetch>[0],
    init: RequestInit | undefined,
    stream: boolean,
  ) {
    const fence = currentCall.getStore()?.fence;
    const toolCall =
      fence &&
      init?.method === "POST" &&
      typeof init.body === "string" &&
      new URL(input instanceof Request ? input.url : input).href === new URL(endpoint).href &&
      JSON.parse(init.body).method === "tools/call";
    if (fence && !toolCall) this.dispatchCredentials(endpoint);
    if (toolCall) {
      if (!(await fence.authorizeDispatch())) throw new T3Failure("refused", "Dispatch cancelled.");
      try {
        this.dispatchCredentials(endpoint);
      } catch (error) {
        await fence.refuseDispatch();
        throw error;
      }
    }
    try {
      const response = await fetch(input, {
        ...init,
        signal: AbortSignal.any([
          ...(init?.signal ? [init.signal] : []),
          ...(fence ? [fence.signal] : []),
          ...(stream ? [] : [AbortSignal.timeout(10_000)]),
        ]),
      });
      if (toolCall && [401, 403, 404].includes(response.status)) await fence.refuseDispatch();
      return response;
    } catch {
      markCallUnavailable();
      // SDK refresh warnings include error messages. Never let URLs/bodies reach them.
      throw new T3Failure("unavailable", "T3 request is temporarily unavailable.");
    }
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
        const response = await this.fetchRequest(endpoint, input, init, !!stream);
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
    if (!pending || !isApprovalPending(pending.reason)) return "none";
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
      this.markReopen(endpoint, true);
      throw new T3Failure("unavailable", "Backend browser unavailable");
    }
    this.markReopen(endpoint, false);
    return "reopened";
  }
  probe<A, B>(
    target: T3Endpoint,
    read: (session: T3Session) => Promise<A>,
    finish: (probe: T3Probe<A>) => Promise<B>,
  ): Promise<B> {
    return classifiedCall(async (record) =>
      finish(await this.probeEndpoint(target.endpoint, read, record)),
    );
  }
  private async probeEndpoint<A>(
    endpoint: string,
    read: (session: T3Session) => Promise<A>,
    record: CallRecord,
  ): Promise<T3Probe<A>> {
    if (this.endpoint !== endpoint) {
      await this.completion;
      this.stopCallback();
      this.changeEndpoint(endpoint);
    }
    const pending = await this.resumePendingApproval(endpoint);
    if (pending) return pending;
    const latest = this.read(endpoint);
    if (!latest.tokens) return this.probeWithoutGrant(endpoint, read, latest.reason, record);
    let client: Client | undefined;
    try {
      return await this.onConnection(endpoint, (connected) => {
        client = connected;
        return this.answer(endpoint, connected, read);
      });
    } catch (error) {
      return this.probeFailure(
        endpoint,
        latest.reason,
        serverIdentity(client),
        classifiedFailure(record, error),
      );
    }
  }
  /** Without a grant there is nothing to reuse: the probe's own connection never becomes the
   * authorized one. */
  private async probeWithoutGrant<A>(
    endpoint: string,
    read: (session: T3Session) => Promise<A>,
    previousReason: T3ConnectionReason | undefined,
    record: CallRecord,
  ): Promise<T3Probe<A>> {
    const client = new Client({ name: "t3-factory", version: "0.0.0" });
    try {
      await client.connect(this.transport(endpoint), { timeout: 10_000 });
      return await this.answer(endpoint, client, read);
    } catch (error) {
      return this.probeFailure(
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
  private async resumePendingApproval(
    endpoint: string,
  ): Promise<{ status: "authorization-required"; reason: T3ConnectionReason } | undefined> {
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
      return { status: "authorization-required", reason: "callback-unavailable" };
    }
    return {
      status: "authorization-required",
      reason: pending.reopenFailed ? "approval-reopen-failed" : "approval-pending",
    };
  }
  /** Records on the pending attempt whether its page could be opened again. */
  private markReopen(endpoint: string, failed: boolean) {
    const data = this.read(endpoint);
    if (!data.pending) return;
    if (failed) data.pending.reopenFailed = true;
    else delete data.pending.reopenFailed;
    this.save(data);
  }
  private async answer<A>(
    endpoint: string,
    client: Client,
    read: (session: T3Session) => Promise<A>,
  ): Promise<T3Probe<A>> {
    const answer = await read(inspectedSession(client));
    const credentials = this.read(endpoint);
    return {
      status: "answered",
      answer,
      server: serverIdentity(client),
      authorizationIdentity: credentials.identity,
      approved: Boolean(credentials.tokens && credentials.identity),
    };
  }
  /** Rejected grants require reauthorization and contract failures are reported; anything else
   * throws. A rejection after this call met a transient failure, such as a token refresh answered
   * with a server error, keeps the grant. */
  private probeFailure(
    endpoint: string,
    previousReason: T3ConnectionReason | undefined,
    server: T3ServerIdentity,
    failure: T3Failure,
  ): T3Probe<never> {
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
      return { status: "authorization-required", reason: previousReason ?? "approval-required" };
    }
    if (!(failure instanceof ContractFailure)) throw failure;
    return { status: "contract-failure", server };
  }
  /** The endpoint's connection with the saved grant, opened once and shared by concurrent callers.
   * The handshake runs as its own call, so every waiter receives the same classified failure. */
  private connection(endpoint: string): Connection {
    const existing = this.connections.get(endpoint);
    if (existing) return existing;
    const client = connectedT3Client();
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
  authorized<A>(
    target: T3Endpoint,
    action: (session: T3Session) => Promise<A>,
    fence?: DispatchFence,
  ): Promise<A> {
    return classifiedCall(async (record) => {
      if (fence) record.fence = fence;
      await this.completion;
      const latest = this.read(target.endpoint);
      if (!latest.tokens || (fence && latest.identity !== fence.authorizationIdentity))
        throw new T3Failure("authorization-required", "T3 authorization is required.");
      return this.onConnection(target.endpoint, (client) => action(authorizedSession(client)));
    });
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
