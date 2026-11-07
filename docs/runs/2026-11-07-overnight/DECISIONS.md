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

## R12 · DECISION — Four parallel build workers instead of three

The prompt's launch default was three active workers. I ran four in the first build phase (ingest/memory, investigation/questions, UI/desktop, evaluation data) because the evaluation owner only writes data and benchmark code and cannot conflict with the others, and your Mac has 10 cores. Each worker had exclusive paths; none could edit contracts. Reviews are one Opus agent per worker, then a Sonnet fix pass, then the service worker. **Reverse:** nothing to revert; it only affected concurrency.

## R13 · DECISION — Tests run TypeScript natively with node:test

Node 26 strips types without a flag, so tests are plain `node --test` over `*.test.ts` with no framework. Reason: zero dependencies, fast, and the same command works for workers, CI and you.

## R14 · DECISION — Condition vocabulary lives in contracts

Extraction (ingest side) and investigation (query side) must agree on condition keys (`interface.status`, `traffic.counters`, `unit.age`, `site.access`, ...). I put a canonical, organization-extendable list in `src/libs/utils/contracts/vocabulary.ts` so nothing telecom-specific is hard-coded in module logic; organizations extend it through configuration.

## R15 · ASSUMPTION — Requester-observable conditions become "check first", not questions

If the person asking could observe a condition themselves (for example traffic counters right now), the engine recommends checking it instead of asking another person. Questions go to other people only for things they have a question-specific reason to know (they performed the action, reported the outcome, or can observe the site). This follows the closed decision "search permitted sources and available observations before interrupting a person"; the exact rule is a run default.

## R16 · DECISION — Coordinator defaults (U08 stays open)

Per-person daily limit 3, cooldown 30 minutes, max 1 open question per person, max 3 questions per investigation. These are parameters in `contracts/questions.ts` `defaultCoordinatorSettings`, used for the synthetic trials; no live delivery setting is adopted from them.

## R17 · DECISION — Question selector default is the rule baseline

`selectorId: 'rules'` by default. The LinUCB contextual bandit is trained and compared in E03 but only replaces the baseline behind the setting if the predefined checks pass; U01 (next-choice vs whole-investigation) stays open and E09 is not claimed.

## R18 · DECISION — Who "you" are in the desktop app is a setting backed by the visible directory

The service exposes the organization directory (names, roles, groups, availability only). Settings has a "You" selector; your identity decides which questions you see and the access groups used for retrieval. If nobody is chosen, you can still ask as a labeled Guest, but a Guest can never answer questions (no invented identities). Demo reset picks a default person (the first available field engineer, so Veikko in the Elisa demo). **Why:** the question loop needs a real recipient, and switching identity in Settings is the simplest honest way to demo both sides (asking and answering) on one Mac. **Reverse:** `PUT /settings` or the Settings row.

## R19 · DECISION — Installed year is not a distinguishing condition; hedged conditions never create questions

On the Elisa demo, "installed around 2019" (hedged in the source) was treated as a decisive condition and produced a bogus gap. Now `unit.age` (older/newer, folded from years through a configurable cutoff) is the distinguishing key, and inferred or hedged case conditions cannot create consequential gaps. The distinguishing-key list is configuration in `src/libs/utils/investigation/settings.ts`.

## R20 · DECISION — E01's "LLM arm" is a recorded Claude subagent, labeled as such

The handoff's LLM extraction arm needs an authorized inference route. I ran a Claude Sonnet subagent once over the visible train/validation sources (never the hidden truth) and saved its proposals under `data/replays/e01-claude-arm/`. They are scored as route `claude-agent-arm`, never as the proposed small GPT generator, and the application never calls Claude.

## R21 · DECISION — Case timelines are compacted for reading

The raw TRN-042 case had 16 timeline nodes (five separate "Possible cause" fragments, two "Advised against", email duplicates). The case view now merges hypotheses into one node, checks into one node, keeps one node per performed attempt, and puts the preceding change (SFP replacement) under Reported conditions. All claims stay in the store; only the view is compacted.

## R22 · DECISION — A documented default "who can observe what" policy, as organization configuration

Without it, a question such as "Is TRN-301 an older unit?" had nobody eligible (no one has firsthand history for a new asset) and the loop deferred. I added `src/apps/service/org-config.ts`: NOC/transport/core groups and Network Expert / NOC Engineer roles may be asked about equipment facts (age, model, revision, software version, recent config change); field and access roles about site facts. The library default stays empty; the service applies this policy unless started with `--org-policy none` (tests do). On the Elisa demo the question now goes to Erkki as the network expert. **Why:** this is the closed decision that an authorized person who can observe a condition is a suitable recipient; the specific map is a run default for E06 and the demo.

## R23 · DECISION — Extraction was tuned on the train families; validation got contaminated once and was cleaned

The tuning worker added two validation-only words; the reviewer caught it and they were removed, which lowered validation claim recall from 15/22 to 14/22. The report marks validation as "tuned-adjacent" and the test split was never used for tuning. Numbers are in `experiments/RESULTS.md`.

## R24 · DECISION — The test split was opened exactly once

E02 (retrieval) and E04 (assessor) were confirmed on the test families once, before the extractor tuning. Because their validation decisions did not change after tuning, the test split was not re-opened. The test results therefore describe the pre-tuning system; the lock file shows the families untouched.

## R25 · ASSUMPTION — E-mail has no access metadata

An e-mail imported from a text file carries no ACL, so it is stored as organization-visible. One synthetic demo problem (`remote-power-access-p3`) therefore shows an e-mail whose truth says it belonged to a restricted incident. The system cannot detect this; it is listed as a known limitation, not counted as a leak the engine could prevent. Fixing it needs an ACL source for mail.

## R26 · DECISION — Shipped experiment choices (all behind configuration; baseline retained)

E02 hybrid retrieval (tied lexical on validation and test, so hybrid is kept as the configured default while lexical remains available), E04 separate support/applicability (tie; keeps the targets identifiable), E03 rules selector (LinUCB wins only on the simulator; the family arm asked too few questions to test the frozen rule), E05 pool size 1 (uninformative tie), E06 question-dependent eligibility, E07 defaults 3/day and 30 minutes. None is a product decision; U01–U23 stay open as listed in `OPEN_QUESTIONS.md`.

## R27 · DECISION — Local history was rewritten once to remove an accidental bulk add of design-lab

Two of my early `git add -A` commits had swept all 4,299 design-lab files (143 MB of frame caches and screenshots) into the branch, against the instruction to keep bulky caches out of Git. Since nothing had been pushed, I rewrote the branch's commits to drop those files (only the 37 selected design sources stay tracked, hashes unchanged), restored the working tree from a backup, and added `design-lab/` to `.gitignore`. Commit hashes on the branch changed; the content of every commit is otherwise identical. `.git` went from 34 MB to 6.2 MB. **Reverse:** not needed; the files are untouched on disk.

## R28 · DECISION — The launch drop falls from the top of the screen and lands uncropped (your morning correction)

You saw Snowbally just appear and sit, without the "plop". Two things were wrong with my R05 implementation, not with the artwork: the v008 avatar window crops the 96 px scene to a 44 px square starting at scene row 42, so the authored fall (which begins 3 px above the scene) and even the top of the spring-back were cut off; and a 680 px window cannot show a fall from the menu bar. Now: the companion window spans the whole work-area height (the extra area is transparent and click-through, the panel stays anchored at the bottom, nothing else changes), and the entrance is drawn on a second, pointer-transparent "drop" canvas that is the full 44x86 scene column aligned to the avatar's floor. Snowbally starts behind the menu bar, falls for 0.9 s with constant acceleration (y = start·(1 − p²), a plain gravity curve, moved with a GPU transform, ~2 draws per 60 ms for the streaks), the resting shadow waits on the floor, and at touchdown the authored frames from "Impact" onwards (pancake squash, spring back, stars, hello) play unchanged and uncropped; then he idles and the drop canvas is hidden. The falling pose reuses the entrance's stretch silhouette and air streaks; no new anatomy. The avatar hitbox (64x64 at the same place) does not move at any point (checked per frame), reduced motion still shows a still, and any reaction or click interrupts the fall cleanly. Idle CPU and open/close frame times are unchanged (0.21 %, max 9–17 ms).

**ASSUMPTION:** "from the very top of the screen, like from the top bar" means the window's top edge, which is the bottom of the macOS menu bar; and 0.9 s is a good fall time (it is one constant in `avatar.ts`, `ENTRANCE_FALL_MS`). **Reverse:** pass no `drop` canvas to `AvatarController` (the renderer does this in one line) to get the old cropped entrance, and `placeBottomRight` in `window.ts` to get the 680 px window back.

## R29 · DECISION — Clicking Snowbally plays the lab's "Springy tap" (pixel-motion v007 / UI v009)

You asked for the springy click animation from the lab player. The ChatGPT lab had added it this morning as a new act, `click` ("Springy tap", 10 frames at 15 fps: notice, squash to a 36x16 pancake, spring, second rebound, settle; existing poses only, no new anatomy), and UI v009 wires it to every direct avatar click while opening the panel programmatically stays quiet. I ported the act byte-for-byte (the parity test now replays the v009 sources, which equal the v007 modules), wired it exactly as v009 does (toggle, then the tap; the small wave is no longer played on open), and tracked the new lab sources in the input manifest. Everything else from v008 is unchanged. **Reverse:** one line in `panel.ts` (`avatar.play('click')` in the avatar action).

## R30 · NOTE — Elisa's challenge pitch deck arrived; filed privately, report cross-checked

You forwarded Elisa's own challenge deck (Joni Nuvola, Autonomous Network Operations). It is organizer material, so it is copied to `private/organizer/` (git-ignored) and never committed. Its evaluation order (usability first; then relevance, linking, feasibility, agent-readiness), its "strong demo" shape (capture, link with source and validity, reuse on a similar old node) and its five hard parts are now answered point by point in REPORT.md §5a. Nothing in the product changed because of it; it confirms the direction (one-tap, rare questions; no forms) and the demo path. Deadline unchanged: submission through sinceai.app by Sunday 8 Nov 10:00; Elisa reviews 10–13. Deliverables named there: working demo, pitch slides, documentation, code repo. We have no pitch slides yet.
