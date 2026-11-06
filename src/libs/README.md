# Shared libraries

`utils/` contains the project's reusable domain logic, algorithms, contracts, adapters, UI elements and motion components. It is a container for focused modules, not a miscellaneous dumping ground.

## Dependency rules

- Apps under `src/apps/` compose libraries through explicit public interfaces.
- Libraries never import applications, experiments, benchmarks, scripts or deployment code.
- Applications do not import each other; shared behavior moves into a library.
- Module dependencies remain acyclic. Centralize shared contracts rather than copying schemas.
- Keep browser-safe UI code separate from native/server capabilities and secrets.
- Inject provider, organization and model configuration; do not hard-code the demo incident or people.
- Experiments use the same core contracts while keeping hidden scenario truth out of policy/runtime inputs.

Each module needs a README describing its purpose, entry points, inputs/outputs, dependencies, configuration, actual checks and known limitations. A module does not need its own package or process unless that separation solves a concrete problem.

See the [module catalogue](utils/README.md) and [technical handoff](../../docs/OVERNIGHT_TECHNICAL_HANDOFF.md).
