import type { CallToolResult, Tool } from "@modelcontextprotocol/server";
import type {
  FactoryOperations,
  ReportingInstallation,
  Result,
  T3Connection,
  ValidationIssue,
} from "@agent-easel/contracts";
import { textResult, toolArguments } from "./authoring-tools.ts";

export type StartDiagnosisOperations = Pick<
  FactoryOperations,
  "getConnection" | "recheckConnection" | "getReportingInstallations" | "installReporting"
> & { checkStart(projectId: string, flowId: string): Promise<Result<undefined>> };

const POINT_IN_TIME =
  "This is a point-in-time check of the current state. Factory's Start revalidates every blocker when it runs, so ready now does not promise that a later Start is accepted.";
const FRESH_SESSION =
  "A harness session keeps the tools and skills it loaded at start: after installing or repairing reporting, open a new agent session before relying on it.";

export const startDiagnosisTools: Tool[] = [
  {
    name: "factory_check_start",
    description: `Preflight a Start: report what currently blocks starting a saved Flow in a Project, or that it is ready. It is host-local and inspect-only: it applies the same blockers as factory_start_run (Project and Flow ownership, the T3 connection and its launch capabilities, Flow readiness, each Agent's resolved settings and Factory reporting installation, and worktree prerequisites for a worktree Flow), and creates no Run, Task, worktree or worker, writes no harness configuration and sends no prompt. It rechecks the T3 connection and refreshes Factory's Project catalog, as Start does, so it contacts T3. It does not check a prompt, images or completed GitHub issues. ${POINT_IN_TIME} Reply: status (ready or blocked), blockers [{code, path, message}], the connection state and next steps. Diagnose first; when the blocker is reporting, list the targets with factory_list_reporting_installations and install or repair only on the user's instruction, then call this tool again.`,
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          minLength: 1,
          description: "A Project id from factory_list_projects.",
        },
        flowId: {
          type: "string",
          minLength: 1,
          description:
            "A saved Flow id from factory_list_flows: a global Flow or one this Project owns.",
        },
      },
      required: ["projectId", "flowId"],
      additionalProperties: false,
    },
  },
  {
    name: "factory_get_t3_connection",
    description: `Read Factory's T3 connection status: state (ready, unavailable, authorization-required or incompatible), the explanation, endpoint, when it was last checked, whether an approval is pending, T3's version and its contract problems. It is host-local and inspect-only and writes no harness configuration. By default it returns what Factory last saw; with recheck true Factory inspects T3 now, which contacts T3 but never opens a browser or starts an authorization. Connected does not prove Project availability, provider or model availability or reporting installation: factory_check_start checks those. Endpoint credentials, OAuth authorization and approved-client management stay in Factory's Settings on the host; no tool here changes them. ${POINT_IN_TIME}`,
    inputSchema: {
      type: "object",
      properties: {
        recheck: {
          type: "boolean",
          description: "true: inspect T3 now. Default false: the last check's result.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "factory_list_reporting_installations",
    description: `List the harness homes where Factory reporting can be installed, as Settings → Agent reporting lists them, with each target's id, provider, instances, configuration path and skills folder, status (installed, not-installed, needs-attention or unsupported), message, the action this server offers (install, repair or none) and next step. It is host-local and inspect-only: it reads harness configuration files and writes nothing. Only the listed targets can be installed; a conflicting factory-runtime entry, an inaccessible home, an unsupported provider and a remote T3 host are diagnostics for the user to fix. ${POINT_IN_TIME}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "factory_install_reporting",
    description: `Install or repair Factory reporting in one target from factory_list_reporting_installations. This call WRITES harness configuration: Factory's own factory-runtime MCP entry in the target's configuration file and Factory's skills in its skills folder, through the same installation as Settings → Agent reporting, with its validation. Call it only for a target whose action is install or repair and only on the user's instruction, after diagnosing with factory_check_start. It refuses unknown targets, installed targets and targets that need a manual fix, and changes nothing then. It never touches endpoint credentials, OAuth authorization or approved clients. ${FRESH_SESSION} Afterwards call factory_check_start again.`,
    inputSchema: {
      type: "object",
      properties: {
        targetId: {
          type: "string",
          minLength: 1,
          description: "A target id from factory_list_reporting_installations.",
        },
      },
      required: ["targetId"],
      additionalProperties: false,
    },
  },
];

const validation = (path: string, message: string, next: string): CallToolResult =>
  textResult(true, {
    code: "validation",
    message,
    issues: [{ code: "invalid_argument", path, message }],
    next,
  });

const unsupportedArguments = (args: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(args).some((key) => !allowed.includes(key))
    ? validation(
        "arguments",
        `Send only ${allowed.join(", ") || "no arguments"}.`,
        "Call the tool again with its documented arguments.",
      )
    : undefined;

const failedNext = "Recheck the Factory backend, then call the tool again.";

function failedResult(error: {
  code: string;
  message: string;
  issues: readonly ValidationIssue[];
}) {
  return textResult(true, {
    code: error.code,
    message: error.message,
    issues: error.issues,
    next: failedNext,
  });
}

function connectionNext(connection: T3Connection) {
  switch (connection.state) {
    case "ready":
      return "Connected does not prove Project, provider, model or reporting readiness. Call factory_check_start for a Project and Flow.";
    case "authorization-required":
      return "The user approves T3 access on the Factory host in Settings → T3 connection; no tool here authorizes it. Recheck after they have.";
    case "incompatible":
      return "T3's MCP protocol or contract is unsupported. The user can update T3, then recheck.";
    case "unavailable":
      return "Check that T3 is running and the saved address is right in Settings → T3 connection on the Factory host, then recheck.";
  }
}

async function getT3Connection(factory: StartDiagnosisOperations, args: Record<string, unknown>) {
  const refused = unsupportedArguments(args, ["recheck"]);
  if (refused) return refused;
  const { recheck } = args;
  if (recheck !== undefined && typeof recheck !== "boolean")
    return validation("recheck", "recheck must be true or false.", "Send a boolean or omit it.");
  const read = recheck ? await factory.recheckConnection() : await factory.getConnection();
  if (!read.ok) return failedResult(read.error);
  const connection = read.value;
  return textResult(false, {
    rechecked: recheck === true,
    state: connection.state,
    explanation: connection.explanation,
    endpoint: connection.endpoint,
    checkedAt: connection.checkedAt,
    authorizationPending: connection.authorizationPending,
    serverVersion: connection.contract?.serverVersion ?? null,
    problems: connection.contract?.problems ?? [],
    next: connectionNext(connection),
    note: POINT_IN_TIME,
  });
}

const REPORTING_CODES = ["reporting_installation", "harness_unsupported"];

async function checkStart(factory: StartDiagnosisOperations, args: Record<string, unknown>) {
  const refused = unsupportedArguments(args, ["projectId", "flowId"]);
  if (refused) return refused;
  const { projectId, flowId } = args;
  if (typeof projectId !== "string" || !projectId.trim())
    return validation("projectId", "Send a Project id.", "Find one with factory_list_projects.");
  if (typeof flowId !== "string" || !flowId.trim())
    return validation("flowId", "Send a saved Flow id.", "Find one with factory_list_flows.");
  const checked = await factory.checkStart(projectId, flowId);
  if (!checked.ok && !["validation", "not_found"].includes(checked.error.code))
    return failedResult(checked.error);
  const connection = await factory.getConnection();
  const connectionState = connection.ok
    ? {
        state: connection.value.state,
        explanation: connection.value.explanation,
        checkedAt: connection.value.checkedAt,
      }
    : null;
  if (checked.ok)
    return textResult(false, {
      status: "ready",
      blockers: [],
      connection: connectionState,
      next: "Nothing blocks Start now. Starting is the user's decision: factory_start_run needs their confirmed Project, Flow and prompt.",
      note: POINT_IN_TIME,
    });
  const { message, issues } = checked.error;
  const blockers = issues.length
    ? issues.map(({ code, path, message }) => ({ code, path, message }))
    : [{ code: checked.error.code, path: "", message }];
  const reporting = blockers.some((blocker) =>
    REPORTING_CODES.some((code) => blocker.code.startsWith(code)),
  );
  return textResult(false, {
    status: "blocked",
    message,
    blockers,
    connection: connectionState,
    next: reporting
      ? "A reporting blocker: call factory_list_reporting_installations. Install or repair the target only when the user asks, then call factory_check_start again; an unsupported provider is changed in Studio → Agents."
      : "Explain the blockers to the user. Changing definitions, Projects or T3 setup is their decision; use factory_get_t3_connection with recheck for a connection blocker, then call factory_check_start again.",
    note: POINT_IN_TIME,
  });
}

const offeredAction = (target: ReportingInstallation) =>
  target.actions.install ? "install" : target.actions.repair ? "repair" : "none";

function installationView(target: ReportingInstallation) {
  const action = offeredAction(target);
  return {
    id: target.id,
    kind: target.kind,
    provider: target.provider,
    instances: target.instances,
    path: target.path,
    skillsPath: target.skillsPath,
    status: target.status,
    message: target.message,
    launchSkill: target.launchSkill,
    runtimeEvidence: target.runtimeEvidence,
    action,
    next:
      action === "none"
        ? "No install or repair is offered here. Read message; the user fixes what it names, for example in Settings → Agent reporting."
        : `Only on the user's instruction, call factory_install_reporting({targetId}) to ${action} this target. ${FRESH_SESSION}`,
  };
}

async function listReportingInstallations(
  factory: StartDiagnosisOperations,
  args: Record<string, unknown>,
) {
  const refused = unsupportedArguments(args, []);
  if (refused) return refused;
  const listed = await factory.getReportingInstallations();
  if (!listed.ok) return failedResult(listed.error);
  return textResult(false, {
    installations: listed.value.map(installationView),
    note: POINT_IN_TIME,
  });
}

async function installReporting(factory: StartDiagnosisOperations, args: Record<string, unknown>) {
  const refused = unsupportedArguments(args, ["targetId"]);
  if (refused) return refused;
  const { targetId } = args;
  if (typeof targetId !== "string" || !targetId)
    return validation(
      "targetId",
      "Send a target id.",
      "Take one from factory_list_reporting_installations.",
    );
  const listed = await factory.getReportingInstallations();
  if (!listed.ok) return failedResult(listed.error);
  const target = listed.value.find((candidate) => candidate.id === targetId);
  if (!target)
    return validation(
      "targetId",
      "This target is not listed. Nothing was written.",
      "Take a current id from factory_list_reporting_installations.",
    );
  if (offeredAction(target) === "none")
    return validation(
      "targetId",
      `Nothing to install or repair here. Nothing was written. ${target.message}`,
      "Read the target's message; a manual fix is the user's decision.",
    );
  const installed = await factory.installReporting({ targetId });
  if (!installed.ok)
    return textResult(true, {
      code: installed.error.code,
      message: installed.error.message,
      issues: installed.error.issues,
      next: "Read the message; the user fixes the target's configuration or permissions. Then list the targets again.",
    });
  return textResult(false, {
    installation: installationView(installed.value),
    next: `${FRESH_SESSION} Then call factory_check_start again for the Project and Flow.`,
  });
}

const diagnosisCalls: Record<
  string,
  (factory: StartDiagnosisOperations, args: Record<string, unknown>) => Promise<CallToolResult>
> = {
  factory_check_start: checkStart,
  factory_get_t3_connection: getT3Connection,
  factory_list_reporting_installations: listReportingInstallations,
  factory_install_reporting: installReporting,
};

export async function callStartDiagnosisTool(
  factory: StartDiagnosisOperations,
  name: string,
  args: unknown,
): Promise<CallToolResult | undefined> {
  if (!Object.hasOwn(diagnosisCalls, name)) return undefined;
  try {
    return await diagnosisCalls[name]!(factory, toolArguments(args));
  } catch {
    return textResult(true, {
      code: "internal",
      message: "Factory could not complete this call.",
      issues: [],
      next:
        name === "factory_install_reporting"
          ? "The outcome is unknown. List the reporting targets again to see what was written."
          : failedNext,
    });
  }
}
