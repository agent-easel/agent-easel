import {
  T3Failure,
  type DispatchFence,
  type T3Endpoint,
  type T3Target,
} from "../../src/t3/connection.ts";
import type { DelegatedSettlement } from "../../src/t3/delegated-settlement.ts";
import type {
  AttachmentUpload,
  ExecutionObservation,
  LaunchCandidate,
  LaunchPayload,
  LaunchReference,
  SendPayload,
  SendReference,
  T3Threads,
  WorkerTitleRenameDisposition,
  WorkerTitleRenameRequest,
} from "../../src/t3/threads.ts";
import type { ControlledT3Connection } from "./controlled-t3-connection.ts";

export type ThreadFacts = Partial<Pick<ExecutionObservation, "repository" | "pendingRequestCount">>;

const terminalStatuses = ["completed", "failed", "cancelled", "interrupted", "rolled_back"];

/** Simulated worker-thread facts, independent of Factory bindings and Run projections. */
export class ControlledT3Threads implements T3Threads {
  private readonly connection: ControlledT3Connection;
  private readonly projectWorkspace: (projectId: string) => string | null;

  constructor(
    connection: ControlledT3Connection,
    projectWorkspace: (projectId: string) => string | null,
  ) {
    this.connection = connection;
    this.projectWorkspace = projectWorkspace;
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
  ): ReturnType<T3Threads["stopThread"]> {
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
  readonly remoteTitles = new Map<string, string>();
  readonly renames: WorkerTitleRenameRequest[] = [];
  readonly renameReceipts = new Map<string, { threadId: string; title: string }>();
  readonly deletedThreads = new Set<string>();
  loseRenameReply = false;
  afterRename?: () => Promise<void>;
  holdRenameReply() {
    let release = () => {};
    const reply = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.afterRename = () => {
      delete this.afterRename;
      return reply;
    };
    return release;
  }
  compactRenameKeys = new Set<string>();
  renameDisposition: WorkerTitleRenameDisposition | undefined;
  beforeRename?: (request: WorkerTitleRenameRequest) => Promise<void>;
  private readonly renameWaiters: ((request: WorkerTitleRenameRequest) => void)[] = [];
  nextRename() {
    return new Promise<WorkerTitleRenameRequest>((resolve) => this.renameWaiters.push(resolve));
  }
  threadTitle(threadId: string) {
    return this.remoteTitles.get(threadId) ?? this.launchedThread(threadId)?.payload.title;
  }
  async renameThread(
    target: T3Endpoint & DispatchFence,
    request: WorkerTitleRenameRequest,
  ): Promise<WorkerTitleRenameDisposition> {
    this.connection.requireConnection();
    await this.beforeRename?.(request);
    if (!(await target.authorizeDispatch())) return { kind: "unavailable" };
    if (target.signal.aborted || this.connection.identity !== target.authorizationIdentity) {
      await target.refuseDispatch();
      return { kind: "unavailable" };
    }
    this.renames.push(request);
    for (const notify of this.renameWaiters.splice(0)) notify(request);
    if (this.renameDisposition) return this.renameDisposition;
    if (this.deletedThreads.has(request.threadId) || !this.launchedThread(request.threadId))
      return { kind: "thread-not-found" };
    const receipt = this.renameReceipts.get(request.clientRequestId);
    if (!receipt) {
      this.remoteTitles.set(request.threadId, request.title);
      this.renameReceipts.set(request.clientRequestId, {
        threadId: request.threadId,
        title: request.title,
      });
    }
    await this.afterRename?.();
    if (this.loseRenameReply) return { kind: "unavailable" };
    const title = this.compactRenameKeys.has(request.clientRequestId)
      ? (this.threadTitle(request.threadId) ?? request.title)
      : (receipt?.title ?? request.title);
    return title === request.title
      ? { kind: "acknowledged", threadId: request.threadId, title }
      : { kind: "different-title", threadId: request.threadId, title };
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
  ): ReturnType<T3Threads["discoverLaunchCandidates"]> {
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
  ): ReturnType<T3Threads["readThreadIdentity"]> {
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
      title: this.threadTitle(reference.threadId) ?? payload.title,
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
  private readonly startCalls = new Map<string, Set<string>>();
  recordStartCall(threadId: string, requestId: string) {
    this.startCalls.set(threadId, new Set([...(this.startCalls.get(threadId) ?? []), requestId]));
  }
  async findStartCall(_target: T3Endpoint, threadId: string, requestId: string) {
    this.connection.requireConnection();
    return this.startCalls.get(threadId)?.has(requestId) === true;
  }
  readonly refusedSendThreads = new Set<string>();
  loseSendReply = false;
  beforeSend?: (payload: SendPayload) => Promise<void>;
  readonly sends = new Map<
    string,
    {
      payload: SendPayload;
      reference: SendReference;
    }
  >();
  private readonly sendWaiters: ((payload: SendPayload) => void)[] = [];
  /** Resolves with the payload of the next send T3 records, as `nextLaunch` does for launches. */
  nextSend() {
    return new Promise<SendPayload>((resolve) => this.sendWaiters.push(resolve));
  }
  async sendMessage(_target: T3Endpoint, payload: SendPayload) {
    this.connection.requireConnection();
    await this.beforeSend?.(payload);
    if (this.refusedSendThreads.has(payload.threadId))
      throw new T3Failure("refused", "runtime_mode_escalation_denied");
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
  readonly executionObservations = new Map<string, ExecutionObservation>();
  executionObservation?: ExecutionObservation;
  executionReads = 0;
  async readExecution(
    _target: T3Endpoint,
    threadId: string,
  ): ReturnType<T3Threads["readExecution"]> {
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
      this.projectWorkspace(projectId),
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
  readonly delegatedSettlements = new Map<string, DelegatedSettlement>();
  async readDelegatedSettlement(
    _target: T3Endpoint,
    threadId: string,
    runId: string,
  ): Promise<DelegatedSettlement> {
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

  private statedThread(threadId: string, fact: string) {
    const thread = this.executionObservations.get(threadId);
    if (!thread) throw Error(`T3 fact "${fact}": thread ${threadId} has no stated observation.`);
    return thread;
  }

  /** T3's read of the thread also shows `facts`: its repository, or pending native requests. */
  recordThreadFacts(threadId: string, facts: ThreadFacts) {
    this.executionObservations.set(threadId, {
      ...this.statedThread(threadId, "thread facts"),
      ...facts,
    });
  }

  /** T3's `t3_thread_wait` answer for one run of a thread with its delegated and background work. */
  answerDelegatedWait(
    threadId: string,
    runId: string,
    state: "settled" | "pending",
    status: string,
  ) {
    this.delegatedSettlements.set(JSON.stringify([threadId, runId]), {
      threadId,
      runId,
      state,
      status,
    });
  }

  /**
   * T3 shows a thread it launched, with its first turn running, as that thread's stated
   * observation; the later turn facts change it. A thread already stated keeps its facts.
   */
  async recordLaunchedThread(threadId: string) {
    if (this.executionObservations.has(threadId)) return;
    this.executionObservations.set(threadId, await this.readExecution({ endpoint: "" }, threadId));
  }

  /** A turn begins: run `runId` of the thread runs, and T3 answers its delegated wait as pending.
   * A send whose run this is shows it running. */
  beginThreadRun(threadId: string, runId: string) {
    const prior = this.statedThread(threadId, "turn begins");
    this.executionObservations.set(threadId, {
      ...prior,
      activeRunId: runId,
      latestRunId: runId,
      recentRuns: [
        ...prior.recentRuns,
        {
          runId,
          status: "running",
          ordinal: 1 + Math.max(0, ...prior.recentRuns.map((run) => run.ordinal ?? 0)),
          startedAt: new Date().toISOString(),
        },
      ],
    });
    this.answerDelegatedWait(threadId, runId, "pending", "running");
    for (const send of this.sends.values())
      if (send.reference.runId === runId) send.reference = { ...send.reference, status: "running" };
  }

  /** The user queued a message in the thread in T3: its run `runId` waits queued. As in T3, the
   * queued run takes the next ordinal and becomes the thread's latest run, and its wait answers
   * pending. */
  queueUserMessage(threadId: string, runId: string) {
    const prior = this.statedThread(threadId, "user queues a message");
    this.executionObservations.set(threadId, {
      ...prior,
      latestRunId: runId,
      recentRuns: [
        ...prior.recentRuns,
        {
          runId,
          status: "queued",
          ordinal: 1 + Math.max(0, ...prior.recentRuns.map((run) => run.ordinal ?? 0)),
        },
      ],
    });
    this.answerDelegatedWait(threadId, runId, "pending", "queued");
  }

  /** T3 starts a send it queued once the thread runs no turn: the send's queued run runs and the
   * send shows it running with its delivery started. Until then the send stays queued. */
  protected startQueuedSend(threadId: string, runId: string): boolean {
    const thread = this.executionObservations.get(threadId);
    const queued = thread?.recentRuns.find((run) => run.runId === runId)?.status === "queued";
    if (!thread || !queued || thread.activeRunId) return false;
    this.executionObservations.set(threadId, {
      ...thread,
      activeRunId: runId,
      latestRunId: runId,
      recentRuns: thread.recentRuns.map((run) =>
        run.runId === runId ? { ...run, status: "running" } : run,
      ),
    });
    for (const send of this.sends.values())
      if (send.reference.runId === runId)
        send.reference = { ...send.reference, status: "running", delivery: "started" };
    return true;
  }

  /** T3 cancels a turn queued on the thread: run `runId` shows status cancelled with `start` as its
   * start evidence (an explicit null start never ran), and its wait answers settled. A run the
   * thread does not show yet takes the next ordinal and becomes the thread's latest run. */
  queuedRunCancelled(
    threadId: string,
    runId: string,
    start: { readonly startedAt?: string | null },
  ) {
    const prior = this.statedThread(threadId, "queued turn cancelled");
    const queued = prior.recentRuns.find((run) => run.runId === runId);
    const ordinal = 1 + Math.max(0, ...prior.recentRuns.map((run) => run.ordinal ?? 0));
    const cancelled = { runId, status: "cancelled", ordinal: queued?.ordinal ?? ordinal, ...start };
    this.executionObservations.set(threadId, {
      ...prior,
      ...(queued ? {} : { latestRunId: runId }),
      recentRuns: queued
        ? prior.recentRuns.map((run) => (run.runId === runId ? cancelled : run))
        : [...prior.recentRuns, cancelled],
    });
    this.answerDelegatedWait(threadId, runId, "settled", "cancelled");
  }

  /** A turn ends: run `runId` of the thread ends with `status`, and T3 answers its delegated wait
   * as settled. A send whose run this is shows the same status. */
  endThreadRun(threadId: string, runId: string, status = "completed") {
    const prior = this.statedThread(threadId, "turn ends");
    this.executionObservations.set(threadId, {
      ...prior,
      activeRunId: prior.activeRunId === runId ? null : prior.activeRunId,
      recentRuns: prior.recentRuns.map((run) =>
        run.runId === runId ? { ...run, status, completedAt: new Date().toISOString() } : run,
      ),
    });
    this.answerDelegatedWait(threadId, runId, "settled", status);
    for (const send of this.sends.values())
      if (send.reference.runId === runId) send.reference = { ...send.reference, status };
  }

  /** Whenever T3 accepts a send to the thread, it shows the thread busy again: its latest turn
   * runs, with the send queued behind it. This is the controlled engine's own read of a launched thread whose
   * engine runs again once a send arrives, which the worktree review tests were written against. */
  busyAgainOnSend(threadId: string) {
    const send = this.sendMessage.bind(this);
    this.sendMessage = async (target, payload) => {
      const reference = await send(target, payload);
      if (payload.threadId !== threadId) return reference;
      const thread = this.statedThread(threadId, "busy again on send");
      const latest = thread.latestRunId;
      const runs = thread.recentRuns.map(({ completedAt: _completedAt, ...run }, index) =>
        run.runId === latest ? { ...run, status: "running" } : thread.recentRuns[index]!,
      );
      this.executionObservations.set(threadId, {
        ...thread,
        activeRunId: latest ?? null,
        recentRuns: runs.some((run) => run.runId === reference.runId)
          ? runs
          : [
              ...runs,
              { runId: reference.runId, status: reference.status, ordinal: runs.length + 1 },
            ],
      });
      return reference;
    };
  }

  /** T3 carries out every thread Stop at once: each unfinished run of the stopped thread ends
   * interrupted, with its delegated work settled. Until then Stop is only acknowledged. */
  stopsEndThreads() {
    const stop = this.stopThread.bind(this);
    this.stopThread = async (target, payload) => {
      await stop(target, payload);
      const thread = this.statedThread(payload.threadId, "Stop ends the thread");
      for (const run of thread.recentRuns)
        if (!terminalStatuses.includes(run.status))
          this.endThreadRun(payload.threadId, run.runId, "interrupted");
    };
  }
}
