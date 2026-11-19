import type { AgentEnvironment } from "@t3-factory/contracts";
import { T3Failure } from "../../src/t3/connection.ts";
import { ControlledT3Connection } from "./controlled-t3-connection.ts";
import { ControlledT3Contract } from "./controlled-t3-contract.ts";
import type { T3Modules } from "../../src/t3/modules.ts";
import { ControlledAppearance } from "./controlled-appearance.ts";
import type {
  AttachmentUpload,
  LaunchPayload,
  LaunchReference,
  T3Adapter,
  LaunchCandidate,
  T3Project,
  T3ProviderCapability,
} from "../../src/adapters/t3.ts";
import type {
  T3Endpoint,
  T3EnvironmentTarget,
  T3Target,
  T3ProjectTarget,
} from "../../src/t3/connection.ts";

/** Independent external-engine lifetime; no SQL or Factory internals. */
export class ControlledT3 implements T3Modules, T3Adapter {
  readonly connection = new ControlledT3Connection();
  readonly contract = new ControlledT3Contract(this.connection);

  get adapter(): T3Adapter {
    return this;
  }

  readonly settledThreads = new Set<string>();
  readonly settlements: { threadId: string }[] = [];
  async settleThread(_target: T3Endpoint, payload: { threadId: string }) {
    this.connection.requireConnection();
    this.settlements.push(payload);
    this.settledThreads.add(payload.threadId);
  }
  readonly threadStops: { threadId: string; clientRequestId: string }[] = [];
  async stopThread(
    _target: T3Endpoint,
    payload: { threadId: string; clientRequestId: string },
  ): ReturnType<T3Adapter["stopThread"]> {
    this.threadStops.push(payload);
  }
  loseLaunchReply = false;
  beforeLaunch?: (payload: LaunchPayload) => Promise<void>;
  /** Every launch call received, including same-key replays T3 would not deduplicate. */
  launchCalls = 0;
  readonly launches = new Map<string, { payload: LaunchPayload; reference: LaunchReference }>();
  engineStatus = "running";
  pendingRequestCount = 0;
  /** Every pending upload T3 accepted, by attachment id, with the exact bytes received. */
  readonly uploads = new Map<string, { upload: AttachmentUpload; data: Uint8Array }>();
  uploadCalls = 0;
  failUploads = false;
  beforeUpload?: (upload: AttachmentUpload) => Promise<void>;
  async uploadAttachment(_target: T3Endpoint, upload: AttachmentUpload, data: Uint8Array) {
    this.connection.requireConnection();
    await this.beforeUpload?.(upload);
    this.uploadCalls++;
    if (this.failUploads)
      throw new T3Failure("unavailable", "T3 answered the upload with HTTP 500.");
    const id = `pending-${this.uploads.size + 1}`;
    this.uploads.set(id, { upload, data: Uint8Array.from(data) });
    return id;
  }
  protected launchIds(n: number) {
    return { threadId: `thread-${n}`, runId: `execution-${n}` };
  }
  private readonly launchWaiters: ((payload: LaunchPayload) => void)[] = [];
  /** Resolves with the payload of the next worker launch T3 records: a completion signal for
   * launches background work issues. */
  nextLaunch() {
    return new Promise<LaunchPayload>((resolve) => this.launchWaiters.push(resolve));
  }
  async launchThread(_target: T3Endpoint, payload: LaunchPayload) {
    this.connection.requireConnection();
    await this.beforeLaunch?.(payload);
    this.launchCalls++;
    if (payload.attachments?.some((attachment) => !this.uploads.has(attachment.id)))
      throw new T3Failure("refused", "Attachment not found (removed or expired).");
    let launch = this.launches.get(payload.clientRequestId);
    if (launch && JSON.stringify(launch.payload) !== JSON.stringify(payload))
      throw new T3Failure("refused", "Key conflict");
    if (!launch) {
      const { threadId, runId } = this.launchIds(this.launches.size + 1);
      launch = {
        payload,
        reference: {
          projectId: payload.projectId,
          threadId,
          runId,
          link: `t3://threads/${threadId}`,
          status: "running",
        },
      };
      this.launches.set(payload.clientRequestId, launch);
      for (const notify of this.launchWaiters.splice(0)) notify(payload);
    }
    if (this.rejectLaunch) throw new T3Failure("refused", "T3 rejected the worker launch");
    if (this.loseLaunchReply)
      throw new T3Failure("unavailable", "Lost response after remote acceptance");
    return launch.reference;
  }
  private launchedThread(threadId: string) {
    return [...this.launches.values()].find((entry) => entry.reference.threadId === threadId);
  }
  /** While true, worktree-creating threads show no path or branch yet, as T3 before it creates the worktree. */
  worktreeMetadataPending = false;
  /** While true, worktree-creating threads show their path before their branch. */
  worktreeBranchPending = false;
  /** Root threads report `checkout`; worktree threads report T3's path and the requested branch. */
  private threadWorkspace(payload: LaunchPayload, threadId: string, checkout: string | null) {
    const strategy = payload.workspaceStrategy;
    if (strategy.type === "root") return { workspaceRoot: checkout, branch: null };
    if (strategy.type === "existing_worktree")
      return { workspaceRoot: strategy.worktreePath, branch: strategy.branch };
    if (this.worktreeMetadataPending) return { workspaceRoot: null, branch: null };
    return {
      workspaceRoot: `/t3-worktrees/${threadId}`,
      branch: this.worktreeBranchPending ? null : strategy.branch,
    };
  }
  rejectLaunch = false;
  discoverAvailable = true;
  /** Live root-strategy threads report the project checkout as a null worktree. */
  reportCheckoutWorkspace = false;
  omitCandidateOptions = false;
  readonly extraCandidates: LaunchCandidate[] = [];
  async discoverLaunchCandidates(
    target: T3Target,
    _title: string,
  ): ReturnType<T3Adapter["discoverLaunchCandidates"]> {
    if (!this.discoverAvailable || !this.connection.available || !this.connection.authorized)
      return { available: false };
    const candidates = [...this.launches.values()].map((launch) =>
      this.launchCandidate(target, launch),
    );
    return { available: true, candidates: [...candidates, ...this.extraCandidates] };
  }
  async readThreadIdentity(
    target: T3Target,
    threadId: string,
  ): ReturnType<T3Adapter["readThreadIdentity"]> {
    const launch = this.launchedThread(threadId);
    this.connection.requireConnection("Unknown thread");
    if (!launch) throw new T3Failure("refused", "Unknown thread");
    const observation = await this.readExecution(target, threadId);
    return {
      threadId,
      projectId: launch.payload.projectId,
      parentThreadId: null,
      ...this.threadWorkspace(
        launch.payload,
        threadId,
        this.reportCheckoutWorkspace ? null : target.workspaceRoot,
      ),
      providerInstanceId: launch.payload.modelSelection.instanceId,
      model: launch.payload.modelSelection.model,
      executions: observation.recentRuns.map((run) => ({
        runId: run.runId,
        providerInstanceId: launch.payload.modelSelection.instanceId,
        model: launch.payload.modelSelection.model,
        status: run.status,
      })),
    };
  }
  private launchCandidate(
    target: T3Target,
    launch: { payload: LaunchPayload; reference: LaunchReference },
  ): LaunchCandidate {
    const { payload, reference } = launch;
    return {
      title: payload.title,
      projectId: payload.projectId,
      parentThreadId: null,
      ...this.threadWorkspace(payload, reference.threadId, target.workspaceRoot),
      interactionMode: payload.interactionMode,
      providerInstanceId: payload.modelSelection.instanceId,
      model: payload.modelSelection.model,
      options: this.omitCandidateOptions ? null : { ...payload.modelSelection.options },
      threadId: reference.threadId,
      executions: [
        {
          runId: reference.runId,
          providerInstanceId: payload.modelSelection.instanceId,
          model: payload.modelSelection.model,
          status: reference.status,
        },
      ],
      link: reference.link,
    };
  }
  loseSendReply = false;
  beforeSend?: (payload: import("../../src/adapters/t3.ts").SendPayload) => Promise<void>;
  readonly sends = new Map<
    string,
    {
      payload: import("../../src/adapters/t3.ts").SendPayload;
      reference: import("../../src/adapters/t3.ts").SendReference;
    }
  >();
  private readonly sendWaiters: ((
    payload: import("../../src/adapters/t3.ts").SendPayload,
  ) => void)[] = [];
  /** Resolves with the payload of the next send T3 records, as `nextLaunch` does for launches. */
  nextSend() {
    return new Promise<import("../../src/adapters/t3.ts").SendPayload>((resolve) =>
      this.sendWaiters.push(resolve),
    );
  }
  async sendMessage(_target: T3Endpoint, payload: import("../../src/adapters/t3.ts").SendPayload) {
    this.connection.requireConnection();
    await this.beforeSend?.(payload);
    let accepted = this.sends.get(payload.clientRequestId);
    if (accepted && JSON.stringify(accepted.payload) !== JSON.stringify(payload))
      throw new T3Failure("refused", "Key conflict");
    if (!accepted) {
      accepted = {
        payload,
        reference: {
          threadId: payload.threadId,
          messageId: `message-${this.sends.size + 1}`,
          runId: `queued-${this.sends.size + 1}`,
          status: "queued",
          delivery: "queued",
        },
      };
      this.sends.set(payload.clientRequestId, accepted);
      this.settledThreads.delete(payload.threadId);
      for (const notify of this.sendWaiters.splice(0)) notify(payload);
    }
    if (this.loseSendReply) throw new T3Failure("unavailable", "Lost send acknowledgement");
    return accepted.reference;
  }
  readonly executionObservations = new Map<
    string,
    import("../../src/adapters/t3.ts").ExecutionObservation
  >();
  executionObservation?: import("../../src/adapters/t3.ts").ExecutionObservation;
  executionReads = 0;
  async readExecution(
    _target: T3Endpoint,
    threadId: string,
  ): ReturnType<T3Adapter["readExecution"]> {
    this.connection.requireConnection();
    this.executionReads++;
    const observation = this.executionObservations.get(threadId) ?? this.executionObservation;
    if (observation) return observation;
    const launch = this.launchedThread(threadId);
    if (!launch) throw new T3Failure("refused", "Unknown thread");
    const { projectId, runId, link } = launch.reference;
    const launchRun = [{ runId, status: this.engineStatus }];
    const sentRuns = [...this.sends.values()]
      .filter((s) => s.payload.threadId === threadId)
      .map((s) => ({ runId: s.reference.runId, status: s.reference.status }));
    const { workspaceRoot, branch } = this.threadWorkspace(
      launch.payload,
      threadId,
      this.projects.find((p) => p.projectId === projectId)?.workspaceRoot ?? null,
    );
    return {
      projectId,
      threadId,
      latestRunId: runId,
      activeRunId: this.engineStatus === "running" ? runId : null,
      link,
      workspaceRoot,
      ...(launch.payload.workspaceStrategy.type === "root"
        ? {}
        : { repository: { branch, pullRequests: [] } }),
      pendingRequestCount: this.pendingRequestCount,
      recentRuns: [...launchRun, ...sentRuns].map((run, n) => ({ ...run, ordinal: n + 1 })),
    };
  }
  /** T3's delegated-work answer per `[threadId, runId]`; unanswered runs are unknown. */
  readonly delegatedSettlements = new Map<
    string,
    import("../../src/adapters/delegated-settlement.ts").DelegatedSettlement
  >();
  async readDelegatedSettlement(
    _target: T3Endpoint,
    threadId: string,
    runId: string,
  ): Promise<import("../../src/adapters/delegated-settlement.ts").DelegatedSettlement> {
    this.connection.requireConnection();
    return (
      this.delegatedSettlements.get(JSON.stringify([threadId, runId])) ?? {
        threadId,
        runId,
        state: "unknown",
        status: null,
        problem: "Controlled delegated settlement has not been supplied.",
      }
    );
  }
  projects: T3Project[] = [];
  projectCreates = 0;
  async listProjects(_target: T3EnvironmentTarget) {
    this.connection.requireConnection();
    if (!this.contract.compatible) throw new T3Failure("refused", "Unavailable");
    return this.projects;
  }
  async createProject(target: T3ProjectTarget) {
    await this.listProjects({
      endpoint: target.endpoint,
      environmentId: target.environmentId,
    });
    this.projectCreates++;
    const project = {
      projectId: `created-${this.projectCreates}`,
      title: "New repository",
      workspaceRoot: target.workspaceRoot,
      available: true,
    };
    this.projects.push(project);
    return project;
  }
  capabilitiesAvailable = true;
  /** Environment and orchestrator capability reads Factory sent, including refused ones. */
  capabilityReads = 0;
  readonly controlledProviders: T3ProviderCapability[] = [
    {
      providerInstanceId: "codex-main",
      displayName: "Codex",
      driverKind: "codex",
      models: [
        {
          id: "gpt-6.1-sol",
          label: "GPT 6.1 Sol",
          options: [
            {
              id: "reasoning",
              label: "Reasoning effort",
              type: "select",
              choices: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
            },
          ],
        },
      ],
    },
  ];
  async readEnvironment(_target: T3Endpoint): Promise<AgentEnvironment> {
    this.capabilityReads++;
    this.connection.requireConnection("External failure containing secret material");
    return { environmentId: this.connection.environmentId, label: "Controlled machine" };
  }
  beforeCapabilityRead?: () => Promise<void>;
  async orchestratorCapabilities(_target: T3Endpoint): Promise<readonly T3ProviderCapability[]> {
    this.capabilityReads++;
    await this.beforeCapabilityRead?.();
    this.connection.requireConnection("External failure containing secret material");
    if (!this.capabilitiesAvailable)
      throw new T3Failure("unavailable", "Capabilities are temporarily unavailable");
    return this.controlledProviders;
  }
  /** `t3_theme_read` of the same environment. */
  readonly appearance = new ControlledAppearance();
  async readTheme(_target: T3Endpoint) {
    this.connection.requireConnection();
    return this.appearance.read(this.connection.environmentId);
  }
  async close() {}
}

/** The inspections a Start makes before it accepts: its T3 contract snapshot, which its Project
 * catalog refresh and every Agent's runtime readiness check reuse. */
export const START_INSPECTIONS = 1;

/** While T3 answers the next Agent capability read, such as an Agent's readiness check, T3 changes
 * its report support and a separate connection check publishes that answer. */
export function changeReportSupportAtCapabilityRead(
  t3: ControlledT3,
  recheckConnection: () => Promise<unknown>,
  reportReads: boolean,
) {
  t3.beforeCapabilityRead = async () => {
    delete t3.beforeCapabilityRead;
    t3.contract.support.reportReads = reportReads;
    await recheckConnection();
  };
}
