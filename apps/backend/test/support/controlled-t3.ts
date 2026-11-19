import type { AgentEnvironment } from "@t3-factory/contracts";
import { T3Failure } from "../../src/t3/connection.ts";
import { ControlledT3Connection } from "./controlled-t3-connection.ts";
import { ControlledT3Threads } from "./controlled-t3-threads.ts";
import { ControlledT3Contract } from "./controlled-t3-contract.ts";
import type { T3Modules } from "../../src/t3/modules.ts";
import { ControlledAppearance } from "./controlled-appearance.ts";
import type { T3Adapter, T3Project, T3ProviderCapability } from "../../src/adapters/t3.ts";
import type { T3Endpoint, T3EnvironmentTarget, T3ProjectTarget } from "../../src/t3/connection.ts";

/** Independent external-engine lifetime; no SQL or Factory internals. */
export class ControlledT3 implements T3Modules, T3Adapter {
  readonly connection = new ControlledT3Connection();
  readonly contract = new ControlledT3Contract(this.connection);

  readonly threads: ControlledT3Threads = this.makeThreads(
    (projectId) =>
      this.projects.find((project) => project.projectId === projectId)?.workspaceRoot ?? null,
  );

  protected makeThreads(projectWorkspace: (projectId: string) => string | null) {
    return new ControlledT3Threads(this.connection, projectWorkspace);
  }

  get adapter(): T3Adapter {
    return this;
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
  readonly appearance = new ControlledAppearance(this.connection);
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
