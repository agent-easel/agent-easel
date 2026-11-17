# Project overrides of a global Agent's execution settings

A global Agent may carry, per Project, a replacement for its execution settings (environment,
provider, model and thinking options). Runs in that Project use the override; every other Project
uses the Agent's own settings. Name, prompt and exits stay shared, and Flows still never carry
per-project overrides ([ADR 0001](0001-project-ownership-instead-of-per-project-flow-overlays.md)).

Overrides are part of the Agent revision, not a layer beside it. A save appends a revision that
holds the whole list, and a Run captures that revision as before. Its Project is fixed at Start, so
"which settings did this Run use" still has one answer from two immutable inputs: the captured
revision and the Run's Project. This avoids the moving-base problem ADR 0001 rejected for overlays.

We chose this because a model is often the only difference between Projects, and copying an Agent
into each Project to change it splits one prompt into copies that drift apart.

## Considered Options

- **Project Agent copies** (ADR 0001's answer): kept for a different prompt or exits. For a model
  alone it duplicates the prompt and lets the copies drift.
- **Overrides stored beside revisions**: rejected. A Run would have to capture them separately,
  and changing one would not leave a revision behind.
- **Overrides of prompt or exits**: rejected. Flow readiness and wires depend on an Agent's exits,
  and a different prompt is a different Agent.

## Consequences

- Only a global Agent with its own execution settings has overrides, at most one per Project.
  Moving it to a Project is refused while it has any, and copying it into a Project gives the copy
  that Project's settings and no overrides.
- An override whose Project later becomes unavailable stays saved; a newly added one must name a
  Project available for new Runs.
- Export and Import carry no overrides, because they name this server's Projects.
