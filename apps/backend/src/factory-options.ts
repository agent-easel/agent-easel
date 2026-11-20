import type * as Clock from "effect/Clock";
import type { GitAdapter } from "./adapters/git.ts";
import type { GitHubAdapter } from "./adapters/github.ts";
import type { T3Modules } from "./t3/modules.ts";

/** Everything a caller may choose when opening a Factory; defaults live where each is consumed. */
export interface FactoryOptions {
  readonly runtimeBackendUrl?: string;
  readonly reportingStateDirectory?: string;
  readonly databasePath: string;
  readonly credentialsDirectory?: string;
  readonly t3?: T3Modules;
  readonly clock?: Clock.Clock;
  readonly github?: GitHubAdapter;
  readonly git?: GitAdapter;
  readonly connectionRetryMs?: number;
  /** The release this installation runs; source runs omit it. */
  readonly applicationVersion?: string;
  /** Discord's REST API base for Chat control's Gateway connection; tests use a controlled Discord. */
  readonly discordApiUrl?: string;
}
