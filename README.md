# Knowledge Twin

**Since AI Hackathon 2026 · Elisa challenge · Working design, 6 November 2026**

Turn existing conversations into reusable operational knowledge, ask experts only for consequential missing details, and deliver relevant knowledge and people when an engineer or agent needs them.

The pitch addresses four problems:

1. Useful knowledge is buried in ordinary conversations.
2. Knowledge loses meaning without its incident, equipment, people and outcome.
3. Similar problems can require different responses, and historical advice can be incomplete or wrong.
4. Knowledge must reach engineers and autonomous agents with minimal extra work.

**Status (7 November 2026, overnight run):** a runnable local prototype exists on branch `run/2026-11-07-overnight`: local service (SQLite, HTTP API, MCP), Electron companion (Snowbally + the v008 panel), synthetic scenario families, evaluator and bounded experiments. See [the run report](docs/runs/2026-11-07-overnight/REPORT.md) and [decisions](docs/runs/2026-11-07-overnight/DECISIONS.md). Nothing is deployed; the Slack connector is fixture-tested only.

## Quick start for judges (3 minutes)

```bash
pnpm install
```

```bash
pnpm demo:judge
```

One command: resets the demo data, starts the local service (`127.0.0.1:47831`), starts a **simulated** activity stream, opens it in a browser tab and launches the pixel companion (Snowbally, bottom-right). Then follow [docs/DEMO.md](docs/DEMO.md): click Snowbally, be Veikko (Settings → You), paste the TRN-088 text and see Erkki's rule reused with its caveats and sources; paste the TRN-301 text and watch the one Yes/No question reach Erkki; be Erkki, answer it, be Veikko again and see the recommendation change; run `pnpm demo:agent` for the same answer over MCP. Ctrl-C stops everything.

- Everything runs on this machine: no cloud, no model API, no real chat, mail or Slack. The stream is synthetic and labelled so.
- Elisa's example files are read from the git-ignored `private/` folder when present; otherwise the synthetic TRN-117 case plays the same part.
- Trouble? `pnpm demo:reset` restores the data; `pnpm service` starts the service alone; the troubleshooting box in DEMO.md has the rest.

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

The Elisa TRN-042 example is read from the git-ignored `private/Elisa_SinceAI2026/...` folder when present; a fresh clone without it gets only the synthetic demo families and the dev fixture. `pnpm desktop` builds the renderer, starts the local service on `127.0.0.1:47831` if it is not already running (SQLite at `data/local/knowledge-twin.sqlite`), and opens Snowbally bottom-right. He falls in from the top of the screen, lands with a plop, says hello and, after a few seconds, rolls off to the edge of the screen: that is his home. A sliver of him stays at the edge; move the cursor near it and he peeks and hops back in, click him for the panel (Springy tap), drag him anywhere along the bottom (drop him from high up for the plop), push him past an edge to send him away, ⌘⌥S or the menu-bar icon toggles him. When a question arrives for you he comes to the edge with a question mark. `KT_WINDOW_MODE=column pnpm desktop` gives the earlier fixed-corner behaviour. Settings → **You** chooses whose questions you see. `pnpm service` runs the service alone; `pnpm mcp` runs the MCP stdio server (`{"command":"node","args":["src/apps/service/mcp.ts"]}` in a client config). `pnpm test`, `pnpm typecheck`, `node experiments/run.ts all`, `node scripts/screenshot.mjs`.

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
