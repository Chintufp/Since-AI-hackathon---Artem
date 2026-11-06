# Knowledge Twin documentation

Planning and development documents live here. The [repository README](../README.md) is the short entry point.

## Start with the task

| What you want to do | Read |
| --- | --- |
| Launch the combined Claude build and experiments | [CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md](CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md) |
| Understand the challenge and current pitch | [BRIEF.md](BRIEF.md) |
| Understand the full product vision and rationale | [VISION.md](VISION.md) |
| Pick a bounded implementation task | [WORKSTREAMS.md](WORKSTREAMS.md) |
| Start a technical discussion in a new session | [TECHNICAL_DISCUSSIONS.md](TECHNICAL_DISCUSSIONS.md) |
| Inspect architecture, schemas and feedback loops | [ARCHITECTURE.md](ARCHITECTURE.md) and [interactive map](master-map.html) |
| Choose algorithms, metrics and thresholds | [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md) |
| Design the engineer experience, avatar and optional points | [EXPERIENCE_BRIEF.md](EXPERIENCE_BRIEF.md) |
| Direct the cinematic pitch video | [PITCH_FILM_BRIEF.md](PITCH_FILM_BRIEF.md) |
| Review historical research | [RESEARCH.md](RESEARCH.md) and [INITIAL_CONCEPT.md](INITIAL_CONCEPT.md) |

## Current decisions to preserve

- The pitch explains four problems: buried knowledge; lost context and people; uncertain applicability; and low-effort delivery to engineers and agents.
- Finding people with related incident experience is a product feature, alongside retrieving useful knowledge.
- The points experience is in planned build scope, with on/off, optional sound, motion preferences and a quiet demo preset.
- Artem wants a cinematic film with multiple screens, coherent knowledge topology, people and learning. It has its own director/animation handoff.
- The Electron app targets a similar core experience on macOS and Windows; builds and parity remain unvalidated.
- The static avatar is a white pixel circle. Further motion and visual decisions will be developed with Artem.
- Documentation describes a design; connectors, trained policies, the MCP service, points effects and the desktop product are not established implementations.

## Working across sessions and agents

**Source layout selected 7 November:** source lives under `src/`, with reusable modules in `src/libs/utils/` and library documentation in `src/libs/README.md`. Thin applications live in `src/apps/`. This updates the paths in older root-level `apps/` / `libs/` examples. See the [source scaffold](../src/README.md).

Read the relevant brief and its linked technical decisions before editing. Preserve distinctions between a user decision, an assistant proposal and measured behavior. Give each implementation agent a bounded task, input/output contract, owned files and completion checks. Keep shared semantic decisions coordinated.

Use the starter prompts in the technical guide for discussion sessions. For design, also read the experience brief; for the film, read the film brief before choosing tools or generating assets. No production or implementation agent is launched by these documents themselves.

Original private challenge materials remain outside tracked documentation in the ignored `private/Elisa_SinceAI2026/` directory. A fresh clone may not contain them. Historical research and initial proposals can contain superseded assumptions; the current brief and explicit latest decisions take precedence.
