# Assumptions and decisions — overnight run, 7 November 2026

**For Artem.** Everything I decided without you is listed here, in the order I decided it, with the reason and how to reverse it. Nothing here is a product decision; each is a run default you can correct. Items marked **ASSUMPTION** are my reading of something you said; items marked **DECISION** are choices I made where the documents left it open. U01–U23 from the handoff stay open unless stated.

Each piece is a separate commit on branch `run/2026-11-07-overnight`, so a single part can be reverted with `git revert <sha>`.

---

## R01 · ASSUMPTION — Your messages tonight override the written prompt where they differ

Your chat messages (keep committing, keep the Mac awake, Snowbally does only the falling animation on launch, panel opens on deliberate click, local database, small models trainable on your Mac, no cloud, use the ChatGPT animation and panel design) are the latest steering. Where the orchestrator prompt says something different (for example "avoid commits during concurrent work"), I follow you and note it.

## R02 · DECISION — Work on a run branch, commit small, never push

Branch `run/2026-11-07-overnight` from `main`. One commit per coherent part (tooling, contracts, each module, each experiment, UI pieces) so you can revert any piece. Nothing pushed; `main` untouched. **Reverse:** merge or cherry-pick what you like into `main`.

## R03 · DECISION — Preserve inputs by committing the small selected design sources in place

I committed the uncommitted docs plus the frozen ChatGPT UI v008 and pixel-motion v006 sources (not the 96 MB frame caches, screenshots or older versions). Those stay untracked and untouched on disk. Hashes are in `INPUT_MANIFEST.md`. **Why:** worktrees and agents can't see untracked files reliably; the prompt asked for an input snapshot with provenance. **Reverse:** `git revert 9792216`.

## R04 · DECISION — Stack: TypeScript everywhere, pnpm, Node's built-in SQLite, Electron, esbuild, node:test

- One language (TypeScript) across libraries, service, Electron and experiments. Reason: the prompt suggests it, there is no established stack, and one language avoids an invisible duplicate of core semantics.
- **Database: SQLite through Node's built-in `node:sqlite` module** (Node 26). Zero native build steps, one local file at `data/local/knowledge-twin.sqlite` (git-ignored). The handoff proposed PostgreSQL; this is the documented local substitution behind an explicit storage boundary (`src/libs/utils/memory/store.ts`). **Reverse:** implement the same store interface over Postgres.
- Electron for the desktop window (D17 direction). The renderer is plain TypeScript + the v008 markup/CSS, no React, because the design source is vanilla and it keeps the window light.
- esbuild bundles renderer and main; `node:test` runs tests; no test framework dependency.
- Package manager pnpm (installed on your Mac).

## R05 · DECISION — Snowbally launch behavior

On launch: a small, frameless, transparent, always-on-top window appears at the bottom-right of your screen showing only Snowbally. He plays **Drop & settle** (the v006 "entrance" act: falling stretch, air streaks, impact squash, rebound, brief stars, hello) exactly once, then holds the three-pose idle (500 ms per pose). Nothing else opens. The panel opens only when you deliberately click him, exactly the v008 toggle behavior (reopening restores the previous view, draft, attachments, expanded context and selected detail). Reduced motion: a static pose, no drop.

**ASSUMPTION:** "the app appears if you deliberately click on the icon" means clicking Snowbally. I also added a menu-bar (tray) item to show/hide him and to quit, because a frameless window has no other handle. You said you're not sure the panel-on-click is needed; I kept it because without it there is no way to write to him. **Reverse:** `src/apps/desktop/main.ts` has `OPEN_ON_LAUNCH` and tray flags.

## R06 · DECISION — No model API calls; three clearly labeled routes

The "no model API calls" rule stays. Model-dependent stages use a provider interface with three implementations:
1. `rules` — deterministic, inspectable baselines (regex/structured extraction, BM25 retrieval, rule selector).
2. `local` — small learned models trained on your Mac from synthetic data (logistic regression on hashed text features, a linear contextual bandit, a small pairwise linker). Pure TypeScript, saved as versioned JSON artifacts under `data/models/`.
3. `replay` — recorded fixtures (including explicitly labeled **Claude-agent experimental arms** where a Claude subagent did extraction/ranking on fixtures during this run; inputs, outputs and the agent label are saved). These are never presented as small-GPT results, and the app never calls Claude.

Nothing in the app or experiments contacts any provider.

## R07 · DECISION — Synthetic data: Claude agents author scenario families; hidden truth lives apart from runtime

The evaluation owner (a subagent) writes scenario families in the Elisa example style: each family has a fixed hidden truth (`truth.json`: timeline, real cause, what each person knows/can observe, outcome rules) and visible sources (Teams-style JSON, email text, Slack-style export). Families are split historical-memory / incoming / train / validation / test **by family**, so a paraphrase of TRN-042 is never an "unseen" test. The supplied Elisa files are read from `private/` at demo time and are not copied into `data/`. Hidden truth is only read by `benchmarks/` and `experiments/`, never by `src/`.

## R08 · DECISION — Run limit

No hard stop was given; you said don't stop until it works locally. I use: one bounded build, then experiments, with a review checkpoint roughly every hour, and I stop retrying any identical failure after three attempts. No paid services, no account connections, no pushes.

## R09 · DECISION — Agent mapping

Available Agent models verified from the tool: `sonnet`, `opus`, `haiku`, `fable`. Bounded implementation and routine tests → `sonnet`. Consequential review / difficult failures → `opus`. I (Fable 5.1) own contracts, root tooling, integration and the final UI polish pass. Workers get exclusive paths; shared contract changes go through me.

## R10 · DECISION — Service and desktop are separate processes on localhost

The service is a plain Node HTTP server on `127.0.0.1` (port from config, default 47831) that owns the SQLite file and exposes the same engine as JSON API and as an MCP server (stdio). Electron starts it as a child process and talks to it over HTTP. Reason: keeps native/secret capabilities out of the renderer, lets the same engine serve the UI, API/MCP consumers and the evaluation harness, and avoids compiling SQLite for Electron's Node.

## R11 · DECISION — Points are off by default, separate record, no sounds added

Points/rewards: implemented as a separate `participation` record with an on/off switch, never read by evidence, retrieval or selection. Sound control exists as a setting but ships silent (no audio assets authored tonight; the companion has no voice).

---

*(Appended as the run progresses; later entries are below.)*
