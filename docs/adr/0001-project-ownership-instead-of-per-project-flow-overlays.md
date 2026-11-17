# Project ownership instead of per-project Flow overlays

A Flow or Agent is either global or owned by exactly one Project. A different configuration for
another Project is an independent copy owned by that Project. A shared Flow never carries
per-project overrides. We chose this over overlays because one ownership value on the definition
identity keeps a Flow's revisions, readiness and captured Run definitions what they are today.
One placement rule (any Flow may place a global Agent, and a Project Flow may also place its own
Project's Agents) then decides authoring, readiness and Start. Overlays would make every Flow read,
readiness check and Run capture resolve a base revision plus per-Project deltas. Every save would
also have to decide whether it edits the base or one overlay. Overlays would also need rules for an
overlay whose base later changes underneath it.

## Considered Options

- **Overlay inheritance**: one shared Flow with per-project overrides of Agents, prompts or
  settings. Rejected: it adds a second resolution layer to definitions, readiness and Runs, and
  makes "which configuration did this Run use" depend on two moving sources.
- **Definitions shared with a chosen set of Projects**: rejected as a permission model Factory does
  not have. Ownership limits where a definition is used, not who may edit it.
- **Ownership by repository path, name or remote**: rejected because Factory already identifies a
  Project by its own durable identity. Two clones are distinct Projects, and a rename or move must
  not change ownership.

## Consequences

- Variants diverge freely after a copy, and nothing synchronizes them.
- Ownership is stored on the Flow and Agent identity, not in revisions. A later owner change or
  Project unavailability never rewrites a Run's captured revisions. Readiness, however, depends on
  each placed Agent's owner as well as its revision.
- Existing definitions became global on upgrade. Reverting to a single global catalog would
  discard every Project's separation, and adding overlays later would require a new resolution
  model rather than a field.
