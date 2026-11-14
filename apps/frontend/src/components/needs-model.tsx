/**
 * The label for an Agent saved without execution settings. It asks for a choice in the Agent
 * editor and is distinct from the Unavailable and Unknown availability of a saved selection.
 */
export function NeedsModel() {
  return <span className="font-medium text-attention">Needs a model</span>;
}
