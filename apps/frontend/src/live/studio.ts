import {
  applyStudioChange,
  type StudioDefinitions,
  type StudioLiveMessage,
} from "@agent-easel/contracts";
import { useLiveScope } from "./live-connection.ts";
import type { LiveScope } from "./owner.ts";

/** Studio's saved Agents and Flows, one joint snapshot followed by committed changes. */
export const studioScope: LiveScope<StudioLiveMessage, StudioDefinitions> = {
  key: "studio",
  part: { kind: "studio" },
  snapshot: (message) => message.studio,
  apply: applyStudioChange,
};

/**
 * Reads Studio's definitions outside Studio, for reporting state and the palette. Readers keep
 * the scope current without gating mutations; only an open Studio gates them.
 */
export const useLiveStudio = () => useLiveScope(studioScope, { gates: false });
