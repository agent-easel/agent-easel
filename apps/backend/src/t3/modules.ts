import type { T3Adapter } from "../adapters/t3.ts";
import type { T3Authorization } from "./connection.ts";
import type { T3ContractReader } from "./contract.ts";

export interface T3Modules {
  readonly connection: T3Authorization;
  readonly contract: T3ContractReader;
  readonly adapter: T3Adapter;
  close(): Promise<void>;
}
