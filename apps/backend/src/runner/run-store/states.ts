import type { RunBlock } from "@t3-factory/contracts";

/** How a Block's state is stored: the six-value state of the shared contracts. */
export type BlockState = RunBlock["state"];

/** A delivery launches a new worker on a Block's first visit, or sends a turn to its bound worker. */
export type DeliveryKind = "launch" | "send";

/** How a delivery's state is stored. */
export type DeliveryState = "pending" | "reserved" | "acknowledged" | "uncertain" | "cancelled";
