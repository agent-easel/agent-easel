import { LiveT3Connection, type LiveT3ConnectionOptions } from "./live-connection.ts";
import { LiveT3Contract, type LiveT3ContractOptions } from "./live-contract.ts";
import { LiveT3Projects } from "./live-projects.ts";
import { LiveT3Threads } from "./live-threads.ts";
import type { T3Modules } from "./modules.ts";

export function makeLiveT3(options: LiveT3ConnectionOptions & LiveT3ContractOptions): T3Modules {
  const connection = new LiveT3Connection(options);
  return {
    connection,
    contract: new LiveT3Contract(connection, options),
    threads: new LiveT3Threads(connection),
    projects: new LiveT3Projects(connection),
    close: () => connection.close(),
  };
}
