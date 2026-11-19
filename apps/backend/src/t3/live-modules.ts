import { LiveT3Adapter } from "../adapters/live-t3.ts";
import { LiveT3Appearance } from "./live-appearance.ts";
import { LiveT3Connection, type LiveT3ConnectionOptions } from "./live-connection.ts";
import { LiveT3Contract, type LiveT3ContractOptions } from "./live-contract.ts";
import type { T3Modules } from "./modules.ts";

export function makeLiveT3(options: LiveT3ConnectionOptions & LiveT3ContractOptions): T3Modules {
  const connection = new LiveT3Connection(options);
  return {
    connection,
    contract: new LiveT3Contract(connection, options),
    appearance: new LiveT3Appearance(connection),
    adapter: new LiveT3Adapter(connection),
    close: () => connection.close(),
  };
}
