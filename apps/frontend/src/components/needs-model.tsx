import { StatusBadge } from "./status-badge.tsx";

/**
 * The tag for an Agent saved without execution settings. It asks for a choice in the Agent
 * editor and is distinct from the Unavailable and Unknown availability of a saved selection.
 */
export function NeedsModel() {
  return <StatusBadge kind="attention">Needs a model</StatusBadge>;
}
