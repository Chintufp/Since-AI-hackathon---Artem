# Knowledge Twin

**Since AI Hackathon 2026 · Elisa challenge · Working design, 6 November 2026**

Turn existing conversations into reusable operational knowledge, ask experts only for consequential missing details, and deliver relevant knowledge and people when an engineer or agent needs them.

The pitch addresses four problems:

1. Useful knowledge is buried in ordinary conversations.
2. Knowledge loses meaning without its incident, equipment, people and outcome.
3. Similar problems can require different responses, and historical advice can be incomplete or wrong.
4. Knowledge must reach engineers and autonomous agents with minimal extra work.

**Status (7 November 2026, overnight run):** a runnable local prototype exists on branch `run/2026-11-07-overnight`: local service (SQLite, HTTP API, MCP), Electron companion (Snowbally + the v008 panel), synthetic scenario families, evaluator and bounded experiments. See [the run report](docs/runs/2026-11-07-overnight/REPORT.md) and [decisions](docs/runs/2026-11-07-overnight/DECISIONS.md). Nothing is deployed; the Slack connector is fixture-tested only.

## Run it locally

```bash
pnpm install
```

```bash
pnpm demo:reset
```

```bash
pnpm desktop
```

`pnpm desktop` builds the renderer, starts the local service on `127.0.0.1:47831` if it is not already running (SQLite at `data/local/knowledge-twin.sqlite`), and opens Snowbally bottom-right. He drops in once and then idles; click him to open the panel. Settings → **You** chooses whose questions you see. `pnpm service` runs the service alone; `pnpm mcp` runs the MCP stdio server (`{"command":"node","args":["src/apps/service/mcp.ts"]}` in a client config). `pnpm test`, `pnpm typecheck`, `node experiments/run.ts all`, `node scripts/screenshot.mjs`.

## Documentation

All planning and development Markdown lives under [`docs/`](docs/README.md).

- [Challenge and product brief](docs/BRIEF.md): four-problem pitch, people discovery, optional points and cinematic video direction.
- [Full vision and rationale](docs/VISION.md): the detailed product and architecture discussion previously in this README.
- [Workstreams and delegation](docs/WORKSTREAMS.md): ten problems, bounded agent tasks and dependencies.
- [Technical discussion guide](docs/TECHNICAL_DISCUSSIONS.md): questions and starter prompts for a new session.
- [Architecture](docs/ARCHITECTURE.md), [interactive master map](docs/master-map.html) and [engineering decisions](docs/ENGINEERING_DECISIONS.md).
- [Engineer experience and points brief](docs/EXPERIENCE_BRIEF.md): avatar interaction, rewarding contributions, optional sound/motion and an on/off switch.
- [Pitch-film brief](docs/PITCH_FILM_BRIEF.md): director/animation handoff for multiple screens, topology, people and learning.
- [Earlier research](docs/RESEARCH.md) and [initial concept](docs/INITIAL_CONCEPT.md): historical context with superseded assumptions marked.

## Current product direction

The Electron application targets a similar core workflow on macOS and Windows: a minimal avatar/input surface that expands into evidence and incident history. A shared service maintains source-backed claims, cases, patterns, responses and people; checks applicability; and serves authorized agents through MCP. The organization chooses its approved infrastructure and model-processing boundary.

Build the optional points experience with smooth visual rewards, expressive avatar reactions and optional sounds. It can be switched off for users or the pitch. Useful corrections and No answers deserve credit; user points remain separate from claim certainty and policy reward. Further design will be developed with Artem.

![Default white pixel avatar](docs/assets/avatar-default.svg)

No production mailboxes, background capture or operational equipment access is authorized by these documents. Keep secrets and restricted source material out of Git; private supplied examples remain in the ignored `private/` directory.
