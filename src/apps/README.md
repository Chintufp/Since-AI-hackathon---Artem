# Application entry points

Applications are thin compositions of reusable modules in `src/libs/utils/`.

- `desktop/`: Electron main/preload/renderer, tray, click-through window, service child process, screenshot harness (see its README).
- `service/`: HTTP API (25 routes) and MCP stdio server (8 tools) over one engine, demo reset, organization configuration (see its README).

Launch: `pnpm demo:reset` then `pnpm desktop` (see the root README).

Keep shared investigation, memory, question and UI logic in the libraries. Apps may own lifecycle, transport and platform-specific wiring. The desktop communicates with the service through the agreed contract; apps should not import each other's implementation.

Use one coordinated owner for root tooling, dependency versions and shared contracts. Follow the [source layout](../README.md) and [orchestrator prompt](../../docs/CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md).
