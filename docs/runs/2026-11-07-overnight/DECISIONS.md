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

## R31 · DECISION — One work-area window, a floor 12 px above the Dock line, and the card as the carrier (UX pass)

You asked that Snowbally can be moved and can leave the screen. The window is now the primary display's work area exactly (transparent, click-through except Snowbally and the open panel), and the v008 card `.rf-window` (which already contains him) is the **carrier**: a desktop CSS rule anchors it at `left:0; bottom:0; transform:none`, and only `src/libs/utils/ui/companion.ts` moves it, by `translate3d` rounded to whole device pixels. Card and Snowbally always move together; the card is never mirrored. Geometry (`GEOMETRY` in `companion.ts`): bodyX = his body centre, card left = bodyX − 333, card bottom = 30 + lift, so his contact row sits 12 px above the window bottom (26 px lower than before). Home spot = work-area width − 79 by default; the sliver keeps 12 px of his **body** inside (`W + 28 − 12`); the perch shows the whole canvas (`W − 44`); the card fits for 345 ≤ bodyX ≤ W − 59. The spot is stored as `kt-companion.v1`. The floor shadow has its own strip `.rf-shadow` so it stays on the floor while he is lifted. **Flags:** `KT_COMPANION` (`companion`), `KT_WINDOW_MODE=column` (the R28 window, everything off). **Reverse:** `KT_COMPANION=0` or `KT_WINDOW_MODE=column`.

## R32 · DECISION — Press, click, drag and a gravity derived from the launch

Pointerdown on him draws the press pose in the same frame; a release within `DRAG_THRESHOLD_PX` = 4 (a quick tap may wobble 8 px within 180 ms, `TAP_ALLOWANCE`) is a click: the panel toggles and the Springy tap continues from frame 2 (R29 kept; keyboard clicks keep the v009 path). Beyond it he is carried: stretched body, dangling feet, surprised → happy after `CARRIED_HAPPY_MS` = 400, following the pointer 1:1. Release = a fall with gravity derived from the R28 launch (D0 = window height falls in 900 ms), landing settle / hop / entrance by impact speed (motion R32 constants `LANDING_SPEED_PX_S` 450 / 1100, `SHADOW_TIER_LIFT_PX` 48 / 160, `SETTLE_FRAME_MS` 62, `LANDING_FRAMES`, `TALL_ACTS`, `LOOP_INTERJECTIONS`). The carrier follows the fall, so he can be caught mid-air. The dropped x becomes his spot (clamped to [14, W − 14]). Pushing him past a side edge (his centre beyond it, or the pointer pinned to the screen edge, `EDGE_PIN_PX` = 4) and letting go sends him away to that edge; there is no velocity fling. **Flag:** `KT_DRAG` (`drag`). **Reverse:** `KT_DRAG=0` (every press is a click).

## R33 · DECISION — Away is his home: he leaves, peeks, and hops back in

Your addendum made away the default. After the launch hello he leaves after `LEAVE_AFTER_LAUNCH_MS` = 4000, and later after `LEAVE_AFTER_IDLE_MS` = 20000 without interaction (pointer outside his 160 px zone, no drag, panel closed; closing the panel starts the same timer), per your correction of the 1.5 s rule. Leaving rolls (`LEAVE_MOTION` = roll: tuck body, one turn step per 22 px, 900 px/s, 1600 px/s²) to the perch and tucks to the sliver in two frames; away is a held still with zero timers and zero rAF. Pointer within `PROXIMITY_PX` = 160 of the sliver → he peeks to the perch looking at it; after `PEEK_DWELL_MS` = 400 in the zone or within `PEEK_NEAR_PX` = 60 he hops in (`RETURN_MOTION` = hop, `HOP_MS` 1125, a single hop up to `HOP_REACH_PX` = 200, longer ways roll first) and says hello; an abandoned peek goes back after `PEEK_RETREAT_MS` = 1500. After he leaves, the pointer has to leave his zone once before it can make him peek (otherwise "send away" with the cursor in the corner would bring him straight back). Opening the panel where the card does not fit slides him with the panel's own spring (`SLIDE_OMEGA` = 40) while he hops; after closing he rolls back to his spot. Arrival never focuses anything; programmatic opens no longer move focus. **Deviation (ux fix M3):** on the right edge the authored question glyph (32–42 px right of his body centre) is outside the window when he is tucked to the 12 px sliver, so that one still (tucked at the right edge, an unseen question waiting) draws the authored glyph pixels mirrored to the left of his body (`heldFrame(…, { glyphSide: 'left' })`); every other frame, the perch and the left sliver keep the authored place. **Ux fixes:** a travel, slide, launch / panel watcher or fall that gets no frame for `FRAME_WATCHDOG_MS` = 1000 completes at once in its end state (as under reduced motion), and window focus / visible / pageshow complete a motion whose frames went stale (> `RESUME_STALE_MS` = 250); from an edge farther than `HOP_REACH_PX` make-room travels in (roll, then hop) instead of the spring, and a click at such a perch opens the panel on arrival; the sideways hop moves only during frames 4–10 (`HOP_AIR_MS` = 250–687.5); no mouse action leaves the keyboard focus ring on him or the panel. **Flag:** `KT_AWAY` (`away`). **Reverse:** `KT_AWAY=0` (he stays in; tray and shortcut fall back to Show / Hide).

## R34 · DECISION — Questions still reach the person while he is away (attention + collapsed poll)

`src/libs/utils/ui/attention.ts` keeps, per question id, when it was first waiting, `seen` (its question view opened), `announced` (he arrived with it), `reminded` and `snoozedUntil`. At most one arrival per id; at most one reminder per id (a single trip to the perch on unlock / resume after `REMIND_AFTER_AWAY_MS` = 20 min away); `Later` snoozes for `LATER_SNOOZE_MS` = 30 min (the service's default cooldown; the API has no deferral time). Arrival: he hops to the perch, plays `question` once with the glyph at its authored place, holds for `PERCH_WAIT_MS` = 90000 or until the pointer comes near; ignored → back to the sliver and the tray shows ` ?`. The glyph on his idle body now means "an unseen question is waiting" (or the question view is open); a click with one waiting opens that question. **Changed:** while the panel is collapsed, `/questions` is polled every `COLLAPSED_POLL_MS` = 90000 (skipped while the document is hidden) and refreshed at once on show, unlock, resume and return; before there was no timer while collapsed. Local-only counters (time to first open, answered / deferred / dismissed, arrivals, reminders, arrivals ignored) are stored as `kt-engagement.v1`; nothing leaves the machine. **Flags:** `KT_AWAY` / `KT_COMPANION`. **Reverse:** either flag off (no watch, no arrivals, the R28 glyph rule).

## R35 · DECISION — Reaction map, cursor awareness and fidgets

Answer reactions (`REACTIONS` in `panel.ts`): Yes / No → `hello` (equal warmth), Not sure / Later → `peek`, Dismiss → a composed two-frame settle (crouch, low), Undo → `peek`, a points reward → `hop` (only with Points on). Never yawn or sheepish as an answer reaction. While he is in, he looks toward a pointer within 160 px (`look()`, hysteresis `GAZE_ON_PX` 24 / `GAZE_OFF_PX` 12, at most one redraw per `GAZE_MIN_INTERVAL_MS` = 250, quarter view only toward the right because the kit's quarter view faces right, off under reduced motion). Fidgets are off by default (`COMPANION.fidgets`, flag `fidgets`, Settings row "Fidgets"): at most one per `FIDGET_MIN_MS`–`FIDGET_MAX_MS` (4–8 min), `stretching` or `peek` only, never while away, with a glyph, with the pointer near or with the panel open. The brief's 45–90 s cadence and hover = peek were rejected. **Flags:** `KT_GAZE` (`gaze`), `KT_FIDGETS` (`fidgets`). **Reverse:** `KT_GAZE=0`; `REACTIONS` back to `result` for all.

## R36 · DECISION — Ways back: click, drag, tray, shortcut, second launch, right-click

A click on the sliver brings him back; dragging him out of the sliver works too; the tray has "Bring Snowbally back" / "Send Snowbally away" and "Put Snowbally back in the corner" (also a Settings row); the global shortcut `CommandOrControl+Alt+S` toggles (a failed registration is logged and the accelerator omitted); launching the app again brings him back; right-click on him opens the same menu. "Hide completely (stops questions)" stays as the do-not-disturb option. The page side listens to `kt-command` / `kt-power` / `kt-area` and reports `kt-companion:state {away, question}`. **Flag:** `KT_SHORTCUT` (`shortcut`). **Reverse:** `KT_SHORTCUT=0` (no global shortcut); the other paths follow `KT_AWAY`.


## R37 · DECISION — (demo branch, merged 7 Nov; its R31–R36 renumbered R37–R42) The judge demo is one command plus a 3-minute script; the simulated day starts after a quiet period

`pnpm demo:judge` resets the data, starts the service, starts `pnpm demo:play`, opens `/demo/activity.html` and launches the companion; `docs/DEMO.md` is the script. The simulated day begins only after `--stream-delay` (default 240 s), because a live stream competes with the walkthrough for the same people: the first dry run showed the judge's TRN-301 question going to a simulated NOC engineer (Antti Korhonen, from an arriving family) instead of Erkki, since the rules selector breaks ties between equally placed role/group observers by id order, and the stream's own questions use Erkki's budget and cooldown. With the quiet period the walkthrough runs on exactly the seeded directory (where Erkki wins the tie, as in the run report) and the day starts when it is over. **Reverse:** `pnpm demo:judge --stream-delay 0` (or `--no-stream`). I did not change the selector's tie-break; that is U26.

## R38 · DECISION — Simulated-day pacing and content

1 simulated hour = 10 real seconds (`--hour-seconds`), 07:30–17:30 local (`--start`, `--hours`), ticks of 5 simulated minutes, seed 1 (`--seed`; same seed, same day). Arriving evidence: the train and validation families (`--families`, default `train,validation`; test families only when named, so the locked test split stays untouched), each as directory → Teams thread → e-mails → Slack days, staggered, whole threads at once (message-by-message arrival would change episode assignment). Investigations: the families' visible `incoming.json` problem texts and requesters (read through `benchmarks/load.ts` `loadVisibleInputs`, which drops the hidden keys; nothing in `src/` reads `incoming.json` or `truth.json`), plus three Elisa-style texts by people already in the demo directory. The service's clock is moved along with the simulated one (`POST /demo/clock`), so daily limits and cooldowns are counted in simulated hours while the stream runs and return to real time when it stops.

## R39 · DECISION — Simulated colleagues reuse the simulator's model, never the answer keys

Replies come from `src/libs/utils/simulation/people.ts`: the same shape as `models/testing/simulator.ts` (hidden per-person knowledge per topic, responsiveness 0.55–0.95, 0.92/0.7 correctness for firsthand-like vs hearsay knowledge), seeded from the visible directory (roles and groups decide which topics a person knows firsthand). Non-responders become Later (with a follow-up answer 70 % of the time), Dismiss or no reaction, with delays of 3–40 simulated minutes (follow-ups 45–160). The hidden scenario answer keys are not used: the demo is about the loop and its limits, not about the oracle's truth, and the keys stay evaluator-only. The topic of a question is inferred from its wording (the API does not expose the gap key).

## R40 · DECISION — The judge's own person is never auto-answered and is involved at most once per two simulated hours

The stream reads Settings → You every tick and never answers, defers or dismisses that person's questions (it logs them as *for you*). Every `--judge-every` minutes (default 120) it tries once to involve them, only when no question for them is open, by asking one scripted problem from `data/demo/judge-prompts.json` whose `targets` include that person (the requester is excluded by the coordinator, so choosing the requester steers who is eligible: Erkki asking about TRN-042 reaches Veikko; Helmi asking about TRN-117 reaches Aarne; a NOC engineer asking about a new TRN unit reaches Erkki). The coordinator still decides, and its limits (3 per simulated day, 30 min cooldown, 1 open) apply; the log says when it chose someone else.

## R41 · NOTE — Demo additions to the service are read-only or demo-scoped

`GET /demo/activity` tails a JSONL file the stream writes (the service never writes it); `/demo/activity.html` is a plain page in the panel's palette; `GET|POST /demo/clock` moves the engine clock (409 when a host fixed it, as tests do); `POST /import` accepts an inline `directory` (a family's people.json) with an inline payload; `QuestionView.personEntityId` names the recipient. 29 routes now. The panel was not edited (contract request `contract-requests/demo-activity.md`). The Slack demonstration uses the synthetic export of `config-rollback-private` only; the live connector stays awaiting authorization (U25).

## R42 · DECISION — Live Slack only as a guarded, read-only pull of one sandbox channel

Artem answered U25 with yes (sandbox, read-only). The live path is `pnpm demo:slack --live --workspace <team> --channel <#channel>` over `connectors/slack-live-pull.ts`: it runs only with `KT_SLACK_LIVE=1` and `KT_SLACK_TOKEN` set in the operator's shell (the token is read from that variable only, never from files, keychain or `private/`, never printed or stored), makes one `auth.test` and stops if the team name differs from the one named, and uses a client whose only methods are `auth.test`, `conversations.list|info|members|history` and `users.list` (anything else throws before the network). It reads the one channel's last N messages (default 50) and member list, maps them with the export code (private channel = members only) and imports them as format `slack-live`, connection `slack-live:<team id>`, with a `route: slack-live` row in the activity stream. No write scope is ever requested; nothing is posted. Verified with a fake client (refusals, mismatch stops after `auth.test`, read-only call list, private scope and membership, public org-wide, web client allowlist) and by running the refusals on this Mac; no live call was made here because no token exists in this session. **Reverse:** do not set the variables; the synthetic export path is the default.

## R43 · DECISION — He is called Lumi (snow, in Finnish)

Artem renamed the companion from "Snowbally" to **Lumi** on 7 Nov. Every user-facing string (window title, tray items, aria labels, README, DEMO.md, REPORT.md, code comments in the app) now says Lumi; code identifiers and the design-lab history keep their old names, since the frozen lab files are not ours to edit. **Reverse:** a word replace back.

## R44 · TRIAL — A quiet band of small grey crosses at the bottom of the card

Artem asked to try "small grey crosses at the bottom of the panel, more texture while staying minimalistic, delete if not good". Implemented as a desktop-only element behind the footer (`.rf-texture`: 14 px tiles, 1.1 px strokes in #d9dde0, fading upwards over 44 px); no v008 value changed except that the footer background is transparent while the band is on. On by default for the trial; `KT_TEXTURE=0` (flag `texture`) removes it entirely. **Reverse:** the flag, or delete the three marked rules and the element.

## R45 · DECISION — Idle moves when nobody points at him (Artem, 7 Nov afternoon)

"He can move around and do some moves, mostly when the user is not pointing at him, and not annoying; after you've closed the panel he can do something." Fidgets are now on by default (`fidgets` flag, `KT_FIDGETS=0` off; the Settings row still overrides): one move every 40–110 s, only when he is in, the panel is closed, no question waits, the pointer is not within his zone and nothing else plays. The pool: stretching (55 %), peek (25 %), hop (20 %), and in 30 % of the slots a short wander instead: a roll of 40–120 px along the floor to a nearby spot (kept inside where the card fits; the remembered home spot is unchanged). 1.2 s after the panel closes (once he is back at his spot and the pointer has gone) he does one small move without the wander. **Reverse:** `KT_FIDGETS=0`, or the constants in `COMPANION`.

## R46 · DECISION — Points are a per-person choice, end to end (Artem, 7 Nov: "a full end-to-end point system that one can switch on or off, meaning that one can decide if he participates", plus a rating panel)

**Opt-in is the person's own record**, not a device setting: `participationOptin` (`{participates, since}`, default no), `GET|PUT /participation/:id/optin`, PUT only by that person (403). Points are awarded only when the recipient takes part at the time of the contribution; `UserSettings.points` is now only the device's display switch for the receipt's +N (the Settings checkbox moved into the Points view as "Show +points in receipts", and taking part turns it on once). This closes the review's P1 (one global switch gave points to people who never chose). **Every contribution kind earns**: answers yes/no 2, not sure / later / dismiss 0 (recorded, never penalised), outcome report 3, an observation recorded for one's own investigation 3 (kind `correction`), authored evidence that became a claim 2, once per evidence record, at import (`ImportResponse.points` names who earned). Undo revokes. **Summaries are neutral** ("Answered a question (yes)", "Reported an outcome (recovered)", "Shared evidence that became knowledge") with the question / investigation / evidence id as `refId`; question and report text never enter the points rows (P2). **Own balance only**: `GET /participation/:id` requires the caller (`?principalId=`, else the settings' current person) to be that person; a person who does not take part gets `{points: 0, events: []}`; opting out keeps the rows and hides them, opting back in shows them again, and the view says so (P3). **Rating** `GET /participation/rating`: only people who take part, sorted by all-time balance (ties share a rank), last-7-day points, answers, outcome reports, totals, `me` (balance, rank, last 10 events) for the caller; `kt_participation` gives agents the same rows and totals without anyone's events (P4). **Panel**: Settings → "Points & rating" (and "See your points" on a rewarded receipt) opens a view in the v008 type scale: the toggle "I take part in points", one sentence that points never judge correctness and that opting out hides but keeps, then the balance large, rank of N, last 5 events and the top-10 participants with the current person marked. The +N burst needs both: the person takes part and the display switch is on. **Stream**: simulated people take part by default (`--no-points` off), opted in as they appear in the directory (which is now applied before a family's evidence, so authored evidence earns), the judge's person is never opted in by the stream, awards are `points` rows labelled simulated. 32 routes, 9 MCP tools. **Reverse:** the opt-in default stays no, so without a PUT nothing changes; `--no-points` for the stream; the Settings row and the receipt link are two template lines.


## R47 · DECISION — The demo stream shows points awards only while you take part (Artem, 7 Nov)

The simulated people's "+N to …" rows and the opt-in notice are held back until the judge's own person has switched on "I take part in points"; the awards still happen on the service. When the judge opts in, one row says so and how many earlier awards were not shown. Also from Artem: the points note is a small "i" shown on hover/focus instead of a paragraph, and the "N in the last 7 days" figure is gone from the balance line. **Reverse:** `judgeParticipates` gate in `simulation/runner.ts`; the note/meta lines in `panel.ts`.

## R48 · DECISION — Several similar cases are shown; a near miss asks the requester, not a colleague (Artem, 7 Nov)

Artem noticed that an ambiguous problem got one straight answer and no alternatives. The result view now adds "Also similar" under the timeline when other cases score within 0.1 of the basis (up to three, each with what sets it apart: a conflicting condition, the condition it would need, or what matches; clicking opens that case). When nothing clears the threshold but cases are close, the view says "Closest cases, not close enough yet", lists them, and asks the requester for the deciding detail ("which equipment, what changed last") with an "Add details" button back to the input; no colleague is asked and no model is called. The engine's data was already there (`ResultView.matches`); only the panel changed. **Reverse:** the `rf-alts` block in `panel.ts` renderResult.
