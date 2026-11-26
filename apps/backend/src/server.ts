import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, resolve, sep } from "node:path";
import { isIP, type AddressInfo } from "node:net";
import { toIncomingMessage } from "@effect/platform-node/NodeHttpServerRequest";
import * as Effect from "effect/Effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import type { HttpServerRequest as HttpServerRequestType } from "effect/http/HttpServerRequest";
import {
  agentOperations,
  definitionImportOperations,
  flowOperations,
  projectOperations,
  projectServerOperations,
  connectionOperations,
  runOperations,
  chatControlOperations,
  triggerOperations,
  diagnosticOperations,
  LIVE_PATH,
  type ProtocolDescriptor,
  type Result,
} from "@agent-easel/contracts";
import {
  FACTORY_MINIMUM_PEER_PROTOCOL,
  FACTORY_PROTOCOL,
  RUN_IMAGE_MAX_BYTES,
} from "@agent-easel/domain-validation";
import type { FactoryOptions } from "./factory-options.ts";
import { openFactory, type AgentEasel } from "./open-factory.ts";
import { configurationWriter, type Configuration } from "./config.ts";
import { failure } from "./result.ts";
import { accessRoutes } from "./access-routes.ts";
import {
  declaredProtocolCompatibility,
  requestCredential,
  RequestLimiter,
} from "./client-transport.ts";
import {
  definitionBody,
  importBody,
  readJsonBody,
  readRawBody,
  resultResponse,
  runImageResponse,
  sendFaviconResponse,
  optionalStandardBody,
  standardBody,
  writeJsonResponse,
  type RouteTrust,
} from "./http-support.ts";
import { listen, type Surface } from "./listener.ts";
import { runtimeMcpHandler } from "./runtime-mcp.ts";
import { remoteAccessController } from "./remote-listener.ts";
import { serverUpdateRoutes, type ApplicationUpdates } from "./server-update-routes.ts";
import { startLiveTransport, type LiveTransport } from "./live-transport.ts";
import { routeTable, type RouteEntries, type RouteTable } from "./route-table.ts";

export type { ApplicationUpdates } from "./server-update-routes.ts";

const defaultUiDirectory = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const safeMethods = ["GET", "HEAD"];
const isSafeMethod = (method: string) => safeMethods.includes(method);

// Parse strictly: URL normalization must not turn attacker-controlled authorities
// (userinfo, paths, alternate IP spellings) into an allowed Host.
const hostHeaderPattern = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?$/;
const loopbackHostNames = ["localhost", "127.0.0.1", "[::1]"];

const isLoopbackBinding = (address: string) =>
  address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
/** Socket peers, unlike Host headers, cannot be chosen by a remote browser or proxy client. */
const isLoopbackPeer = isLoopbackBinding;

/** A loopback binding answers only loopback names; others answer IP literals and allowedHosts. */
function isAllowedHost(
  host: string | undefined,
  binding: AddressInfo,
  allowedHosts: readonly string[],
): boolean {
  const match = host === undefined ? null : hostHeaderPattern.exec(host);
  const hostname = match?.[1]?.toLowerCase();
  if (hostname === undefined || Number(match?.[2] ?? 80) !== binding.port) return false;
  if (isLoopbackBinding(binding.address)) return loopbackHostNames.includes(hostname);
  const ip = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return isIP(ip) !== 0 || allowedHosts.includes(hostname);
}

/** Cross-site requests cannot set the custom header, and a present Origin must be this Host. */
function passesMutationGuard(request: HttpServerRequestType, scheme: "http" | "https"): boolean {
  if (isSafeMethod(request.method)) return true;
  const origin = request.headers.origin;
  return (
    request.headers["x-factory-request"] === "1" &&
    (origin === undefined || origin === `${scheme}://${request.headers.host}`)
  );
}

function requestTarget(request: HttpServerRequestType): { url: URL; pathname: string } | undefined {
  try {
    const url = new URL(request.url ?? "/", "http://factory.local");
    return { url, pathname: decodeURIComponent(url.pathname) };
  } catch {
    return undefined;
  }
}

/** Answers a facade operation's Result with the operation's success status. */
const answer = (operation: () => Promise<Result<unknown>>, successStatus = 200) =>
  Effect.map(Effect.promise(operation), (result) => resultResponse(result, successStatus));

function apiRoutes(factory: AgentEasel) {
  return {
    ...runRoutes(factory),
    ...connectionRoutes(factory),
    ...projectRoutes(factory),
    ...flowRoutes(factory),
    ...agentRoutes(factory),
    ...importRoutes(factory),
    ...chatControlRoutes(factory),
    ...triggerRoutes(factory),
    ...diagnosticRoutes(factory),
  };
}

function runRoutes(factory: AgentEasel): RouteEntries<typeof runOperations> {
  return {
    listRunNavigation: {
      handle: () => answer(() => factory.listRunNavigation()),
    },
    searchArchivedRuns: {
      handle: ({ parameters }) => answer(() => factory.searchArchivedRuns(parameters.query)),
    },
    startRun: {
      body: { bytes: 131_072, message: "Send valid Start JSON up to 128 KiB." },
      handle: ({ input }) => answer(() => factory.startRun(input), 201),
    },
    getRun: {
      handle: ({ parameters }) => answer(() => factory.getRun(parameters.id)),
    },
    listRuns: {
      handle: ({ parameters }) => answer(() => factory.listRuns(parameters.projectId)),
    },
    renameRun: {
      body: { bytes: 16_384, message: "Send valid Run title JSON." },
      handle: ({ parameters, input }) => answer(() => factory.renameRun(parameters.id, input)),
    },
    snoozeRun: {
      handle: ({ parameters }) => answer(() => factory.snoozeRun(parameters.id)),
    },
    restoreRun: {
      handle: ({ parameters }) => answer(() => factory.restoreRun(parameters.id)),
    },
    markRunWokeSeen: {
      handle: ({ parameters }) => answer(() => factory.markRunWokeSeen(parameters.id)),
    },
    settleRun: {
      body: { bytes: 4096, message: "Send the Settle options as JSON up to 4 KiB." },
      handle: ({ parameters, input }) => answer(() => factory.settleRun(parameters.id, input)),
    },
    archiveRun: {
      handle: ({ parameters }) => answer(() => factory.archiveRun(parameters.id)),
    },
    requestReport: {
      body: { bytes: 4096, message: "Send the Block id as JSON up to 4 KiB." },
      handle: ({ parameters, input }) =>
        answer(() => factory.requestReport(parameters.runId, input)),
    },
    answerHumanOccurrence: {
      body: { bytes: 131_072, message: "Send valid answer JSON up to 128 KiB." },
      handle: ({ parameters, input }) =>
        answer(() => factory.answerHumanOccurrence(parameters.id, input)),
    },
    continueWaitArrival: {
      handle: ({ parameters }) => answer(() => factory.continueWaitArrival(parameters.id)),
    },
    listSubflowInvocations: {
      handle: ({ parameters }) =>
        answer(() =>
          factory.listSubflowInvocations(
            parameters.runId,
            parameters.blockId,
            parameters.limit,
            parameters.cursor,
          ),
        ),
    },
    getSubflowInvocation: {
      handle: ({ parameters }) =>
        answer(() => factory.getSubflowInvocation(parameters.runId, parameters.invocationId)),
    },
    retrySubflowStop: {
      handle: ({ parameters }) =>
        answer(() => factory.retrySubflowStop(parameters.runId, parameters.invocationId)),
    },
    listConditionArrivals: {
      handle: ({ parameters }) =>
        answer(() =>
          factory.listConditionArrivals(
            parameters.runId,
            parameters.blockId,
            parameters.limit,
            parameters.cursor,
          ),
        ),
    },
    getRunJoin: {
      handle: ({ parameters }) =>
        answer(() => factory.getRunJoin(parameters.runId, parameters.blockId)),
    },
    listAttention: {
      handle: () => answer(() => factory.listAttention()),
    },
    getRunCreationPolicy: {
      handle: () => answer(() => factory.getRunCreationPolicy()),
    },
    getRunTitleSetting: {
      handle: () => answer(() => factory.getRunTitleSetting()),
    },
    updateRunTitleSetting: {
      // Installation-wide spending on every Run's provider: approved clients only read it.
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.updateRunTitleSetting(input)),
    },
    listTasks: {
      handle: ({ parameters }) => answer(() => factory.listTasks(parameters.projectId)),
    },
    updateTask: {
      body: { bytes: 16_384, message: "Send valid Task JSON." },
      handle: ({ parameters, input }) => answer(() => factory.updateTask(parameters.id, input)),
    },
    getRunImageInfo: {
      handle: ({ parameters }) => answer(() => factory.getRunImageInfo(parameters.sha256)),
    },
    stageRunImage: {
      body: { bytes: RUN_IMAGE_MAX_BYTES, message: "Send one image up to 10 MiB." },
      handle: ({ parameters, input }) =>
        answer(() => factory.stageRunImage(parameters.sha256, input)),
    },
    getRunImage: {
      protocolOptional: true,
      handle: ({ parameters, headers }) =>
        Effect.map(
          Effect.promise(() => factory.getRunImage(parameters.sha256)),
          (result) => runImageResponse(parameters.sha256, headers["if-none-match"], result),
        ),
    },
    listEligibleRunImages: {
      handle: ({ parameters }) => answer(() => factory.listEligibleRunImages(parameters.projectId)),
    },
    deleteRunImages: {
      body: { bytes: 131_072, message: "Send image digests as JSON up to 128 KiB." },
      handle: ({ input }) => answer(() => factory.deleteRunImages(input)),
    },
  };
}

function connectionRoutes(factory: AgentEasel): RouteEntries<typeof connectionOperations> {
  return {
    getReportingInstallations: { handle: () => answer(() => factory.getReportingInstallations()) },
    installReporting: {
      body: standardBody,
      handle: ({ input }) => answer(() => factory.installReporting(input)),
    },
    recheckReporting: { handle: () => answer(() => factory.recheckReporting()) },
    recheckRuntime: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.recheckRuntime(input)),
    },
    getConnection: { handle: () => answer(() => factory.getConnection()) },
    configureConnection: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.configureConnection(input)),
    },
    recheckConnection: { handle: () => answer(() => factory.recheckConnection()) },
    authorizeConnection: {
      hostOnly: true,
      handle: () => answer(() => factory.authorizeConnection()),
    },
    openConnectionAuthorization: {
      // Approved clients may ask the host to show T3 consent for the saved endpoint;
      // the consent page, state and tokens stay on the host.
      handle: () => answer(() => factory.openConnectionAuthorization()),
    },
    // Approved clients poll the status while the host's setup is incomplete.
    getFirstRunSetup: {
      handle: ({ parameters }) => answer(() => factory.getFirstRunSetup(parameters.poll)),
    },
    completeFirstRunSetup: {
      hostOnly: true,
      handle: () => answer(() => factory.completeFirstRunSetup()),
    },
  };
}

/**
 * Chat control configuration names the host's provider destinations, Discord application,
 * credentials and access policy, its Test may be charged, and its check and On/Off switch connect
 * to Discord: approved clients can neither read nor change it.
 */
function chatControlRoutes(factory: AgentEasel): RouteEntries<typeof chatControlOperations> {
  return {
    getChatModelSettings: {
      hostOnly: true,
      handle: () => answer(() => factory.getChatModelSettings()),
    },
    updateChatModelSettings: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.updateChatModelSettings(input)),
    },
    testChatModel: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.testChatModel(input)),
    },
    getDiscordSettings: {
      hostOnly: true,
      handle: () => answer(() => factory.getDiscordSettings()),
    },
    updateDiscordConnection: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.updateDiscordConnection(input)),
    },
    checkDiscordConnection: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.checkDiscordConnection(input)),
    },
    updateDiscordAccess: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.updateDiscordAccess(input)),
    },
    sendDiscordAccessTest: {
      hostOnly: true,
      handle: () => answer(() => factory.sendDiscordAccessTest()),
    },
    setChatControlEnabled: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.setChatControlEnabled(input)),
    },
    retryChatDelivery: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.retryChatDelivery(input)),
    },
  };
}

function projectRoutes(
  factory: AgentEasel,
): RouteEntries<typeof projectOperations & typeof projectServerOperations> {
  return {
    listProjects: { handle: () => answer(() => factory.listProjects()) },
    recheckProjects: { handle: () => answer(() => factory.recheckProjects()) },
    addRepository: {
      body: standardBody,
      handle: ({ input }) => answer(() => factory.addRepository(input)),
    },
    selectProject: {
      body: standardBody,
      handle: ({ input }) => answer(() => factory.selectProject(input)),
    },
    getProjectFavicon: {
      protocolOptional: true,
      handle: ({ parameters }) =>
        Effect.map(
          Effect.promise(() => factory.getProjectFavicon(parameters.id)),
          sendFaviconResponse,
        ),
    },
    getProjectReadiness: {
      handle: ({ parameters }) => answer(() => factory.getProjectReadiness(parameters.id)),
    },
    headProjectFavicon: {
      protocolOptional: true,
      handle: ({ parameters }) =>
        Effect.map(
          Effect.promise(() => factory.getProjectFavicon(parameters.id)),
          sendFaviconResponse,
        ),
    },
  };
}

function flowRoutes(factory: AgentEasel): RouteEntries<typeof flowOperations> {
  return {
    listFlows: { handle: () => answer(() => factory.listFlows()) },
    createFlow: {
      body: definitionBody,
      handle: ({ input }) => answer(() => factory.createFlow(input), 201),
    },
    validateFlow: {
      body: definitionBody,
      handle: ({ parameters, input }) => answer(() => factory.validateFlow(parameters.id, input)),
    },
    getFlow: { handle: ({ parameters }) => answer(() => factory.getFlow(parameters.id)) },
    listFlowFindings: {
      body: definitionBody,
      handle: ({ parameters, input }) =>
        answer(() => factory.listFlowFindings(parameters.id, input)),
    },
    removeFlow: { handle: ({ parameters }) => answer(() => factory.removeFlow(parameters.id)) },
    previewFlowDuplicate: {
      body: standardBody,
      handle: ({ parameters, input }) =>
        answer(() => factory.previewFlowDuplicate(parameters.id, input)),
    },
    duplicateFlow: {
      body: definitionBody,
      handle: ({ parameters, input }) =>
        answer(() => factory.duplicateFlow(parameters.id, input), 201),
    },
    updateFlow: {
      body: definitionBody,
      handle: ({ parameters, input }) => answer(() => factory.updateFlow(parameters.id, input)),
    },
    changeFlowOwner: {
      body: standardBody,
      handle: ({ parameters, input }) =>
        answer(() => factory.changeFlowOwner(parameters.id, input)),
    },
    exportFlow: { handle: ({ parameters }) => answer(() => factory.exportFlow(parameters.id)) },
  };
}

function agentRoutes(factory: AgentEasel): RouteEntries<typeof agentOperations> {
  return {
    getAgentCapabilities: { handle: () => answer(() => factory.getAgentCapabilities()) },
    listAgents: { handle: () => answer(() => factory.listAgents()) },
    reserveAgentCreate: { handle: () => answer(() => factory.reserveAgentCreate()) },
    createAgent: {
      body: definitionBody,
      handle: ({ input }) => answer(() => factory.createAgent(input), 201),
    },
    getAgent: { handle: ({ parameters }) => answer(() => factory.getAgent(parameters.id)) },
    getAgentCreateOutcome: {
      handle: ({ parameters }) => answer(() => factory.getAgentCreateOutcome(parameters.id)),
    },
    duplicateAgent: {
      body: standardBody,
      handle: ({ parameters, input }) =>
        answer(() => factory.duplicateAgent(parameters.id, input), 201),
    },
    updateAgent: {
      body: definitionBody,
      handle: ({ parameters, input }) => answer(() => factory.updateAgent(parameters.id, input)),
    },
    changeAgentOwner: {
      body: standardBody,
      handle: ({ parameters, input }) =>
        answer(() => factory.changeAgentOwner(parameters.id, input)),
    },
    removeAgent: { handle: ({ parameters }) => answer(() => factory.removeAgent(parameters.id)) },
    exportAgent: { handle: ({ parameters }) => answer(() => factory.exportAgent(parameters.id)) },
  };
}

/** Every approved client manages Triggers; their bodies carry typed settings only. */
function triggerRoutes(factory: AgentEasel): RouteEntries<typeof triggerOperations> {
  return {
    getTriggerReadiness: {
      handle: ({ parameters }) =>
        answer(() =>
          factory.getTriggerReadiness(
            parameters.projectId,
            parameters.flowId,
            parameters.triggerId,
          ),
        ),
    },
    listTriggers: { handle: () => answer(() => factory.listTriggers()) },
    createTrigger: {
      body: standardBody,
      handle: ({ input }) => answer(() => factory.createTrigger(input), 201),
    },
    getTrigger: { handle: ({ parameters }) => answer(() => factory.getTrigger(parameters.id)) },
    updateTrigger: {
      body: standardBody,
      handle: ({ parameters, input }) => answer(() => factory.updateTrigger(parameters.id, input)),
    },
    setTriggerEnabled: {
      body: standardBody,
      handle: ({ parameters, input }) =>
        answer(() => factory.setTriggerEnabled(parameters.id, input)),
    },
    runTrigger: {
      body: optionalStandardBody,
      handle: ({ parameters, input }) => answer(() => factory.runTrigger(parameters.id, input)),
    },
    previewNewTrigger: {
      body: standardBody,
      handle: ({ input }) => answer(() => factory.previewNewTrigger(input)),
    },
    previewTrigger: {
      body: standardBody,
      handle: ({ parameters, input }) => answer(() => factory.previewTrigger(parameters.id, input)),
    },
    removeTrigger: {
      handle: ({ parameters }) => answer(() => factory.removeTrigger(parameters.id)),
    },
  };
}

const diagnosticExportHeaders = {
  "content-type": "text/plain; charset=utf-8",
  "content-disposition": 'attachment; filename="agenteasel-diagnostic-log.txt"',
  "cache-control": "no-store",
} as const;

function diagnosticRoutes(factory: AgentEasel): RouteEntries<typeof diagnosticOperations> {
  return {
    getDiagnosticLog: { handle: () => answer(() => factory.getDiagnosticLog()) },
    setDiagnosticRecording: {
      hostOnly: true,
      body: standardBody,
      handle: ({ input }) => answer(() => factory.setDiagnosticRecording(input)),
    },
    deleteDiagnosticLog: {
      hostOnly: true,
      handle: () => answer(() => factory.deleteDiagnosticLog()),
    },
    listDiagnosticAttempts: {
      handle: ({ parameters }) =>
        answer(() =>
          factory.listDiagnosticAttempts(parameters.cursor, parameters.limit, parameters.ids),
        ),
    },
    exportDiagnosticLog: {
      protocolOptional: true,
      handle: () =>
        Effect.map(Effect.promise(factory.exportDiagnosticLog), (result) =>
          result.ok
            ? HttpServerResponse.text(result.value, {
                status: 200,
                headers: diagnosticExportHeaders,
              })
            : resultResponse(result),
        ),
    },
  };
}

function importRoutes(factory: AgentEasel): RouteEntries<typeof definitionImportOperations> {
  return {
    reviewImport: {
      body: importBody,
      handle: ({ input }) => answer(() => factory.reviewImport(input)),
    },
    commitImport: {
      body: importBody,
      handle: ({ input }) => answer(() => factory.commitImport(input), 201),
    },
  };
}

/**
 * Before any operation: a declared protocol must be compatible, and a remote client
 * must declare one, hold an approved credential, and not call host setup. Admits with
 * the approved client's id, or null where no credential applies.
 */
function admission(
  route: RouteTrust,
  declared: Readonly<Record<string, string | undefined>>,
  credential: string | undefined,
  binding: HttpBinding,
): Effect.Effect<Result<string | null>> {
  return Effect.gen(function* () {
    const compatibility = declaredProtocolCompatibility(declared, binding.protocol);
    const exempt = route.handshake === true;
    if (!exempt && compatibility !== undefined && compatibility.kind !== "compatible")
      return failure("incompatible", compatibility.message);
    const required = binding.surface === "remote" || route.protocolRequired === true;
    if (required && !exempt && !route.protocolOptional && compatibility === undefined)
      return failure(
        "incompatible",
        "This client does not declare an AgentEasel protocol. Update it.",
      );
    if (binding.surface === "host" || route.public) return { ok: true, value: null };
    const client = yield* Effect.promise(() =>
      binding.factory.authenticateClient(credential ?? ""),
    );
    if (!client.ok) return client;
    if (route.hostOnly)
      return failure("host_only", "This operation is available only on the AgentEasel host.");
    return { ok: true, value: client.value.id };
  });
}

/** Runs the API route that claims the request; undefined when none does. */
function dispatchApi(
  request: HttpServerRequestType,
  target: { url: URL; pathname: string },
  binding: HttpBinding,
  peer: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse | undefined> {
  return Effect.gen(function* () {
    const matched = binding.routes(binding.surface, request.method, target.pathname);
    if (!matched) return undefined;
    const { route, parameters } = matched;
    const admitted = yield* admission(
      route,
      request.headers,
      requestCredential(request.headers),
      binding,
    );
    if (!admitted.ok) return resultResponse(admitted);
    let input: unknown;
    if (route.body) {
      const body =
        route.body.kind === "json"
          ? yield* readJsonBody(request, route.body.limit)
          : yield* readRawBody(request, route.body.limit);
      if (body.kind === "invalid") return body.response;
      input = body.value;
    }
    return yield* route.handle(parameters, {
      input,
      url: target.url,
      method: request.method,
      headers: request.headers,
      peer,
    });
  });
}

// Known client routes use the built entry; missing assets must stay 404. Any Settings section
// path does, so the client opens removed or unknown sections at the default one.
const clientRoutePattern =
  /^\/(studio(?:\/(?:flows|agents)(?:\/[^/]+)?|\/triggers(?:\/new\/github-issues|\/[^/]+)?)?|flows(?:\/[^/]+)?|runs(?:\/[^/]+)?|settings(?:\/agents(?:\/[^/]+)?|\/chat-control\/(?:model|discord)|\/[^/]+)?)\/?$/;

function uiFile(uiDirectory: string, pathname: string): string | undefined {
  const root = resolve(uiDirectory);
  const target = resolve(root, "." + pathname);
  if (target !== root && !target.startsWith(root + sep)) return undefined;
  return pathname === "/" || clientRoutePattern.test(pathname)
    ? resolve(root, "index.html")
    : target;
}

function serveUi(
  uiDirectory: string,
  pathname: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.gen(function* () {
    const target = uiFile(uiDirectory, pathname);
    const body =
      target === undefined
        ? undefined
        : yield* Effect.tryPromise(() => readFile(target)).pipe(
            Effect.catchCause(() => Effect.succeed(undefined)),
          );
    if (target === undefined || body === undefined) {
      return resultResponse(failure("not_found", "Page not found."));
    }
    return HttpServerResponse.uint8Array(body, {
      status: 200,
      headers: {
        "content-type": contentTypes[extname(target)] ?? "application/octet-stream",
        "cache-control": extname(target) === ".html" ? "no-cache" : "public, max-age=3600",
      },
    });
  });
}

interface HttpBinding {
  readonly nodeServer: Server;
  readonly surface: Surface;
  readonly allowedHosts: readonly string[];
  readonly routes: RouteTable;
  readonly uiDirectory: string | null;
  readonly protocol: ProtocolDescriptor;
  readonly factory: AgentEasel;
  readonly mcp: (request: Request) => Promise<Response>;
  readonly live: LiveTransport;
}

/**
 * Live delivery requires a declared protocol on the host listener too: every live client is a
 * Factory UI, and the declaration is the stream's only compatibility check. Host-local HTTP
 * callers such as scripts may omit it.
 */
const liveTrust: RouteTrust = { protocolRequired: true };

/**
 * Admits a live WebSocket before upgrading it, with the product routes' rules. Browsers cannot
 * set headers on a WebSocket, so the protocol is declared in the query, and the Origin is
 * mandatory: an upgrade is a GET that the mutation guard does not cover.
 */
function serveLive(
  request: HttpServerRequestType,
  url: URL,
  binding: HttpBinding,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  const scheme = binding.surface === "remote" ? "https" : "http";
  if (request.headers.origin !== `${scheme}://${request.headers.host}`)
    return Effect.succeed(
      writeJsonResponse(
        403,
        failure("validation", "Live delivery requires the Origin of this AgentEasel address."),
      ),
    );
  if (request.method !== "GET" || request.headers.upgrade?.toLowerCase() !== "websocket")
    return Effect.succeed(
      resultResponse(failure("validation", "Open live delivery as a WebSocket.")),
    );
  const declared = {
    "x-factory-protocol": url.searchParams.get("protocol") ?? undefined,
    "x-factory-protocol-minimum": url.searchParams.get("minimum") ?? undefined,
  };
  return binding.live.serve(
    request,
    admission(liveTrust, declared, requestCredential(request.headers), binding),
  );
}

/**
 * Harness reporting over Streamable HTTP. Calls name their Block by Block id and the
 * endpoint needs no credential: it is host-local, and browsers must not reach it.
 */
function serveMcp(
  request: HttpServerRequestType,
  binding: HttpBinding,
): Effect.Effect<HttpServerResponse.HttpServerResponse, unknown> {
  if (binding.surface === "remote")
    return Effect.succeed(
      writeJsonResponse(
        403,
        failure("host_only", "Harnesses reach AgentEasel MCP only on the host's loopback address."),
      ),
    );
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${request.headers.host}`)
    return Effect.succeed(
      writeJsonResponse(
        403,
        failure("validation", "AgentEasel MCP refuses cross-origin requests."),
      ),
    );
  return HttpServerRequest.toWeb(request).pipe(
    Effect.flatMap((web) => Effect.promise(() => binding.mcp(web))),
    Effect.map(HttpServerResponse.fromWeb),
  );
}

function handleHttpRequest(
  request: HttpServerRequestType,
  binding: HttpBinding,
): Effect.Effect<HttpServerResponse.HttpServerResponse> {
  return Effect.catchCause(handleHttpRequestInner(request, binding), () =>
    Effect.succeed(
      resultResponse(failure("internal", "AgentEasel could not complete the request.")),
    ),
  );
}

function handleHttpRequestInner(
  request: HttpServerRequestType,
  binding: HttpBinding,
): Effect.Effect<HttpServerResponse.HttpServerResponse, unknown> {
  return Effect.gen(function* () {
    const address = binding.nodeServer.address() as AddressInfo;
    if (!isAllowedHost(request.headers.host, address, binding.allowedHosts)) {
      return writeJsonResponse(
        421,
        failure("validation", "Host is not allowed for this AgentEasel binding."),
      );
    }
    const peer = toIncomingMessage(request).socket?.remoteAddress ?? "";
    if (binding.surface === "host" && !isLoopbackPeer(peer)) {
      return writeJsonResponse(
        403,
        failure(
          "host_only",
          "This AgentEasel address serves only its own host. Connect other devices through secure remote access.",
        ),
      );
    }
    const target = requestTarget(request);
    if (target?.pathname === "/mcp") return yield* serveMcp(request, binding);
    if (target?.pathname === LIVE_PATH) return yield* serveLive(request, target.url, binding);
    if (!passesMutationGuard(request, binding.surface === "remote" ? "https" : "http")) {
      return writeJsonResponse(
        403,
        failure(
          "validation",
          "Mutations require X-Factory-Request: 1 and a matching Origin when present.",
        ),
      );
    }
    if (!target) {
      return resultResponse(failure("validation", "Invalid request URL."));
    }
    const apiResponse = yield* dispatchApi(request, target, binding, peer);
    if (apiResponse !== undefined) return apiResponse;
    if (
      target.pathname.startsWith("/api/") ||
      !isSafeMethod(request.method) ||
      binding.uiDirectory === null
    ) {
      return resultResponse(failure("not_found", "Operation not found."));
    }
    return yield* serveUi(binding.uiDirectory, target.pathname);
  });
}

/** HTTP only translates transport; every authoring rule belongs in Factory operations. */
export interface ServerOptions {
  readonly uiDirectory?: string | null;
  readonly t3?: FactoryOptions["t3"];
  readonly clock?: FactoryOptions["clock"];
  readonly github?: FactoryOptions["github"];
  readonly git?: FactoryOptions["git"];
  readonly connectionRetryMs?: number;
  readonly reportingStateDirectory?: string;
  readonly discordApiUrl?: FactoryOptions["discordApiUrl"];
  /** Reported by the handshake; desktop builds pass their release, source runs say `source`. */
  readonly applicationVersion?: string;
  /** Another release's protocol range, for compatibility tests of mixed installations. */
  readonly protocol?: Pick<ProtocolDescriptor, "protocol" | "minimumPeerProtocol">;
  /** The desktop server's updater, which approved clients may operate. */
  readonly applicationUpdates?: ApplicationUpdates;
}

const accessRequestsPerMinute = 5;

/** Optional caller choices forwarded unchanged to `openFactory`. */
function factoryOptions(config: Configuration, options: ServerOptions): FactoryOptions {
  return {
    databasePath: config.databasePath,
    credentialsDirectory: config.credentialsDirectory,
    ...(options.reportingStateDirectory
      ? { reportingStateDirectory: options.reportingStateDirectory }
      : {}),
    ...(options.t3 ? { t3: options.t3 } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.github ? { github: options.github } : {}),
    ...(options.git ? { git: options.git } : {}),
    ...(options.connectionRetryMs !== undefined
      ? { connectionRetryMs: options.connectionRetryMs }
      : {}),
    ...(options.applicationVersion ? { applicationVersion: options.applicationVersion } : {}),
    ...(options.discordApiUrl ? { discordApiUrl: options.discordApiUrl } : {}),
  };
}

const serverProtocol = (options: ServerOptions): ProtocolDescriptor => ({
  protocol: options.protocol?.protocol ?? FACTORY_PROTOCOL,
  minimumPeerProtocol: options.protocol?.minimumPeerProtocol ?? FACTORY_MINIMUM_PEER_PROTOCOL,
  application: options.applicationVersion ?? "source",
});

/** Harnesses always report to the host-local listener over loopback. */
function loopbackUrl(host: string, port: number): string {
  const runtimeHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return `http://${runtimeHost.includes(":") ? "[" + runtimeHost + "]" : runtimeHost}:${port}`;
}

export async function startServer(config: Configuration, options: ServerOptions = {}) {
  const uiDirectory = options.uiDirectory === undefined ? defaultUiDirectory : options.uiDirectory;
  // Fail before binding if the documented build step was missed.
  if (uiDirectory !== null) await stat(resolve(uiDirectory, "index.html"));
  const factory = await openFactory(factoryOptions(config, options));
  const protocol = serverProtocol(options);
  const limiter = new RequestLimiter(accessRequestsPerMinute, 60_000);
  const mcp = runtimeMcpHandler(factory.runtime, factory);
  const live = await startLiveTransport(factory.live);
  let routes: RouteTable = () => undefined;
  const handlerFor =
    (surface: Surface, allowedHosts: readonly string[]) => (nodeServer: Server) => {
      const binding: HttpBinding = {
        nodeServer,
        surface,
        allowedHosts,
        get routes() {
          return routes;
        },
        uiDirectory,
        protocol,
        factory,
        mcp,
        live,
      };
      return (request: HttpServerRequestType) => handleHttpRequest(request, binding);
    };
  const writeConfiguration = configurationWriter(config.home);
  const remote = remoteAccessController(
    config,
    handlerFor("remote", config.allowedHosts ?? []),
    writeConfiguration,
  );
  const nodeServer = createServer();
  let host: Awaited<ReturnType<typeof listen>>;
  try {
    // Refuses conflicting entries before the server binds.
    routes = routeTable({
      ...accessRoutes(factory, protocol, remote, limiter, live),
      ...apiRoutes(factory),
      ...serverUpdateRoutes(factory, protocol.application, options.applicationUpdates),
    });
    host = await listen(
      nodeServer,
      config.host,
      config.port,
      handlerFor("host", config.allowedHosts ?? [])(nodeServer),
    );
  } catch (error) {
    limiter.close();
    await live.close();
    await factory.close();
    throw error;
  }
  factory.setRuntimeBackendUrl(loopbackUrl(config.host, host.address.port));
  // A remote-access failure is reported on the host panel; the host-local surface keeps serving.
  await remote.start().catch(() => undefined);
  let closing: Promise<void> | undefined;
  return {
    factory,
    address: host.address,
    /** The approved-client HTTPS listener's address while it runs. */
    remoteAddress: () => remote.address(),
    remoteAccess: remote,
    close() {
      return (closing ??= Promise.allSettled([remote.close(), host.close()])
        .then(() => limiter.close())
        .then(() => live.close())
        .then(() => factory.close()));
    },
  };
}
