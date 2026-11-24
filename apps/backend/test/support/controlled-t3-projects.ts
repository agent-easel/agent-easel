import type { AgentEnvironment } from "@agent-easel/contracts";
import {
  T3Failure,
  type T3Endpoint,
  type T3EnvironmentTarget,
  type T3ProjectTarget,
} from "../../src/t3/connection.ts";
import type { T3Project, T3Projects, T3ProviderCapability } from "../../src/t3/projects.ts";
import type { ControlledT3Connection } from "./controlled-t3-connection.ts";
import type { ControlledT3Contract } from "./controlled-t3-contract.ts";

export class ControlledT3Projects implements T3Projects {
  private readonly connection: ControlledT3Connection;
  private readonly contract: ControlledT3Contract;

  constructor(connection: ControlledT3Connection, contract: ControlledT3Contract) {
    this.connection = connection;
    this.contract = contract;
  }

  workspaceFor(projectId: string): string | null {
    return this.catalog.find((project) => project.projectId === projectId)?.workspaceRoot ?? null;
  }

  catalog: T3Project[] = [];
  projectCreates = 0;
  async listProjects(_target: T3EnvironmentTarget) {
    this.connection.requireConnection();
    if (!this.contract.compatible) throw new T3Failure("refused", "Unavailable");
    return this.catalog;
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
    this.catalog.push(project);
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
}

/** While T3 answers the next Agent capability read, T3 changes its report support and a
 * separate connection check publishes that answer. */
export function changeReportSupportAtCapabilityRead(
  { projects, contract }: { projects: ControlledT3Projects; contract: ControlledT3Contract },
  recheckConnection: () => Promise<unknown>,
  reportReads: boolean,
) {
  projects.beforeCapabilityRead = async () => {
    delete projects.beforeCapabilityRead;
    contract.support.reportReads = reportReads;
    await recheckConnection();
  };
}
