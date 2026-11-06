# Run plan — 2026-11-07-overnight

Orchestrator: Claude Fable 5.1 (Claude Code, Ultracode). Workers: Sonnet; review: Opus.

## Checkpoints

1. **Inputs and plan** — branch, preservation commit, manifest, decisions log, root tooling, shared contracts. (orchestrator)
2. **Working baseline** — import → memory → investigate → qualified context → question/defer → attributed update, through the shared service. (workers W1 ingest/memory, W2 investigation/questions/policies/models; W4 service)
3. **Integrated experience** — v008 panel + v006 Snowbally in Electron, connected to the service with persistent state. (W3 ui/motion/desktop + orchestrator polish)
4. **Controlled experiments** — E00 evaluator and scenario families (W5), then E01–E07 bounded comparisons; local model training for E03 bandit, E01 linker, E04 assessor. (W5 + experiment worker)
5. **Final integration** — regression checks, launch from a fresh process, screenshots at 736/320, reduced motion, reports.

## Ownership (exclusive paths)

| Worker | Owns |
| --- | --- |
| Orchestrator | package.json, tsconfig, scripts/, src/libs/utils/contracts/, integration, docs/runs/ |
| W1 ingest/memory | src/libs/utils/connectors, ingest, context, memory |
| W2 investigation | src/libs/utils/retrieval, investigation, questions, policies, models |
| W3 ui/desktop | src/libs/utils/ui, motion, src/apps/desktop |
| W4 service | src/apps/service, tests/ e2e |
| W5 evaluation | data/scenarios, benchmarks/, experiments/ |

Workers do not edit contracts; they request changes from the orchestrator.
