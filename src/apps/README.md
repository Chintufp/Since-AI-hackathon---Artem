# Application entry points

Applications are thin compositions of reusable modules in `src/libs/utils/`.

- `desktop/`: planned Electron main/preload/renderer entry points, native capability wiring and desktop composition.
- `service/`: planned API/MCP entry points, synchronization jobs, configuration and process startup.

These application directories will be created during implementation. This scaffold does not contain a running desktop app or backend.

Keep shared investigation, memory, question and UI logic in the libraries. Apps may own lifecycle, transport and platform-specific wiring. The desktop communicates with the service through the agreed contract; apps should not import each other's implementation.

Use one coordinated owner for root tooling, dependency versions and shared contracts. Follow the [source layout](../README.md) and [orchestrator prompt](../../docs/CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md).
