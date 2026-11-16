# Domain documentation

Before exploring a feature or changing its design, read [the documentation index](../README.md), the root [glossary](../../GLOSSARY.md) and the topic documents for that area. This repository has one domain context: definitions live in `GLOSSARY.md`, and implemented behavior, durable decisions and support limits live together in the indexed topics under `docs/`. A decision that is hard to reverse, surprising without context and the result of a real trade-off also gets a short record in `docs/adr/` (`NNNN-slug.md`), linked from the index; the topics still state the resulting behavior.

Use the glossary's terms in issues, hypotheses, refactors and test names. If a needed concept is missing, first check whether an existing term covers it; record a real vocabulary gap when changing the domain model.

Surface a proposal that contradicts a documented decision explicitly, with its reason, rather than silently overriding it. Update the affected topic when the decision changes; maintain one current description instead of parallel specifications.
