import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeState } from "./write-state.ts";
import { join } from "node:path";
import { ControlledT3 } from "../../apps/backend/test/support/controlled-t3.ts";
import type { ControlledT3Connection } from "../../apps/backend/test/support/controlled-t3-connection.ts";
import type { ControlledT3Contract } from "../../apps/backend/test/support/controlled-t3-contract.ts";
import { ControlledT3Projects } from "../../apps/backend/test/support/controlled-t3-projects.ts";
import { ControlledT3Threads } from "../../apps/backend/test/support/controlled-t3-threads.ts";
import type { LaunchPayload, SendPayload } from "../../apps/backend/src/t3/threads.ts";
import {
  T3Failure,
  type T3Endpoint,
  type T3ProjectTarget,
} from "../../apps/backend/src/t3/connection.ts";

type Snapshot = ReturnType<PersistentT3["snapshot"]>;
/** Version 5, or version 3 or 4, whose idle worker threads Factory no longer uses. State saved
 * before settled threads or held Stops were recorded has none. */
type SavedState = Omit<Snapshot, "version" | "settledThreads" | "unendedStops"> &
  Partial<Pick<Snapshot, "settledThreads" | "unendedStops">> & { version: number };

/** A local simulated engine. Its accepted keys outlive the Factory process. */
export class PersistentT3 extends ControlledT3 {
  private readonly statePath: string;
  private readonly persist: boolean;
  declare readonly threads: PersistentT3Threads;

  protected override makeProjects() {
    return new PersistentT3Projects(this.connection, this.contract, () => this.save());
  }

  protected override makeThreads(projectWorkspace: (projectId: string) => string | null) {
    return new PersistentT3Threads(this.connection, projectWorkspace, () => this.save());
  }

  constructor(home: string, restore: boolean, persist = true) {
    super();
    this.statePath = join(home, "demo-engine.json");
    this.persist = persist;
    this.connection.authorized = true;
    this.connection.authorize = async () => {
      this.connection.authorized = true;
      saveAccepted(() => this.save());
    };
    this.contract.serverVersion = "local-development-simulator";
    // A provider T3 offers but Factory cannot correlate reports from yet.
    this.projects.controlledProviders.push({
      providerInstanceId: "demo-cursor",
      displayName: "Cursor",
      driverKind: "cursor",
      models: [{ id: "composer-2", label: "Composer 2" }],
    });
    if (restore) this.restore();
  }

  private restore() {
    try {
      const saved = JSON.parse(readFileSync(this.statePath, "utf8")) as SavedState;
      if (saved.version < 3 || saved.version > 5)
        throw new Error("Unsupported demo engine state; run pnpm db:reset.");
      this.connection.identity = saved.identity;
      for (const [key, value] of saved.subagents) this.threads.subagents.set(key, value);
      for (const [key, value] of saved.delegatedSettlements)
        this.threads.delegatedSettlements.set(key, value);

      this.projects.catalog = saved.projects;
      this.projects.projectCreates = saved.projectCreates;
      for (const [key, value] of saved.launches) this.threads.launches.set(key, value);
      for (const [key, value] of saved.sends) this.threads.sends.set(key, value);
      for (const [key, value] of saved.executions)
        this.threads.executionObservations.set(key, value);
      for (const threadId of saved.settledThreads ?? []) this.threads.settledThreads.add(threadId);
      for (const threadId of saved.unendedStops ?? []) this.threads.unendedStops.add(threadId);
    } catch (cause) {
      throw new Error(
        "Demo engine state is missing, damaged or incompatible. Run pnpm db:reset to restore scenarios.",
        { cause },
      );
    }
  }

  private snapshot() {
    return {
      version: 5,
      identity: this.connection.identity,
      subagents: [...this.threads.subagents],
      delegatedSettlements: [...this.threads.delegatedSettlements],

      projects: this.projects.catalog,
      projectCreates: this.projects.projectCreates,
      launches: [...this.threads.launches],
      sends: [...this.threads.sends],
      executions: [...this.threads.executionObservations],
      settledThreads: [...this.threads.settledThreads],
      unendedStops: [...this.threads.unendedStops],
    };
  }

  save() {
    if (!this.persist) return;
    writeState(this.statePath, this.snapshot());
  }
}

class PersistentT3Projects extends ControlledT3Projects {
  private readonly save: () => void;

  constructor(
    connection: ControlledT3Connection,
    contract: ControlledT3Contract,
    save: () => void,
  ) {
    super(connection, contract);
    this.save = save;
  }

  override async createProject(target: T3ProjectTarget) {
    const project = await super.createProject(target);
    saveAccepted(this.save);
    return project;
  }
}

class PersistentT3Threads extends ControlledT3Threads {
  private readonly save: () => void;

  constructor(
    connection: ControlledT3Connection,
    projectWorkspace: (projectId: string) => string | null,
    save: () => void,
  ) {
    super(connection, projectWorkspace);
    this.save = save;
  }

  /** Simulated subagent threads each worker delegated to; Factory never reads them. */
  readonly subagents = new Map<string, string[]>();
  /** Threads whose Stop T3 acknowledges while their runs keep going, until a journey ends them. */
  readonly unendedStops = new Set<string>();

  protected override launchIds(_n: number) {
    const threadId = randomUUID();
    return { threadId, runId: `run:thread:${threadId}:ordinal:1` };
  }

  private delegatedWorkActive(threadId: string): boolean {
    return (this.subagents.get(threadId) ?? []).some(
      (child) =>
        !!this.executionObservations.get(child)?.activeRunId || this.delegatedWorkActive(child),
    );
  }

  /** The worker's own turn ends while a subagent it delegated to keeps running; T3 answers the
   * worker's delegated wait as pending until that subagent finishes. */
  delegate(parentThreadId: string, parentRunId: string) {
    const parent = this.executionObservations.get(parentThreadId)!;
    const threadId = randomUUID();
    const runId = `run:thread:${threadId}:ordinal:1`;
    this.executionObservations.set(threadId, {
      threadId,
      projectId: parent.projectId,
      workspaceRoot: parent.workspaceRoot,
      ...(parent.repository ? { repository: parent.repository } : {}),
      link: `t3://threads/${threadId}`,
      activeRunId: runId,
      latestRunId: runId,
      pendingRequestCount: 0,
      recentRuns: [{ runId, status: "running", ordinal: 1 }],
    });
    this.answerDelegatedWait(threadId, runId, "pending", "running");
    this.subagents.set(parentThreadId, [...(this.subagents.get(parentThreadId) ?? []), threadId]);
    this.endThreadRun(parentThreadId, parentRunId);
    this.save();
  }

  override async readDelegatedSettlement(target: T3Endpoint, threadId: string, runId: string) {
    const result = await super.readDelegatedSettlement(target, threadId, runId);
    return result.state === "settled" && this.delegatedWorkActive(threadId)
      ? { ...result, state: "pending" as const }
      : result;
  }

  async advance() {
    let changed = false;
    for (const { payload, reference } of this.sends.values())
      if (this.startQueuedSend(payload.threadId, reference.runId)) changed = true;
    if (changed) this.save();
  }

  override async stopThread(
    target: T3Endpoint,
    payload: { threadId: string; clientRequestId: string },
  ) {
    await super.stopThread(target, payload);
    if (!this.unendedStops.has(payload.threadId)) this.interrupt(payload.threadId);
    saveAccepted(this.save);
  }

  /** T3 acknowledges each later Stop of `threadIds` but keeps their runs going. */
  holdStops(threadIds: readonly string[]) {
    for (const threadId of threadIds) this.unendedStops.add(threadId);
    this.save();
  }

  /** T3 carries out the Stops it held for `threadIds`. */
  finishHeldStops(threadIds: readonly string[]) {
    for (const threadId of threadIds)
      if (this.unendedStops.delete(threadId)) this.interrupt(threadId);
    this.save();
  }

  /** Every unfinished run of the thread and of its subagents ends interrupted. */
  private interrupt(threadId: string) {
    const observation = this.executionObservations.get(threadId);
    for (const run of observation?.recentRuns ?? []) {
      if (!["completed", "failed", "interrupted", "cancelled", "rolled_back"].includes(run.status))
        this.endThreadRun(threadId, run.runId, "interrupted");
    }
    for (const child of this.subagents.get(threadId) ?? []) this.interrupt(child);
  }

  override async launchThread(target: T3Endpoint, payload: LaunchPayload) {
    const reference = await super.launchThread(target, payload);
    await this.recordLaunchedThread(reference.threadId);
    saveAccepted(this.save);
    return reference;
  }

  override async sendMessage(target: T3Endpoint, payload: SendPayload) {
    let reference = await super.sendMessage(target, payload);
    const observation = this.executionObservations.get(payload.threadId);
    if (observation && !observation.recentRuns.some((run) => run.runId === reference.runId)) {
      if (observation.activeRunId === null) {
        reference = { ...reference, status: "running", delivery: "started" };
        this.sends.get(payload.clientRequestId)!.reference = reference;
      }
      this.executionObservations.set(payload.threadId, {
        ...observation,
        activeRunId: reference.delivery === "started" ? reference.runId : observation.activeRunId,
        latestRunId: reference.runId,
        recentRuns: [
          ...observation.recentRuns,
          {
            runId: reference.runId,
            status: reference.status,
            ordinal: Math.max(0, ...observation.recentRuns.map((run) => run.ordinal ?? 0)) + 1,
          },
        ],
      });
    }
    saveAccepted(this.save);
    return reference;
  }

  override async settleThread(target: T3Endpoint, payload: { threadId: string }) {
    await super.settleThread(target, payload);
    saveAccepted(this.save);
  }
}

/** Saves after the simulated T3 accepts a call. A failed save leaves that call's outcome uncertain,
 * which callers handle as an unavailable T3, never as a raw file error. */
function saveAccepted(save: () => void) {
  try {
    save();
  } catch {
    throw new T3Failure("unavailable", "The demo T3 could not save its state.");
  }
}
