import { StatusBadge } from "./status-badge.tsx";

/** The tag for an Agent without a model T3 offers; it asks for a choice in the Agent editor. */
export function NeedsModel() {
  return <StatusBadge kind="attention">Needs a model</StatusBadge>;
}
