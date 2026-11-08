# Lumi (Knowledge Twin)

**Since AI Hackathon 2026 · Elisa challenge · state of `main` on 8 November 2026**

Lumi turns the conversations engineers already have into checked, reusable operational knowledge. It reads a channel (Slack in the demo), keeps the sentences that matter, links them into a case per unit, and asks the right person a quick yes/no question only when an answer would change what is known. Colleagues get the knowledge back through a small desktop companion (Lumi, a pixel snowball); AI agents get the same knowledge over MCP.

The pitch addresses four problems:

1. Useful knowledge is buried in ordinary conversations.
2. Knowledge loses meaning without its incident, equipment, people and outcome.
3. Similar problems can require different responses, and historical advice can be incomplete or wrong.
4. Knowledge must reach engineers and autonomous agents with minimal extra work.

## What is built

- **Local service** (`src/apps/service`): Node 24, SQLite, HTTP API on `127.0.0.1:47831`. Extraction of typed claims (problem, condition, possible cause, action, outcome) from messages, cases per unit and episode, applicability checks, people with relevant experience, question generation, recipient selection and the reward record per answer.
- **Desktop companion** (`src/apps/desktop`, Electron, macOS and Windows): Lumi lives at the screen edge, comes in when a question for you arrives, opens a one-tap card (Yes / No / Not sure / Later, with "Why this question?"), answers your own questions with the matching case, its chain (problem → conditions → cause → checks → outcome) and the people who know, and gets out of the way when you work elsewhere.
- **MCP server** (`src/apps/service/mcp.ts`): 12 tools over the same engine and the same access rules and budgets (`kt_investigate`, `kt_find_people`, `kt_request_clarification`, `kt_record_outcome`, …). An agent never contacts a person directly; its question goes through Lumi.
- **Live Slack, read-only** (`pnpm film`, `scripts/film-run.ts`): polls one channel through a read-only allowlist with a bot token you provide in the environment, imports it as live evidence and drives the questions. Used for the demo video. Teams, Outlook, Gmail, Jira, Confluence, ServiceNow and GitHub are shown in Connections as "Soon".
- **Backend pages** (no design on purpose, for demonstration): `/pipeline` (raw → filtered → linked → hypothesis, with the evidence count against the threshold), `/pipeline/questions` (what is known per case and each question → who → answer), `/context.html?entity=TRN-042` (what is known about a unit over time, and what an agent is told at a chosen moment).
- **Models are optional.** By default everything runs on rules, locally, with no model and no network. Local models via Ollama (bge-m3 embeddings, qwen3 extraction and phrasing) can be switched on in Lumi → Settings → Admin → Models; their output is checked by the same rules.
- **Tests:** `pnpm test` (644 passing on `main`), `pnpm typecheck`, `node experiments/run.ts all`, `node scripts/screenshot.mjs` (UI harness).

## What is real and what is simulated

- Real: the service, the extraction and linking, the question engine, Lumi on the desktop, the MCP server and agent, and in the video a real Slack channel read live.
- Simulated: the extra colleagues in the demo (their answers are scripted and tagged "simulated" on the backend pages), the synthetic scenario families, and the activity stream of `pnpm demo:judge` (labelled as such).
- In the video, Part 1's clustering page (local bge-m3 embeddings scored on meaning, time and conversation, then a local qwen3 sentence) is a real computation on the film's Slack messages, made with `scripts/film-video/part1-pipeline/`. In the product, linking is by unit, episode and conversation; embeddings are the opt-in model slot above.
- Nothing is deployed. Everything runs on one machine.

## Quick start for judges (3 minutes)

```bash
pnpm install
```

```bash
pnpm demo:judge
```

One command: resets the demo data, starts the local service, starts a **simulated** activity stream, opens it in a browser tab and launches Lumi (bottom-right). Then follow [docs/DEMO.md](docs/DEMO.md): click Lumi, choose who you are (Settings → Admin → You), paste the TRN-088 text and see Erkki's rule reused with its caveats and sources; paste the TRN-301 text and watch the one yes/no question reach Erkki; switch to Erkki, answer it, switch back and see the recommendation change; run `pnpm demo:agent` for the same answer over MCP. Ctrl-C stops everything.

- No Slack, mail or model is needed for this path; the stream is synthetic and labelled so.
- Elisa's example files are read from the git-ignored `private/` folder when present; otherwise the synthetic TRN-117 case plays the same part.
- Trouble? `pnpm demo:reset` restores the data; `pnpm service` starts the service alone; the troubleshooting box in DEMO.md has the rest.

No install at all: `pnpm web-demo` builds a static, clickable preview of the panel on mock data in `dist/web-demo/`.

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

`pnpm desktop` builds the renderer, starts the local service if it is not already running (SQLite at `data/local/knowledge-twin.sqlite`) and opens Lumi. He falls in from the top of the screen, says hello and rolls off to the edge, his home; move the cursor near him and he peeks out, click him for the panel, drag him along the bottom, ⌘⌥S or the menu-bar icon toggles him. When a question arrives for you he comes in with a question mark. Points are opt-in per person (Settings → Points & rating) and never judge correctness.

Other entry points: `pnpm service` (service alone), `pnpm mcp` (MCP stdio server; client config `{"command":"node","args":["src/apps/service/mcp.ts"]}`, see [DEMO.md](docs/DEMO.md) for flags), `KT_WINDOW_MODE=column pnpm desktop` (fixed-corner window).

### Live Slack run (as in the video)

Needs a Slack app from [docs/film-pages/slack-app-manifest.yml](docs/film-pages/slack-app-manifest.yml), invited to one channel, and its bot token in `KT_SLACK_TOKEN` (never committed or printed). The run of show, the conversation and the second-Mac setup are in [docs/film-pages/](docs/film-pages/RUN_OF_SHOW.md). `pnpm film --replay --desktops` rehearses the same run without Slack.

## Windows

From source (Node 24 and pnpm on PATH), the same commands work in PowerShell: `pnpm install`, `pnpm demo:reset`, `pnpm desktop`. Lumi sits above the taskbar; the tray icon toggles him, Ctrl+Alt+S too.

Installer: `pnpm dist:win` builds `dist/release/Lumi-Setup-<version>.exe` (per-user, no admin) and `Lumi-Portable-<version>.exe`. The packaged app runs its own service, keeps the database in `%APPDATA%\Lumi\knowledge-twin.sqlite` and seeds the demo on first launch (Elisa's files are never packaged). The builds are unsigned, so SmartScreen asks once ("More info" → "Run anyway").

## Documentation

All planning and development Markdown lives under [`docs/`](docs/README.md).

- [Demo walkthrough](docs/DEMO.md) and [submission summary](docs/SUBMISSION.md).
- [Challenge and product brief](docs/BRIEF.md) and [full vision](docs/VISION.md).
- [Architecture](docs/ARCHITECTURE.md), [interactive master map](docs/master-map.html) and [engineering decisions](docs/ENGINEERING_DECISIONS.md).
- [Engineer experience and points brief](docs/EXPERIENCE_BRIEF.md).
- [Submission video tooling](scripts/film-video/README.md) and the [film pages](docs/film-pages/RUN_OF_SHOW.md).
- [Earlier research](docs/RESEARCH.md) and [initial concept](docs/INITIAL_CONCEPT.md): historical, superseded assumptions marked.

![Default white pixel avatar](docs/assets/avatar-default.svg)

No production mailboxes, background capture or operational equipment access is used. Keep secrets and restricted source material out of Git; private supplied examples stay in the ignored `private/` directory.
