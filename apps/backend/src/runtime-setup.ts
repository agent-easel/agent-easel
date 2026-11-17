import { explicitReadiness } from "./explicit-readiness.ts";
import * as Semaphore from "effect/Semaphore";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { now } from "./time.ts";
import { boundary, type EffectOperations } from "./effect-operations.ts";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import type {
  AgentCapabilities,
  CapturedAgent,
  AuthorizationContext,
  FactoryOperations,
  ProjectCatalog,
  Result,
  RuntimeReadiness,
  T3Connection,
  ValidationIssue,
} from "@t3-factory/contracts";
import { executionForProject } from "@t3-factory/domain-validation";
import { agentSettingsStatus } from "./agents.ts";
import type { GitAdapter } from "./adapters/git.ts";
import { reportSupport } from "./adapters/t3-contract.ts";
import type { T3ContractSnapshot } from "./adapters/t3.ts";
import type { ContractSnapshots } from "./connection.ts";
import { isLocalEndpoint } from "./endpoint-local.ts";

class SetupFailure extends Error {
  readonly issue: ValidationIssue;
  constructor(issue: ValidationIssue) {
    super(issue.message);
    this.issue = issue;
  }
}
function blocked(code: string, path: string, message: string): never {
  throw new SetupFailure({ code, path, message });
}
const object = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" ? (x as Record<string, unknown>) : {};
function readyConnection(c: Result<T3Connection>) {
  if (!c.ok || c.value.state !== "ready" || !c.value.authorizationContext)
    blocked(
      "connection_unavailable",
      "connection",
      "Connect and authorize T3; inspect its live contract.",
    );
  return { connection: c.value, context: c.value.authorizationContext };
}
/** Readiness evidence counts only under the snapshot's context: support answers belong to it, and
 * a switched connection gets a new context id, even when it switches back. */
function sameContext(contextId: string, snapshot: T3ContractSnapshot) {
  if (contextId !== snapshot.contextId)
    blocked(
      "connection_unavailable",
      "connection",
      "The T3 connection changed while readiness was checked. Recheck it.",
    );
}
function availableProject(catalog: Result<ProjectCatalog>, projectId: string) {
  const p = catalog.ok ? catalog.value.projects.find((p) => p.id === projectId) : undefined;
  if (!p || p.availability !== "available")
    blocked(
      "project_unavailable",
      "project",
      "Recheck the project and restore its repository directory.",
    );
  return p;
}
function readyCapabilities(cap: Result<AgentCapabilities>) {
  if (!cap.ok || cap.value.state !== "ready")
    blocked(
      "capabilities_unavailable",
      "agent.execution",
      "T3 environment/provider/model capabilities are unavailable.",
    );
  return cap.value;
}
/** Keep the connected local environment, a supported reporting harness and every chosen setting. */
function validatedHarness(
  context: AuthorizationContext,
  agent: CapturedAgent,
  capabilities: AgentCapabilities,
) {
  if (!isLocalEndpoint(context.endpoint) || context.environmentId !== agent.execution.environmentId)
    blocked(
      "environment_unsupported",
      "agent.execution.environmentId",
      "Only the connected local environment is supported; remote environments are unvalidated.",
    );
  const provider = capabilities.providers.find(
    (p) => p.providerInstanceId === agent.execution.providerInstanceId,
  );
  if (!provider || !provider.reporting.supported)
    blocked(
      "harness_unsupported",
      "agent.execution.providerInstanceId",
      `${provider?.reporting.explanation ?? "T3 no longer offers the selected provider."} Choose another provider for ${agent.name} in Studio → Agents.`,
    );
  const settingsStatus = agentSettingsStatus(agent.execution, capabilities);
  if (
    Object.values(settingsStatus).some(
      (s) => !Array.isArray(s) && "state" in s && s.state !== "available",
    ) ||
    settingsStatus.options.some((o) => o.state !== "available")
  )
    blocked(
      "settings_unavailable",
      "agent.execution",
      "Selected environment/provider/model/options are unavailable; no settings were substituted.",
    );
  return provider.driverKind;
}
function runtimeContractIssues(connection: T3Connection): ValidationIssue[] {
  const tools = connection.contract?.tools ?? [];
  const required: Record<string, string[]> = {
    t3_thread_launch: ["projectId", "clientRequestId", "modelSelection", "workspaceStrategy"],
    t3_thread_send: ["threadId", "clientRequestId", "mode"],
    t3_thread_read: ["threadId", "view", "afterPosition"],
    t3_queue: ["action", "queuedRunId"],
    t3_thread_interrupt: ["threadId", "stop", "clientRequestId"],
  };
  const types: Record<string, string> = {
    stop: "boolean",
    afterPosition: "integer",
    modelSelection: "object",
    workspaceStrategy: "object",
  };
  const issues: ValidationIssue[] = [];
  for (const [name, fields] of Object.entries(required)) {
    const schema = tools.find((t) => t.name === name)?.inputSchema;
    const props = object(schema?.properties);
    const fieldsMissing = fields.some(
      (field) => object(props[field]).type !== (types[field] ?? "string"),
    );
    if (schema?.type !== "object" || fieldsMissing)
      issues.push({
        code: "contract_missing",
        path: "connection.contract",
        message: `${name} lacks required runtime fields.`,
      });
  }
  return issues;
}
function readinessFailure(error: unknown): ValidationIssue {
  if (error instanceof SetupFailure) return error.issue;
  return {
    code: "runtime_unavailable",
    path: "runtime",
    message:
      "Recheck connectivity, local project, environment, provider, model and options. Unsupported harnesses/environments stay blocked.",
  };
}
const openRuntimeSetup = Effect.fn(function* (
  ops: EffectOperations<
    Pick<
      FactoryOperations,
      | "getReportingInstallations"
      | "getConnection"
      | "listProjects"
      | "getAgent"
      | "getAgentCapabilities"
    >
  >,
  freshSnapshot: ContractSnapshots["fresh"],
  refreshProjects: EffectOperations<Pick<FactoryOperations, "recheckProjects">>["recheckProjects"],
  git: GitAdapter,
) {
  const semaphore = yield* Semaphore.make(1);
  let closed = false;
  const serial = <A, E>(fn: () => Effect.Effect<A, E>): Effect.Effect<A, E | Error> =>
    Effect.suspend<A, E | Error, never>(() =>
      closed
        ? Effect.fail(new Error("Runtime setup closed"))
        : semaphore.withPermits(1)(Effect.uninterruptible(fn())),
    );
  const close = Effect.gen(function* () {
    closed = true;
    yield* semaphore.withPermits(1)(Effect.void);
  });
  yield* Effect.addFinalizer(() => close);
  const selection = Effect.fn(function* (
    input: unknown,
    checked: Effect.Effect<T3ContractSnapshot, unknown>,
    capturedAgent?: CapturedAgent,
  ) {
    const i = object(input);
    if (typeof i.projectId !== "string" || typeof i.agentId !== "string")
      blocked("selection_required", "runtime.selection", "Choose a saved project and Agent.");
    const snapshot = yield* checked;
    const [c, ps, a, cap] = yield* Effect.all(
      [
        ops.getConnection(),
        ops.listProjects(),
        capturedAgent
          ? Effect.succeed({ ok: true as const, value: capturedAgent })
          : ops.getAgent(i.agentId),
        ops.getAgentCapabilities(),
      ],
      { concurrency: "unbounded" },
    );
    const { connection, context } = readyConnection(c);
    sameContext(context.id, snapshot);
    const p = availableProject(ps, i.projectId);
    if (!a.ok) blocked("agent_unavailable", "agent", "Choose an existing Agent.");
    // A captured Agent already carries the settings of its Run's Project.
    const execution = capturedAgent ? a.value.execution : executionForProject(a.value, p.id);
    if (execution === null)
      blocked(
        "execution_required",
        "agent.execution",
        `Choose an environment, provider and model for ${a.value.name} in Studio → Agents.`,
      );
    const agent = { ...a.value, execution };
    const driver = validatedHarness(context, agent, readyCapabilities(cap));
    const root = yield* boundary(() => git.resolveRepository(context.endpoint, p.workspaceRoot));
    if (root !== p.workspaceRoot) throw Error("Project source checkout changed");
    return { c: connection, a: agent, driver, snapshot };
  });
  /**
   * Explicit reporting: the connected contract, an installed Factory MCP and report support.
   * `checked` refreshes the Project catalog and answers with the snapshot of the one connection
   * check this readiness relies on, so a later check or another context cannot change its answer.
   */
  const readiness = Effect.fn(function* (
    input: unknown,
    checked: Effect.Effect<T3ContractSnapshot, unknown>,
    capturedAgent?: CapturedAgent,
  ): Generator<Effect.Effect<unknown, unknown>, Result<RuntimeReadiness>, never> {
    const issues: ValidationIssue[] = [];
    yield* Effect.gen(function* () {
      const s = yield* selection(input, checked, capturedAgent);
      issues.push(...runtimeContractIssues(s.c));
      const installed = yield* explicitReadiness(
        {
          ok: true,
          value: { ready: true, issues: [], checkedAt: yield* now, instructions: "" },
        },
        s.a.execution,
        ops.getReportingInstallations,
      );
      // Git and the installation lookup awaited after selection, so every piece of evidence held
      // under the snapshot's context only when the connection still has it now.
      sameContext(readyConnection(yield* ops.getConnection()).context.id, s.snapshot);
      if (installed.ok) issues.push(...installed.value.issues);
      const reporting = reportSupport(s.snapshot.support, s.driver);
      if (!reporting.supported)
        issues.push({
          code: "reporting_unsupported",
          path: "connection.contract",
          message: reporting.explanation,
        });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          issues.push(readinessFailure(Cause.squash(cause)));
        }),
      ),
    );
    return {
      ok: true,
      value: {
        ready: issues.length === 0,
        issues,
        checkedAt: yield* now,
        instructions:
          "Install Factory MCP in Settings → Agent reporting for the selected harness home and start a fresh session. Native approvals remain in T3. Installed configuration is not live verification; no diagnostic workload is launched.",
      },
    };
  });
  return {
    close: () => close,
    /** A captured Agent's readiness within a pass that already took its T3 contract snapshot. */
    recheckAgent: (projectId: string, agent: CapturedAgent, snapshot: T3ContractSnapshot) =>
      serial(() =>
        readiness({ projectId, agentId: agent.id }, Effect.as(refreshProjects(), snapshot), agent),
      ),
    /** Standalone readiness makes its own one connection check and answers from that check. */
    recheckRuntime: (i: unknown) =>
      serial(() =>
        readiness(
          i,
          Effect.flatMap(freshSnapshot(), (snapshot) => Effect.as(refreshProjects(), snapshot)),
        ),
      ),
  };
});

export class RuntimeSetup extends Context.Service<
  RuntimeSetup,
  Effect.Success<ReturnType<typeof openRuntimeSetup>>
>()("RuntimeSetup") {}
export const RuntimeSetupLayer = (...args: Parameters<typeof openRuntimeSetup>) =>
  Layer.effect(RuntimeSetup, openRuntimeSetup(...args));
