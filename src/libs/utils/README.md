# Reusable modules

Reusable components and algorithms live in focused subdirectories here. All modules below are implemented (overnight run of 7 November 2026, branch `run/2026-11-07-overnight`); each has its own README with interface, configuration, checks and limitations.

| Module | Responsibility |
| --- | --- |
| `contracts/` | Evidence, memory, question, feedback, outcome, view and service schemas; condition vocabulary; scenario contract. |
| `connectors/` | Slack/source adapters, capabilities and connection lifecycle. |
| `ingest/` | Normalization, idempotence, deduplication and provenance. |
| `context/` | Thread/conversation context assembly and source relationships. |
| `memory/` | Cases, claims, people, typed links, validity and revisions. |
| `retrieval/` | Exact, lexical, optional vector and hybrid candidate retrieval. |
| `investigation/` | Hypotheses, distinguishing checks and recommendation gates. |
| `questions/` | Candidate contracts, recipient eligibility, budgets and coordination. |
| `policies/` | Rule and learned-selector interfaces and implementations. |
| `models/` | Explicit provider, local-model and fixture/replay interfaces. |
| `ui/` | The v008 panel (input, question, queue, settings, receipt, result, people, case, contact draft), panel springs, typed API client, dev mock. |
| `motion/` | Byte-identical TypeScript port of the pixel-motion v006 kit and acts; AvatarController (entrance, three-pose idle, reactions, reduced motion). |
| `participation/` | Optional points: separate record, deduplicated, never read by evidence or selection. |

Keep public interfaces small, version contracts where needed and record meaningful tests. A policy's training reward, a factual answer, a preference label and user points must remain separate types.

Adapt the selected ChatGPT design into reusable implementation code; preserve the original studies under `design-lab/`. See the [build prompt](../../../docs/CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md) for current versions and integration acceptance checks.
