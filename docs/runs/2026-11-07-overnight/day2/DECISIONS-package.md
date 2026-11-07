# Decisions · Day 2 B6 (package: the three demo-mode flags)

Branch `day2/b6-flags`, from `run/2026-11-07-overnight` at `ced868d` (B1–B5, B7, points R46 and demo mode R37–R42 merged:
604 tests, 42 routes, 12 MCP tools). After this branch: 615 tests (11 new), routes and MCP tools unchanged.
Each entry: what was decided, why, and how to reverse it.

## D-B6-01 · Demo mode is one desktop flag, `KT_DEMO`, and `pnpm demo:judge` is what turns it on

There was no demo-mode switch before: demo mode meant "launched by `demo:judge`" (which already sets `KT_NO_API=1`). The
three flags hang off one new entry in the existing desktop flag set (`src/apps/desktop/flags.ts`: `FLAG_NAMES`,
`DEFAULT_FLAGS.demo = false`, `COLUMN_FLAGS.demo = false`, env `KT_DEMO`, query `demo=1`), so it travels like every other
flag: main reads the env, the renderer gets it as a query param, the companion and the panel read `window.__ktFlags`.
`scripts/demo-judge.mjs` sets `KT_DEMO=1` in the desktop's env unless the operator set `KT_DEMO` already
(`KT_DEMO=0 pnpm demo:judge` keeps the product behaviour). It is not forced off in the column fallback (the chips work
there; the away behaviour is off in the column anyway). The service does not know about it: none of the three needs it
(the chips write Settings → You through the existing route; the label lives on a page the service already serves).
The renderer's `?mock=1` dev mode passes the flag to the mock (D-B6-02). **Reverse:** drop `'demo'` from `FLAG_NAMES`
and the `KT_DEMO` line in `demo-judge.mjs`; every flag-gated path falls back to the product default.

## D-B6-02 · "Be Veikko / Be Erkki" chips write Settings → You, through the same path as the select

In demo mode the panel prepends a chip row (`.rf-demo-chips`, "Demo · Be Veikko · Be Erkki") to the footer; without
the flag the footer markup and the `TEMPLATE` are untouched (the row is created in code, not in the template). A chip
calls `switchPerson(id)`, the function the Settings → You change handler now also uses (PUT /settings
`currentPersonEntityId`, clear the question cache and the open nodes, forget the points view, refresh /questions).
Because `principal()` is built from `settings.currentPersonEntityId`, the chip state is what `/investigate` receives as
principal and whose `/questions?personEntityId` the queue shows, with nothing else changed. I chose the persisted setting
over a panel-local principal because (a) Settings → You stays the one real mechanism (DAY2_PLAN 6.1) and the chips are a
shortcut to it, so the chip and the select can never disagree; (b) the simulated stream reads Settings → You every tick
to know whom never to auto-answer (R40), which a panel-local principal would break.
The people are resolved from the directory by `demoChips()` (`ui/demo-chips.ts`, pure): exact name with accents
ignored, else a unique first name; a persona not in the directory gets no chip, and with neither the row stays hidden
(a clean clone without Elisa's files). The active chip has `aria-pressed="true"` (dark). The row adds a second footer
line, so in demo mode the surface grid's footer row is `auto` instead of 48 px and the card re-fits when the row
appears (checked in a browser on the `?mock=1&demo=1` page: chips, tools and Remember this all visible; without
`demo` the footer is 48 px with no chip row). The dev mock grows the two people only when created with `{demo: true}`,
and a Veikko investigation that may ask opens the revision question for Erkki, so the mock shows the ask-as-one,
answer-as-the-other loop; mock answers by anyone but the dev user earn no points. **Reverse:** remove the
`demoMode` block in `panel.ts` (and the CSS block marked B6); `switchPerson` can stay.

## D-B6-03 · Lumi starts in and leaves after 120 s without pointer or keyboard activity; one constant

`COMPANION.DEMO_LEAVE_AFTER_IDLE_MS = 120000` sits with every other companion timing. `leaveDelays(flags)` (pure)
returns `{launchMs: 4000, idleMs: 20000}` normally and 120 s for both in demo mode; the ten call sites inside
`createCompanion` that read `COMPANION.LEAVE_AFTER_IDLE_MS` / `LEAVE_AFTER_LAUNCH_MS` now read those delays (the constants
and their tests are unchanged, and so is every non-demo timing: all 47 earlier companion tests pass untouched).
"Start in" is the existing launch: he lands at home in state `in`; demo mode only stretches the launch leave from 4 s to
120 s. I read "expanded" as "in, visible at home", not "panel open": an open panel blocks the idle leave by design
(R33), so opening it would keep him in forever, and it would put a card over the judge's screen before anyone asked.
Activity: in demo mode any pointer move inside the window (the window covers the work area, so this is any mouse
movement the window sees) and any key press (`keydown` in `attachCompanion`, `Companion.activity()`) record the time;
when the idle timer fires, `idleLeftMs(lastActivityAt, now, idleMs)` (pure) says how much is still left and the timer
re-arms for that instead of leaving. This avoids restarting a timer on every mousemove. A pointer leaving the window is
not activity. Outside demo mode `activity()` is a no-op and `lastActivityAt` stays `-Infinity`, so the timer leaves when
it fires, as before. After the first leave he behaves as the product does (away is home, peek, perch). **Reverse:**
`KT_DEMO=0`, or set the constant to 20000.

## D-B6-04 · The simulated day is labelled on the second screen only; the panel shows real-time state

The activity page (`/demo/activity.html`, the second screen `demo:judge` opens) gets a sticky dark banner at the top:
**Simulated day** (`SIMULATED_DAY_LABEL`, exported from `activity-page.ts`), the simulated clock read from
`GET /demo/clock` every 2 s (`simulated 09:40 · 360× speed`, or `not running · real clock 14:02` before the day
begins and after it ends), and "not real people, not real time · the companion shows real time only". It stays visible
while the rows scroll. The companion was already free of the stream (R41: the panel was never edited for it); a test now
pins that: the panel `TEMPLATE` has neither the label nor the word "simulated", and no companion source (`panel.ts`,
`api-client.ts`, the desktop renderer and its page) contains the label or reads `/demo/activity` or `/demo/clock`.
One known exception, left as is: the Settings row "Erkki's cost" (B3 `costRow`) appends " simulated" to its seconds when
the service measured them on the simulated clock; that is a unit label on a real store number, not the stream.
The stream's questions to the judge's own person still reach the companion like any question, since they are real
records in the store (R40). **Reverse:** remove the `.sim` banner; the old header and meta line remain.

## Package docs (SUBMISSION.md, slides)


## D-B6-20 · SUBMISSION.md is the one door; it links and does not duplicate

`docs/SUBMISSION.md` carries the script only as a seven-row table plus the two signature moments, and links DEMO.md for the click-by-click text, RESULTS.md and E08-E10.md for full tables, the service README for routes. Reason: one page for a judge with three hours; a second copy of the script would drift from DEMO.md. Reverse: inline DEMO.md's script.

## D-B6-21 · What is called synthetic

Called synthetic: the 10 scenario families in `data/scenarios/` (TRN-117 / `optic-forwarding-a`, RBS-310 / `remote-power-access` included), `data/demo/followups/` (Erkki's 14 Oct firmware note, Eino's 6 Oct code 7731, two problems), `data/demo/followups-synthetic/` (Helmi's TRN-117 firmware note), `data/demo/experts-disagree/` (Helmi's TRN-512 2021-batch thread), the simulated day (`demo:play`) and every simulated answer in E03–E10 (an oracle reading an agent-authored key). Called Elisa's: `teams_chat.json`, `email.txt` and the organizer deck, held only in git-ignored `private/`. The slides say "synthetic" on the slide or in the notes wherever a synthetic source carries the point (slides 5, 7, 8, 11). Reason: the follow-ups README and E08-E10.md already say so; Elisa's example has no dates, so every dated story is ours.

## D-B6-22 · Numbers left as "not measured"

Real engineers' benefit, real seconds spent by a real Erkki, a live Slack round trip against a real workspace, and a clean-clone run of `pnpm demo:judge` on this branch: no file records them, so SUBMISSION.md §4 says "not measured". Erkki's cost on screen is a live count from the demo store, not a measured number, so no value is quoted. Questions per point gained is quoted as "undefined" (E10: 0 points gained for 9 questions per selector), not as a number.

## D-B6-23 · "The hash of the locked run" on slide 11

Slide 11 quotes the sha256 prefixes of the two hash-locked test families in `data/scenarios/TEST_LOCK.json` (transponder-laser 9f202253…, rooftop-threshold 73e145d0…), the lock E00 checks on every run. The E08–E10 results are additionally pinned by their committed results and manifests: E08 re-run at 0bc1ca6 (fixtureSha256 f9c12a9c4330cd09), E09 at d5a1c32 (outputs hash-locked, D-B2-61), E10 at 11ee275 (familiesSha256 885928361d0f3da7). These are kept here, not on the slide, to stay within five lines. Reverse: put the commit ids on the slide instead.

## D-B6-24 · The plan's slide text updated to what is true now

DAY2_PLAN's slide list says "8 MCP tools" and "Snowbally"; the slides say 12 MCP tools (D-INT-15) and Lumi (R43). Slide 7 uses DEMO.md's measured stops (09:14–09:18 nothing, 09:19 check first, 09:25 qualified) rather than the plan's "before 09:16". The "Be Veikko / Be Erkki" chips are not described: the script on this branch uses Settings → You, and the chips are another branch's work.

## D-B6-25 · index.html is generated from SLIDES.md

`docs/slides/index.html` was generated from `SLIDES.md` by a small script (kept outside the repository), so the text is identical: titles, bullets, the "show:" line, speaker notes (hidden; N toggles). One file, no external fonts or scripts, light background, 1600×900 stage scaled to the window, ← → / Home / End / click, F for full screen, print to PDF gives one slide per page. Checked in a browser: on all 12 slides the bullet list ends above the "show:" line (lowest: slide 1 at 713 px of 758). After any edit to SLIDES.md, regenerate or edit both.

## D-B6-26 · Verification

`pnpm typecheck` clean and `pnpm test` 604/604 (0 skipped, Elisa files present in this checkout) on ced868d before the commits; `node --test experiments/*.test.ts` 23/23. The commits touch only docs/SUBMISSION.md, docs/slides/ and this file.

## Final round (clean clone, store metric, package corrections)

## D-B6-27 · A generated older-units stand-in makes the agent path work on a clean clone

Finding (clean-clone test at 652e2a4): without `private/`, `pnpm demo:agent` matched only TRN-117, whose recommendation was "You already did the SFP replacement; TRN-117 has no other reported fix." with one gap that decides nothing, so the script stopped at "No open gap needs a person" and the documented 03:00 → 07:30 story did not happen. The Be Veikko chip was also missing (Veikko is Elisa's). Fix: `data/demo/older-units-synthetic/` holds a generated thread (Ville Ranta, Field Engineer; Pekka Laine, Network Expert; TRN-233: older units, disable and re-enable the interface; the wording is the inline stand-in `tests/experts-disagree.test.ts` already used), Pekka's dated 14 Oct firmware 4.2 note (files numbered so the thread is committed before the note bounds it) and a people.json. `resetDemo` imports it only on the default seed when Elisa's thread was not imported (`EngineOptions.olderUnitsSyntheticDir`). Not on seed `synthetic`: E08–E10 and their hash-locked numbers are built on that seed and stay unchanged (experiment harness 23/23). With Elisa's files present nothing changes.
`scripts/mcp-demo.ts`: when the preferred person (Erkki) has no case of his own, he is taken from the gap's `whoCouldAnswer` (he answers "older unit" through his role; he is in every directory through his firmware note in data/demo/followups), and the person asked is named from that list too (the clone run printed an entity id before). `demoChips`: a part (field, expert) whose Elisa persona is absent falls back to the stand-in's person, so a clean clone shows **Be Ville / Be Erkki** (Pekka only when Erkki is absent). Tests: `tests/clean-clone-agent.test.ts` (no Elisa dir: gap decides applicability, Erkki askable, queued at 03:00, answered after 07:00, applicability applicable, chips), `demo-chips.test.ts` (fallback), and the two clean-clone tests updated per seed: default seed now reuses TRN-233's reset for TRN-088 and Pekka's note bounds the 4.2 problem; seed `synthetic` keeps the old TRN-117 / Helmi texts. DEMO.md carries the clean-clone notes.
Why not a synthetic TRN-042 thread with Veikko and Erkki: D-B1-34 rejected a lookalike of Elisa's private thread; this one uses invented names and node ids and our own wording. Why not only a warning: the judge path would still show nothing on a clone. Reverse: delete the directory and the `olderUnits` import in demo.ts; restore the two tests' single expectations.

## D-B6-28 · Clean-clone verification (supersedes the "not measured" of D-B6-22 for the clone)

Clone of the run branch at db4cfa9 into the scratchpad, no `private/`: `pnpm install --offline` from the local store; `pnpm demo:reset` gives 6 cases, 88 claims, 22 people (the stand-in included); `pnpm demo:agent -- --simulate-tap` (no service on the port) runs kt_investigate (qualified, TRN-233, older-unit gap) → kt_list_gaps → prefers Erkki from whoCouldAnswer → queued until 07:00 → MCP server restarted at 07:30 → answered → kt_get_context "Consider disabling and re-enabling the interface; it reportedly restored traffic in TRN-233." (reuse); `pnpm typecheck` clean and `pnpm test` 617 tests, 612 pass, 0 fail, 5 skipped (the Elisa-only ones). A service on the clone's database answered /health, /context.html?entity=TRN-233 (200), GET /context?entity=TRN-233 (13 assertions), /directory (Erkki Expert, Pekka Laine, Ville Ranta) and GET /costs ("Store: 6 cases · completeness 0.47 · correctness 0.01 · 2 singletons left"); it was stopped afterwards. The earlier clean-clone run on 652e2a4 launched `pnpm demo:judge` end to end (Electron 45.2.3, activity page, stream). Not re-run after the stand-in: the Electron UI clicks (chips, panel); the change touches only the reset's data, the chips' pure resolver and the agent script. In the main checkout (Elisa files present): typecheck clean, `pnpm test` 618/618, experiment harness 23/23 at 3e94521. SUBMISSION §4 and slide 11 now quote 618/618. Two environment notes from the clone run, no code change: `pnpm install` printed "Downloading Electron binary..." (Electron's postinstall fetches or verifies its binary; a judge machine needs the network once, now said in SUBMISSION §7), and the desktop's "launched with nice 5; could not reset to 0 (EACCES)" is the test harness's niced shell: an unprivileged process cannot lower its nice value, and the warning is the designed message (flags.ts restoreDefaultPriority).

## D-B6-29 · §5.2 "links made without an answer" is counted through the engine

`Engine.storeHealth` now passes a `links` hook: the system's case-to-case links are B1's pairing Patterns; confirmed ones are `made`, confirmed ones without an `answerId` are `withoutAnswer` and subtract from correctness. The coordinator writes a pairing only with the answer that decided it, so the term is 0 on every store today; it is counted, not assumed, and a link written by any other path without an answer would show. Test: `tests/store-health.test.ts` (a confirmed link with its answer costs nothing; one without lowers correctness by one claim over caseClaims). E10 is unaffected (its store has no confirmed pairing). Reverse: drop `links` from the engine's options.

## D-B6-30 · §5.3 value / cost ranking is documented as a limit, not implemented tonight

The brief's "questions are ranked by value / cost; investigation gaps rank first; standing gaps fill the remaining budget" is realised as: only consequential gaps are asked (decides applicability or support), investigation gaps before standing gaps (tested in questions/standing.test.ts), standing kinds in a fixed order (outcome, pairing, missing symptom; engine.askStanding), recipients by firsthand knowledge, the selector (rules default, LinUCB opt-in) choosing among candidates, and burden (BURDEN in coordinator.ts) subtracted in the learning reward. There is no explicit expected-gain ÷ burden score. Not built tonight: it would reorder questions in every demo text the judge sees, and E10 shows no measurable gain to rank by (0 points in one day). Named in SUBMISSION §6. Reverse: add the score in the coordinator's candidate order, with a test.

## D-B6-31 · Model claims on Elisa's material stay unverified and are labelled so

The B2 done-lines "embed=local finds TRN-042 with the paraphrase", "extract=local imports the Elisa thread" and "phrase=local asks Erkki naturally" need Ollama running with bge-m3, qwen3:4b and qwen3:8b and the private files; this round runs offline with every slot on rules (no Ollama), so no new recording was made. What is shown: the paraphrase on synthetic TRN-117 from recorded bge-m3 vectors (E08), extraction on synthetic families from recorded qwen3:4b outputs (E09), and the phrase validator rejecting a planted hallucination with fake providers. Slide 11 now names TRN-117 as the paraphrase target; SUBMISSION §6 says no run ranks TRN-042 with embed=local and no qwen output on Elisa's thread or Erkki's question is recorded. To close it: run once with Ollama on the elisa seed, save the phrase output under data/replays/, note TRN-042's rank in E08-E10.md (no Elisa text committed).

## D-B6-32 · SUBMISSION and slides corrected to the merged state

SUBMISSION §1: the script uses the Be Veikko / Be Erkki chips (Settings → You does the same; this supersedes the chips sentence of D-B6-24, written before the flags branch was merged); signature moment 2 uses DEMO.md's measured stops ("09:14–09:18 the agent is told nothing") and names the clean-clone entities (TRN-233, TRN-117); signature moment 1 says what the agent path shows on a clone. §3 lists `data/demo/older-units-synthetic/`. §4: 618/618 and the clean-clone row (D-B6-28); the remaining "not measured" row keeps real engineers, real Erkki seconds and the live Slack round trip (D2, dropped by the brief's order; no sandbox workspace was named). §6: the §5.3 and model limits (D-B6-30, D-B6-31). Slide 11: 618/618; E08 paraphrase names TRN-117; E10 gives "5 cases × 3 seeds" and correctness as 3/180 → 3/180 instead of 0.0167 (the same number with its denominator, short enough to keep the five bullets above the "show:" line: lowest bullet bottom 715 px of 758, checked in a browser); slide 5's note names TRN-233 for a clone. Both SLIDES.md and index.html carry the same text (D-B6-25).

## D-B6-33 · Round 5 outcome: metric, local recordings, service guard, and the review fixes

Round 5 merged three lanes into the run branch (489653c): r5-metric (an applicability answer scopes the case and is not a contradiction, D-B2-66; questions ranked by value / cost, D-B2-67; both scores on the reward record, D-B2-68), r5-local (the three local done-lines recorded once against Ollama on Elisa's data) and r5-guard (the service installs the network guard at startup, D-INT-20; provenance on /investigate was an unmatched text, not a defect, D-INT-21). The adversarial review of 489653c (typecheck clean, 634/634) raised 2 major and 8 minor findings; each was checked against the code:
- Fixed (D-B2-74..78, commit 576ca6b plus the RTR-203 pin): duplicate decision ids D-B2-66..68 (local entries renumbered D-B2-70..73, `tests/decision-ids.test.ts`); "the bandit's fixed prior" (docs now say LinUCB has a ridge prior only and its vector leaves out the value features; test); the +1 retrieval weight described as ranking investigation gaps above standing ones (docs: the ranking is within one state, the order across origins comes from flow); expected gain of an outcome question was the Yes branch (now weighted by P_CONFIRM 0.5, No branch 0; RTR-203 gain 0.0226 → 0.0113, pick unchanged); "links made without an answer" never supplied outside the engine (storeHealth counts pairing Patterns itself; test); "asked today" by UTC day (now the quiet hours' local day; test); E10 not hash-locked (lock.json, resultsSha256 9248c6506f594c97, `tests/e10-lock.test.ts`); "No = explicit not applicable" overstated (D-B2-75 wording, test renamed); SUBMISSION and slides stale (D-B6-34).
- Fixed as well, found by the local lane: the fractional-timeout crash of the phrase slot's second pass (D-B2-77).
- Not changed, disclosed: the correctness denominator stays all live case claims (D-B2-29's reading; changing it changes every E10 number); the standing states' fixed kind order in `engine.askStanding` stays (value / cost ranks within one state); the RTR-203 pick in the simulated stream is the intended effect of D-B2-67. An untracked capture plan outside the judge package expects the software-version question on a case with a performed fix and no outcome; under D-B2-67 such a case asks the outcome first. That plan is not in the repository and was not touched.
E10 re-run after the fixes (offline, rules only): every number the same as at 99a4701; only notes and timestamps changed. Tests 641/641, experiment harness 24/24, E00 17/17, typecheck clean. The 3-minute script and the 03:00 sequence ask the same questions and give the same recommendations (tests/e2e.test.ts, tests/clean-clone-agent.test.ts and the demo tests pass unedited). Nothing pushed. Reverse: revert the round-6 commits.

## D-B6-34 · SUBMISSION and slide 11 updated to round 5 (supersedes D-B6-30 and D-B6-31)

SUBMISSION §4: 641/641 and 24/24; E10 split into the store row (5 cases × 3 seeds, 3/180 → 3/180, product 0.0075 → 0.0075, cases 5 → 17), the per-answer row (product deltas 0 on 5/5 and 6/6, was −6.77 / −13.54; completeness +12.49 on 3/5 and +16.66 on 4/6; mean reward −0.008 / −0.0033), questions per completeness point (0.72 / 0.54), the bandit row with the hash lock, one value / cost row (RTR-117 Yes +2.25 points, No 0; RTR-203 gains 0.0113 vs 0.0017) and the live local-model row. §5: "on by default, no model" lists the service network guard, the §5.3 ranking and the measured reward; the three local done-lines with met / met / not met. §6: "Question ranking is not value / cost" (D-B6-30) is replaced by what is still true (within one state only, standing kinds in a fixed order, P_CONFIRM 0.5, LinUCB does not start from it, one pick changed in the stream); "Models are measured on stand-ins" (D-B6-31) is replaced by "one run each, not scored"; the D-B2-51 sentence is replaced by the product hiding the completeness gain, the denominator reading and the "No" approximation. Slide 11 (SLIDES.md and index.html, identical text, checked by script): 641/641; hash locks for the test split and E10; E08 and E09 unchanged; one line for the live Ollama runs; E10 with the completeness deltas and their answer counts; the weak line. Six bullets fit above the "show:" line: in a browser at 1440 × 900 the last bullet ends at 725 px and the "show:" line at 788 px of 810; at 1280 × 720, 644 and 700 of 720. Reverse: the previous text is in git.
