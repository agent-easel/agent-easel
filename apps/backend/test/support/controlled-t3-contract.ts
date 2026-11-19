import { T3Failure, type T3Endpoint } from "../../src/t3/connection.ts";
import {
  NO_T3_SUPPORT,
  type T3ContractReader,
  type T3Inspection,
  type T3Support,
} from "../../src/t3/contract.ts";
import type { ControlledT3Connection } from "./controlled-t3-connection.ts";

export class ControlledT3Contract implements T3ContractReader {
  private readonly connection: ControlledT3Connection;

  constructor(connection: ControlledT3Connection) {
    this.connection = connection;
  }

  serverVersion = "a-different-version-is-allowed";
  compatible = true;
  runtimeContractComplete = true;
  /** The support answers each inspection reports while T3 is ready. A worktree launch also needs
   * `launch`; a null `attachmentLimit` advertises no uploaded attachments. A failing proof leaves
   * its supported answer unchecked, as the live adapter does when a replay proof cannot be
   * established. */
  support = {
    launch: true,
    worktreeLaunch: true,
    launchRetryScope: "controlled-durable-server-1" as string | null,
    launchProofFails: false,
    attachmentLimit: 8 as number | null,
    send: true,
    sendRetryScope: "controlled-durable-send-1" as string | null,
    sendProofFails: false,
    settle: true,
    stop: true,
    reportReads: true,
  };
  /** Runs at the start of every inspection T3 answers, such as a connection check's. */
  beforeInspection?: () => void | Promise<void>;
  async inspect(_target: T3Endpoint): Promise<T3Inspection> {
    await this.beforeInspection?.();
    if (!this.connection.available)
      throw new T3Failure("unavailable", "External failure containing secret material");
    if (!this.connection.authorized)
      return {
        state: "authorization-required",
        reason: this.connection.pendingApproval ? "approval-pending" : "approval-required",
        support: NO_T3_SUPPORT,
      };
    return {
      state: this.compatible ? "ready" : "incompatible",
      support: this.compatible ? this.supportAnswers() : NO_T3_SUPPORT,
      reason: this.compatible ? "connected" : "contract-missing",
      authorizationIdentity: this.connection.identity,
      contract: {
        serverName: "Controlled T3",
        serverVersion: this.serverVersion,
        environmentId: this.connection.environmentId,
        tools: [
          { name: "t3_environment_read", inputSchema: { type: "object" } },
          ...Object.entries({
            t3_thread_launch: [
              "projectId",
              "clientRequestId",
              "modelSelection",
              "workspaceStrategy",
            ],
            t3_thread_send: this.runtimeContractComplete
              ? ["threadId", "clientRequestId", "mode"]
              : ["threadId", "clientRequestId"],
            t3_thread_read: ["threadId", "view", "afterPosition"],
            t3_queue: ["action", "queuedRunId"],
            t3_thread_interrupt: ["threadId", "stop", "clientRequestId"],
          }).map(([name, fields]) => ({
            name,
            inputSchema: {
              type: "object",
              properties: Object.fromEntries(
                fields.map((f) => [
                  f,
                  {
                    type:
                      f === "afterPosition"
                        ? "integer"
                        : f === "stop"
                          ? "boolean"
                          : f === "modelSelection" || f === "workspaceStrategy"
                            ? "object"
                            : "string",
                  },
                ]),
              ),
            },
          })),
        ],
        problems: this.compatible ? [] : ["t3_environment_read is missing"],
        executionVerified: false,
      },
    };
  }
  private supportAnswers(): T3Support {
    const { support } = this;
    const launch =
      support.launchProofFails && support.launch
        ? { supported: false, retryScope: null, explanation: null }
        : {
            supported: support.launch,
            retryScope: support.launchRetryScope,
            explanation: support.launch
              ? "Controlled durable replay lifetime"
              : "T3 launch contract is unsupported. Recheck the T3 connection.",
          };
    return {
      launch: {
        checkout: launch,
        worktree:
          support.launch && !support.worktreeLaunch
            ? {
                ...launch,
                supported: false,
                explanation: "T3 launch schema cannot express worktree launches.",
              }
            : launch,
      },
      attachmentLimit: support.attachmentLimit,
      send:
        support.sendProofFails && support.send
          ? { supported: false, retryScope: null, explanation: null }
          : {
              supported: support.send,
              retryScope: support.sendRetryScope,
              explanation: "Controlled queue replay lifetime",
            },
      settle: { supported: support.settle, explanation: "Controlled settlement support" },
      stop: { supported: support.stop, explanation: "Controlled Stop support" },
      reportReads: support.reportReads,
    };
  }

  /**
   * Holds every inspection after the first `passing` at T3 until `release`; `inspecting` resolves
   * once one is held there. A held inspection holds every other connection check behind it.
   */
  holdInspection(passing = 0) {
    let release = () => {};
    let entered = () => {};
    let inspections = 0;
    const held = new Promise<void>((resolve) => (release = resolve));
    const inspecting = new Promise<void>((resolve) => (entered = resolve));
    this.beforeInspection = async () => {
      inspections += 1;
      if (inspections <= passing) return;
      entered();
      await held;
    };
    return { inspecting, release };
  }
}
