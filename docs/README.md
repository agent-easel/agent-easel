# T3 Factory documentation

Use the [glossary](../GLOSSARY.md) for domain terms. Each topic describes user behavior, durable contracts and current limits. Controlled tests do not establish live provider compatibility; [issues](https://github.com/alimek/t3-factory/issues) track proposed work.

New here? Start with the [project overview and demo](../README.md),
[contribution guide](../CONTRIBUTING.md), [support](../SUPPORT.md) and
[security policy](../SECURITY.md).

## Using Factory

- [Installation, support limits and bounded live verification](installation.md)
- [T3 connection, authorization and Agent reporting](t3-integration.md)
- [Projects and existing repositories](projects.md)
- [Studio: Agent definitions, Flow authoring and validation](studio.md)
- [Starting and observing Runs](runs.md)
- [Desktop and approved clients](desktop-and-clients.md)
- [Chat control](chat-control.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)

## Contracts and contribution

- [Application foundation and persistence](foundation.md)
- [Durable Runner and execution decisions](runner.md)
- [Development scenarios](dev-scenarios.md)
- [Frontend design system](design-system.md)
- [Testing policy and UI verification](testing.md)
- [Quality gates](quality-gates.md)
- [Release](release.md)
- [Issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md) and [domain documentation](agents/domain.md)
- Architecture decision records: [Project ownership instead of per-project Flow overlays](adr/0001-project-ownership-instead-of-per-project-flow-overlays.md), [Project overrides of a global Agent's execution settings](adr/0002-project-overrides-of-global-agent-execution-settings.md), [Shared Flow canvas geometry and Auto-arrange](adr/0003-share-flow-canvas-geometry-with-auto-layout.md), [The first reached ending ends the Run; Subflow results are the invoked Flow's endings](adr/0004-first-reached-ending-ends-the-run.md), [The shared canvas draws only what reaches the view](adr/0005-draw-only-what-reaches-the-canvas-view.md), [Join synchronizes all sources by FIFO rounds](adr/0006-join-synchronizes-all-sources-by-fifo-rounds.md)

Read the relevant topic before changing behavior and update it in the same change. [AGENTS.md](../AGENTS.md) records documentation maintenance and contribution instructions.
