import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomUUID } from "node:crypto";

type ToolHandler = (args: Record<string, unknown>) => unknown;

/** Only the project tools read their arguments; every other tool receives them untouched. */
interface ToolArguments extends Record<string, unknown> {
  readonly cursor?: number;
  readonly title?: string;
  readonly workspaceRoot?: string;
  readonly createWorkspaceRootIfMissing?: boolean;
}

interface McpRequest {
  readonly id?: string | number;
  readonly method: string;
  readonly params?: {
    readonly protocolVersion: string;
    readonly cursor?: string;
    readonly name: string;
    readonly arguments: ToolArguments;
  };
}

interface Rejection {
  readonly status: number;
  readonly body: unknown;
}
const invalidGrant: Rejection = { status: 400, body: { error: "invalid_grant" } };

function json(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { ...headers, "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function requestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** A handler may answer later; one that throws drops its own request's connection. */
const structuredTool = (tool: ToolHandler | undefined) =>
  tool && (async (args: ToolArguments) => ({ content: [], structuredContent: await tool(args) }));

/** Controlled external OAuth/MCP HTTP boundary; synthetic credentials exist only in memory. */
export async function oauthT3(
  options: {
    projects?: boolean;
    launch?: (args: Record<string, unknown>) => unknown;
    launchSchema?: Record<string, unknown>;
    send?: (args: Record<string, unknown>) => unknown;
    sendSchema?: Record<string, unknown>;
    queueSchema?: Record<string, unknown>;
    interruptSchema?: Record<string, unknown>;
    organizeSchema?: Record<string, unknown>;
    organize?: (args: Record<string, unknown>) => unknown;
    interrupt?: (args: Record<string, unknown>) => unknown;
    queue?: (args: Record<string, unknown>) => unknown;
    threads?: (args: Record<string, unknown>) => unknown;
    wait?: (args: Record<string, unknown>) => unknown;
    readSchema?: Record<string, unknown>;
    runtimeActivity?: (args: Record<string, unknown>) => unknown;
    capabilities?: (args: Record<string, unknown>) => unknown;
    /** `t3_attachment_prepare_upload` and its signed upload route on this origin. */
    attachments?: boolean;
    themeRead?: (args: Record<string, unknown>) => unknown;
  } = {},
) {
  /** Bytes received on signed upload addresses, with the Authorization header each POST carried. */
  const uploads: {
    attachmentId: string;
    upload: Record<string, unknown>;
    bytes: Buffer;
    authorization: string | undefined;
  }[] = [];
  const signedUploads = new Map<
    string,
    { attachmentId: string; upload: Record<string, unknown> }
  >();
  function prepareUpload(args: ToolArguments) {
    const attachmentId = `pending-${randomUUID()}`;
    const token = randomUUID();
    signedUploads.set(token, { attachmentId, upload: args.upload as Record<string, unknown> });
    return {
      attachmentId,
      relativeUrl: `/api/attachments/upload/${token}`,
      expiresAt: Date.now() + 600_000,
    };
  }
  function receiveUpload(
    request: IncomingMessage,
    response: ServerResponse,
    token: string,
    body: Buffer,
  ) {
    const signed = signedUploads.get(token);
    if (!signed) return void response.writeHead(404).end("Not Found");
    if (body.length !== signed.upload.sizeBytes)
      return void response.writeHead(400).end("Body length differs from the upload size.");
    uploads.push({ ...signed, bytes: body, authorization: request.headers.authorization });
    response.writeHead(204).end();
  }
  const projects: {
    id: string;
    title: string | undefined;
    workspaceRoot: string | undefined;
    deletedAt: null;
    projectIcon?: unknown;
    faviconPath?: unknown;
  }[] = [];
  const projectTools = [
    {
      name: "t3_project_list",
      inputSchema: {
        type: "object",
        properties: {
          environmentId: { type: "string" },
          cursor: { type: "integer" },
          limit: { type: "integer" },
        },
      },
    },
    {
      name: "t3_project_create",
      inputSchema: {
        type: "object",
        properties: {
          environmentId: { type: "string" },
          title: { type: "string" },
          workspaceRoot: { type: "string" },
          createWorkspaceRootIfMissing: { type: "boolean" },
        },
        required: ["title"],
      },
    },
  ];
  let base = "";
  let accessToken = randomUUID();
  const refreshToken = randomUUID();
  let code = randomUUID();
  let challenge = "";
  let revoked = false;
  let refreshes = 0;
  let refreshUnavailable = false;
  let missingContract = false;
  let invalidEnvironment = false;
  let invalidSchema = false;
  let registrationCount = 0;
  let authorizations = 0;
  let rejectionGate: { readonly reached: () => void; readonly release: Promise<void> } | undefined;
  /** Live MCP sessions, one per handshake; forgetting them is what a T3 restart looks like. */
  const sessions = new Set<string>();
  let openedSessions = 0;
  /** The session each authorized MCP request carried, with the tool it called, in arrival order. */
  const sessionRequests: { readonly session: string; readonly tool?: string }[] = [];
  const authorizationServerMetadata = () => ({
    issuer: base,
    authorization_endpoint: base + "/authorize",
    token_endpoint: base + "/token",
    registration_endpoint: base + "/register",
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
  function authorizationCodeRejection(params: URLSearchParams): Rejection | undefined {
    const verifier = params.get("code_verifier");
    const proven =
      params.get("code") === code &&
      !!verifier &&
      createHash("sha256").update(verifier).digest("base64url") === challenge;
    return proven ? undefined : invalidGrant;
  }
  function refreshRejection(params: URLSearchParams): Rejection | undefined {
    refreshes++;
    if (refreshUnavailable)
      return {
        status: 503,
        body: {
          error: "server_error",
          error_description: "PRIVATE_ERROR_DESCRIPTION_MUST_NOT_BE_LOGGED",
        },
      };
    return revoked || params.get("refresh_token") !== refreshToken ? invalidGrant : undefined;
  }
  function exchangeToken(response: ServerResponse, params: URLSearchParams) {
    const rejection =
      params.get("grant_type") === "authorization_code"
        ? authorizationCodeRejection(params)
        : refreshRejection(params);
    if (rejection) {
      json(response, rejection.status, rejection.body);
      return;
    }
    json(response, 200, {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 3600,
    });
  }
  const contractTools = () => [
    {
      name: "t3_environment_read",
      inputSchema: { type: invalidSchema ? "string" : "object", properties: {} },
    },
    ...(options.projects ? projectTools : []),
    ...(options.readSchema ? [{ name: "t3_thread_read", inputSchema: options.readSchema }] : []),
    ...(options.queueSchema ? [{ name: "t3_queue", inputSchema: options.queueSchema }] : []),
    ...(options.interruptSchema
      ? [{ name: "t3_thread_interrupt", inputSchema: options.interruptSchema }]
      : []),
    ...(options.organizeSchema
      ? [{ name: "t3_thread_organize", inputSchema: options.organizeSchema }]
      : []),
    ...(options.send ? [{ name: "t3_thread_send", inputSchema: options.sendSchema! }] : []),
    ...(options.launch ? [{ name: "t3_thread_launch", inputSchema: options.launchSchema! }] : []),
    ...(options.themeRead
      ? [
          {
            name: "t3_theme_read",
            inputSchema: { type: "object", properties: { themeId: { type: "string" } } },
          },
        ]
      : []),
    ...(options.attachments
      ? [
          {
            name: "t3_attachment_prepare_upload",
            inputSchema: { type: "object", properties: { upload: { type: "object" } } },
          },
        ]
      : []),
  ];
  /** The contract tools sit on a second page so discovery must follow the cursor. */
  const toolsPage = (cursor: string | undefined) =>
    cursor
      ? { tools: missingContract ? [] : contractTools() }
      : {
          tools: [{ name: "fixture_other", inputSchema: { type: "object" } }],
          nextCursor: "second-page",
        };
  function listProjects(args: ToolArguments) {
    const start = args.cursor ?? 0;
    const page = projects.slice(start, start + 1);
    return {
      content: [],
      structuredContent: {
        projects: page,
        nextCursor: start + 1 < projects.length ? start + 1 : null,
      },
    };
  }
  function createProject(args: ToolArguments) {
    if (
      args.createWorkspaceRootIfMissing !== false ||
      projects.some((p) => p.workspaceRoot === args.workspaceRoot)
    )
      return { isError: true, content: [{ type: "text", text: "Rejected" }] };
    const p = {
      id: randomUUID(),
      title: args.title,
      workspaceRoot: args.workspaceRoot,
      deletedAt: null,
    };
    projects.push(p);
    return { content: [{ type: "text", text: JSON.stringify(p) }] };
  }
  const launchThread = options.launch;
  const toolCalls = new Map<string, ((args: ToolArguments) => unknown) | undefined>([
    ["t3_project_list", options.projects ? listProjects : undefined],
    ["t3_project_create", options.projects ? createProject : undefined],
    [
      "t3_thread_launch",
      launchThread &&
        ((args) => ({ content: [{ type: "text", text: JSON.stringify(launchThread(args)) }] })),
    ],
    ["t3_thread_send", structuredTool(options.send)],
    ["t3_thread_interrupt", structuredTool(options.interrupt)],
    ["t3_thread_organize", options.organize],
    ["t3_queue", structuredTool(options.queue)],
    ["t3_thread_list", structuredTool(options.threads)],
    ["t3_thread_wait", structuredTool(options.wait)],
    ["t3_thread_read", structuredTool(options.runtimeActivity)],
    ["orchestrator_capabilities", structuredTool(options.capabilities)],
    ["t3_theme_read", structuredTool(options.themeRead)],
    [
      "t3_attachment_prepare_upload",
      options.attachments ? structuredTool(prepareUpload) : undefined,
    ],
  ]);
  /** Any other tool answers as `t3_environment_read`. */
  const readEnvironment = () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(
          invalidEnvironment
            ? {}
            : {
                environmentId: "fixture-environment",
                serverVersion: "future-compatible-version",
              },
        ),
      },
    ],
  });
  async function mcpResult(message: McpRequest): Promise<unknown> {
    if (message.method === "initialize")
      return {
        protocolVersion: message.params!.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "OAuth fixture T3", version: "future-compatible-version" },
      };
    if (message.method === "tools/list") return toolsPage(message.params?.cursor);
    if (message.method === "tools/call") {
      const call = toolCalls.get(message.params!.name) ?? readEnvironment;
      return await call(message.params!.arguments);
    }
    return {};
  }
  async function answerMcp(request: IncomingMessage, response: ServerResponse, body: Buffer) {
    if (request.headers.authorization !== `Bearer ${accessToken}` || revoked) {
      if (rejectionGate) {
        rejectionGate.reached();
        await rejectionGate.release;
      }
      response.setHeader(
        "www-authenticate",
        `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      );
      json(response, 401, { error: "unauthorized" });
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const message = JSON.parse(body.toString()) as McpRequest;
    const session = request.headers["mcp-session-id"];
    if (typeof session === "string") {
      if (!sessions.has(session)) {
        json(response, 404, {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
        });
        return;
      }
      sessionRequests.push({
        session,
        ...(message.params?.name ? { tool: message.params.name } : {}),
      });
    }
    if (message.method === "initialize") {
      const opened = randomUUID();
      sessions.add(opened);
      openedSessions++;
      const result = await mcpResult(message);
      json(response, 200, { jsonrpc: "2.0", id: message.id, result }, { "mcp-session-id": opened });
      return;
    }
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    json(response, 200, { jsonrpc: "2.0", id: message.id, result: await mcpResult(message) });
  }
  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", base);
    const body = await requestBody(request);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource"))
      json(response, 200, { resource: base + "/mcp", authorization_servers: [base] });
    else if (url.pathname === "/.well-known/oauth-authorization-server")
      json(response, 200, authorizationServerMetadata());
    else if (url.pathname === "/register") {
      registrationCount++;
      json(response, 201, { ...JSON.parse(body.toString()), client_id: randomUUID() });
    } else if (url.pathname === "/token")
      exchangeToken(response, new URLSearchParams(body.toString()));
    else if (url.pathname === "/mcp") await answerMcp(request, response, body);
    else if (options.attachments && url.pathname.startsWith("/api/attachments/upload/"))
      receiveUpload(request, response, url.pathname.slice("/api/attachments/upload/".length), body);
    else response.writeHead(404).end();
  }
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((cause: unknown) => {
      response.destroy(new Error("Could not handle the OAuth fixture request.", { cause }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    endpoint: base + "/mcp",
    projectRecords: projects,
    uploads,
    get refreshes() {
      return refreshes;
    },
    get registrationCount() {
      return registrationCount;
    },
    get authorizations() {
      return authorizations;
    },
    /** MCP sessions opened so far: one per authorized connection handshake. */
    get openedSessions() {
      return openedSessions;
    },
    sessionRequests,
    /** Forgets every MCP session, as a restarted T3 would. */
    dropSessions() {
      sessions.clear();
    },
    approvalUrl(authorizationUrl: string) {
      authorizations++;
      const url = new URL(authorizationUrl);
      challenge = url.searchParams.get("code_challenge")!;
      code = randomUUID();
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("code", code);
      revoked = false;
      return callback;
    },
    expireAccess() {
      accessToken = randomUUID();
    },
    revoke() {
      revoked = true;
    },
    /** Holds MCP authorization rejections until `release` settles; resolves once one is held. */
    holdAuthorizationRejections(release: Promise<void>) {
      return new Promise<void>((reached) => {
        rejectionGate = { reached, release };
      });
    },
    refreshUnavailable(value: boolean) {
      refreshUnavailable = value;
    },
    missingContract(value: boolean) {
      missingContract = value;
    },
    invalidSchema(value: boolean) {
      invalidSchema = value;
    },
    invalidEnvironment(value: boolean) {
      invalidEnvironment = value;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}
