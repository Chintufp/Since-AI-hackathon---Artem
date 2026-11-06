# Reusable modules

Place reusable components and algorithms in focused subdirectories here. The following is a proposed catalogue; the modules are not implemented by this scaffold.

| Module | Responsibility |
| --- | --- |
| `contracts/` | Evidence, memory, question, feedback, outcome and service schemas. |
| `connectors/` | Slack/source adapters, capabilities and connection lifecycle. |
| `ingest/` | Normalization, idempotence, deduplication and provenance. |
| `context/` | Thread/conversation context assembly and source relationships. |
| `memory/` | Cases, claims, people, typed links, validity and revisions. |
| `retrieval/` | Exact, lexical, optional vector and hybrid candidate retrieval. |
| `investigation/` | Hypotheses, distinguishing checks and recommendation gates. |
| `questions/` | Candidate contracts, recipient eligibility, budgets and coordination. |
| `policies/` | Rule and learned-selector interfaces and implementations. |
| `models/` | Explicit provider, local-model and fixture/replay interfaces. |
| `ui/` | Reusable interface components and view models adapted from the preferred design. |
| `motion/` | Pixel rendering, reusable animation sources and state transitions. |

Create directories when implementing their responsibilities. Keep public interfaces small, version contracts where needed and record meaningful tests. A policy's training reward, a factual answer, a preference label and user points must remain separate types.

Adapt the selected ChatGPT design into reusable implementation code; preserve the original studies under `design-lab/`. See the [build prompt](../../../docs/CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md) for current versions and integration acceptance checks.
