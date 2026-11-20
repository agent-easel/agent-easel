import type { T3AppearanceReader } from "./appearance.ts";
import type { T3Authorization } from "./connection.ts";
import type { T3ContractReader } from "./contract.ts";
import type { T3Projects } from "./projects.ts";
import type { T3Threads } from "./threads.ts";

export interface T3Modules {
  readonly connection: T3Authorization;
  readonly contract: T3ContractReader;
  readonly appearance: T3AppearanceReader;
  readonly threads: T3Threads;
  readonly projects: T3Projects;
  close(): Promise<void>;
}
