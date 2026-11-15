import {
  applyStudioChange,
  type StudioDefinitions,
  type StudioLiveMessage,
} from "@t3-factory/contracts";
import { useLiveScope } from "./live-connection.ts";
import type { LiveScope } from "./owner.ts";

/** Studio's saved Agents and Flows, one joint snapshot followed by committed changes. */
export const studioScope: LiveScope<StudioLiveMessage, StudioDefinitions> = {
  key: "studio",
  part: { kind: "studio" },
  snapshot: (message) => message.studio,
  apply: applyStudioChange,
};

/** The window holds the Studio scope for its lifetime: reporting state and the palette read it. */
export const useLiveStudio = () => useLiveScope(studioScope);
