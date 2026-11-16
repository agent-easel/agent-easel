import type { GitHubAdapter } from "./adapters/github.ts";
import type { T3Adapter } from "./adapters/t3.ts";

/** Everything a caller may choose when opening a Factory; defaults live where each is consumed. */
export interface FactoryOptions {
  readonly runtimeBackendUrl?: string;
  readonly reportingStateDirectory?: string;
  readonly databasePath: string;
  readonly credentialsDirectory?: string;
  readonly t3?: T3Adapter;
  readonly github?: GitHubAdapter;
  readonly connectionRetryMs?: number;
  /** The release this installation runs; source runs omit it. */
  readonly applicationVersion?: string;
  /** Discord's REST API base for Chat control's Gateway connection; tests use a controlled Discord. */
  readonly discordApiUrl?: string;
}
