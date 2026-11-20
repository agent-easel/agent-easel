/** Package entry: the public backend surface. Each export lives in the module that owns it. */
export type { FactoryOptions } from "./factory-options.ts";
export { FactoryService } from "./factory-service.ts";
export { factoryLayer } from "./factory-layer.ts";
export { openFactory, type Factory } from "./open-factory.ts";
export type { LiveStreams } from "./live-streams.ts";
export type { T3Inspection } from "./t3/contract.ts";
export type { T3Endpoint, T3Target } from "./t3/connection.ts";
export { makeLiveT3 } from "./t3/live-modules.ts";
export type { T3Modules } from "./t3/modules.ts";
export type { RuntimeReport, RuntimeReply } from "./runtime-types.ts";
