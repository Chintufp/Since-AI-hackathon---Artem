# Source layout

**User-selected structure · 7 November 2026**

Application source belongs under `src/`. All reusable algorithms, domain logic and UI components belong in named modules under `src/libs/utils/`. Apps compose those modules.

```text
src/
  apps/                 Desktop/service entry points and composition
  libs/
    README.md           Shared-library boundaries
    utils/
      README.md         Reusable module catalogue and conventions
```

Implemented in the overnight run of 7 November 2026; see each module README and `docs/runs/2026-11-07-overnight/REPORT.md`. Earlier plans showing `apps/` and `libs/` at the repository root retain their logical boundaries but now live under `src/`.

- [Application entry points](apps/README.md)
- [Library boundaries](libs/README.md)
- [Reusable modules](libs/utils/README.md)
- [Build orchestration prompt](../docs/CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md)
- [Technical handoff](../docs/OVERNIGHT_TECHNICAL_HANDOFF.md)

Root-level `experiments/`, `benchmarks/`, `tests/` and `scripts/` may hold runners and checks. They consume the reusable modules; they do not define a competing implementation of the operational pipeline. Keep hidden evaluation data outside runtime imports.

The language, package tooling and detailed module list remain implementation choices. Prefer a small coherent structure over empty packages or a separate service for every diagram node.
