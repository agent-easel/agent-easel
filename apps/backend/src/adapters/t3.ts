import type { AgentEnvironment, AgentProviderCapability, ProjectIcon } from "@t3-factory/contracts";
import type { T3Endpoint, T3EnvironmentTarget, T3ProjectTarget } from "../t3/connection.ts";

/** A provider as T3's catalog publishes it; Factory adds its own reporting support. */
export type T3ProviderCapability = Omit<AgentProviderCapability, "reporting">;

/** Every call that rejects does so only with a `T3Failure`. */
export interface T3Adapter {
  listProjects(target: T3EnvironmentTarget): Promise<readonly T3Project[]>;
  createProject(target: T3ProjectTarget): Promise<T3Project>;
  readEnvironment(target: T3Endpoint): Promise<AgentEnvironment>;
  orchestratorCapabilities(target: T3Endpoint): Promise<readonly T3ProviderCapability[]>;
}

export interface T3Project {
  readonly projectId: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly available: boolean;
  readonly projectIcon?: ProjectIcon | null;
  readonly faviconPath?: string | null;
}
