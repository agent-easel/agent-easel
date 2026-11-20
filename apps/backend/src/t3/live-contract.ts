import type { T3Calls, T3Endpoint, T3ListedTool, T3Probe, T3Session } from "./connection.ts";
import {
  contractSupport,
  type LaunchSupport,
  type T3ContractReader,
  type T3Inspection,
  type T3Support,
} from "./contract.ts";
import { readEnvironmentIdentity } from "./environment-identity.ts";

export interface LiveT3ContractOptions {
  /** Integration-only proof of server continuity and request-key retention. No proof = no replay.
   * The verifier must return a stable scope only while those conditions are established. */
  readonly sendRecoveryScope?: (endpoint: string) => Promise<string | null>;
  readonly launchRecoveryScope?: (endpoint: string) => Promise<string | null>;
}

/** An inspection before its support answers are derived from the listed tools. */
type Inspected = Omit<T3Inspection, "support">;
/** What an inspection reads over the probe's connection. */
interface ContractRead {
  readonly tools: readonly T3ListedTool[];
  readonly environmentId: string | null;
  readonly problems: readonly string[];
}

function acceptsEmptyArguments(tool: T3ListedTool | undefined): boolean {
  if (!tool || tool.inputSchema.type !== "object") return false;
  const required = tool.inputSchema.required;
  return !(Array.isArray(required) && required.length > 0);
}

async function readContract(session: T3Session): Promise<ContractRead> {
  const tools = await session.tools();
  const problems: string[] = [];
  let environmentId: string | null = null;
  if (!acceptsEmptyArguments(tools.find((tool) => tool.name === "t3_environment_read"))) {
    problems.push("t3_environment_read must accept an empty object.");
  } else {
    environmentId = await readEnvironmentIdentity(session);
    if (!environmentId)
      problems.push("t3_environment_read did not return an environment identity.");
  }
  return { tools, environmentId, problems };
}

/** A probe's answer as an inspection; an approved grant binds the authorization context. */
function inspection(probe: T3Probe<ContractRead>): Inspected {
  if (probe.status === "authorization-required")
    return { state: "authorization-required", reason: probe.reason };
  if (probe.status === "contract-failure")
    return {
      state: "incompatible",
      reason: "contract-missing",
      contract: {
        ...probe.server,
        environmentId: null,
        tools: [],
        problems: ["T3 returned an unsupported MCP protocol or invalid connection contract."],
        executionVerified: false,
      },
    };
  const problems = [...probe.answer.problems];
  if (!probe.approved)
    problems.push("An approved OAuth grant is required to bind authorization context.");
  return {
    state: problems.length ? "incompatible" : "ready",
    reason: problems.length ? "contract-missing" : "connected",
    ...(probe.authorizationIdentity ? { authorizationIdentity: probe.authorizationIdentity } : {}),
    contract: {
      ...probe.server,
      environmentId: probe.answer.environmentId,
      tools: probe.answer.tools,
      problems,
      executionVerified: false,
    },
  };
}

export class LiveT3Contract implements T3ContractReader {
  private readonly calls: T3Calls;
  private readonly options: LiveT3ContractOptions;

  constructor(calls: T3Calls, options: LiveT3ContractOptions) {
    this.calls = calls;
    this.options = options;
  }

  /** Support is derived from T3's advertised schemas within the probe's call, so a schema Factory
   * cannot evaluate is classified with what that inspection's requests met. */
  inspect(target: T3Endpoint): Promise<T3Inspection> {
    return this.calls.probe(target, readContract, async (probe) => {
      const inspected = inspection(probe);
      return { ...inspected, support: await this.support(target.endpoint, inspected) };
    });
  }
  /** Replay scopes are asked for only when the answer they would qualify is supported. A proof
   * that cannot be established leaves only that answer unknown, never the whole inspection. */
  private async support(endpoint: string, inspection: Inspected): Promise<T3Support> {
    const support = contractSupport(inspection.state === "ready", inspection.contract?.tools ?? []);
    const { checkout, worktree } = support.launch;
    /** undefined: the proof was asked for and could not be established. */
    const proven = async (proof: LiveT3ContractOptions["launchRecoveryScope"]) => {
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
}
