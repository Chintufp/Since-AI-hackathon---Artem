# service-ui worker report, phase 2

## Built
1. **Identity.** Settings has a "You" row: a `<select>` of `GET /directory` (`name · role`), stored with `PUT /settings {currentPersonEntityId}`. The principal for every call is the chosen directory entry (id, name, directory groups, human); with nobody chosen it is the labeled guest `{id:'person:desktop:guest', displayName:'Guest', groups:[]}` (investigating works, queue says "Choose who you are in Settings to see your questions."). Demo reset takes optional `{defaultPerson}` (id or name), else the first available person with role /field/i, else the first entry, stores it as `currentPersonEntityId` and returns `defaultPersonEntityId` (cleared for an empty directory). `main.ts --seed` uses the same rule. Documented in `src/apps/service/README.md`.
2. **Result view.** No question: a quiet 12px grey `loopReason` line; with a question the "Asked a colleague ... status" row as before. At most 3 caveats, each its own line. The enum word `applicability` ("qualified") is no longer printed raw. Long engine text can no longer push the panel out of the window: the result head and matched case scroll (caps `min(190px, 100vh-470px)` / `min(260px, ...)`). Fixed a double padding gap under expanded timeline nodes. Internal `Evidence: ev_...` ids are stripped from the "Why this question?" text in the UI.
3. **Queue badge.** Counts only the current person's questions (`GET /questions?personEntityId=`), refreshes on panel open and after answering, polls every 20 s only while the panel is open (timer created on open, cleared on close; none while collapsed). The old 30 s always-on poll is gone.
4. **Real-service harness.** `node scripts/real-check.mjs` builds, spawns its own service (`--port 47951 --db :memory: --seed elisa`, override `KT_REAL_PORT`), waits for /health, runs Electron `shots.cjs` with `KT_SHOTS_REAL`, kills the service. `shots.ts` real mode: no mock, CORS shim for that url, the (a)-(j) sequence at 420 px, PNGs plus `checks-real.json` in `screenshots/real/`. The mock harness still works (`node scripts/screenshot.mjs`: 41 screenshots, 0 console errors).
5. **Tests.** `tests/identity.test.ts` (4 tests): default-person rule, `GET /directory` shape, demo reset sets and returns the person (named / default / empty clears), guest can investigate but gets 403 on answer/defer/dismiss/undo, non-recipient 403, recipient answers. Full suite: `pnpm typecheck` clean, `pnpm test` 187 pass / 0 fail on the final run (one earlier mid-run attempt showed 9 failures while other workers were editing their modules; the immediate rerun was green, so I attribute it to concurrent edits, not to my paths).

## What the real-service run showed (final run, 0 console errors, hitbox identical 64x64 in all states)
- Start: reset put "You" on Aarne Koskela (first available Field Engineer). (b) chose Veikko Vikkelä.
- (c) First problem (`inv_ac44f4f4a11fe66c6554`): "Check the traffic counters ...", 10 people, matched case "TRN-117 · no traffic after SFP change", the Possible cause node expands. No question was routed (correct per R15: the requester can see the counters). The result shows no loopReason line because the engine did not yet send one (see below).
- (e)/(f) People list renders; "Prepare message" for Erkki Expert produced a draft.
- (g) **The brief's text ("TRN-301 ... Not sure which unit generation this is.") never routes a question** on the Elisa data: loop `exhausted`, no `loopReason` (`unit.age` / `unit.installed_year` are requester-observable, and the lasting-effect gap has no recipient). The harness therefore tries that text first, records it in `checks.secondProblemAttempts`, then falls back to "RBS-310 is flapping again with DC low alarms after the rectifier work", which asked "Did the problem clear right after the sfp replace in ...?" (`inv_25f5c7b0be96d7c72045`, question `q_1f32e2b70867c5a5265a`), recipient Ilmari Karjalainen (Field Engineer).
- (h) As Ilmari the badge showed 1; queue, question, context, No -> receipt "Recorded: No" -> Undo -> Yes -> receipt "Recorded: Yes"; service status `answered`.
- (i) Back as Veikko, same text gave the same investigation id; the recommendation changed to "Confirm older unit (installed 2016) before replacing the SFP." and a *new* follow-up question was opened to someone (row "Asked a colleague ... delivered").

## Engine output I judged poor (for the orchestrator; I did not edit those modules)
- Literal `undefined` inside generated text: "restored traffic in undefined (older unit)" (first run), "undefined gives weak support", "undefined has weak support and qualified applicability", "No recovery outcome is recorded after the SFP replacement in undefined", "Replacing the SFP reportedly helped in undefined". A case label is missing in the recommendation, matches and question-why templates.
- `loopReason` was absent for the `exhausted` loop in every run I made (and `question-open`): the field exists in the contract but is not filled yet by the investigation module, so the new quiet line never showed.
- Contact draft subject is cut mid-word at about 70 characters ("Question: At site now. Replaced the SFP on TRN-088, an older unit from 2018. Lin").
- Contact draft body repeats the full raw user text, lists "Installed year" as a seen condition although no year value is given, and a long "Still unresolved" paragraph.
- Receipt detail leaks an internal enum: `The recommendation is now "retain-uncertainty".` / `"qualified"`.
- People list: 10 people for a simple SFP problem; the top ones (Hanna Mäkelä, Olli Rautio) were matched through the unrelated BGP case RTR-117; Eino Salo (Site Access Coordinator, unavailable in the directory) is listed for an SFP problem. Reasons in the live data are still the generic "Firsthand: advised a response in ..." sentence.
- The Elisa-style SFP problem with the age unknown gives `exhausted` instead of a "check the unit age first" next step surfaced as the loopReason.
- A question about RBS-310 produced a recommendation that cites TRN-042/TRN-117 (SFP cases) and a question "Was RBS-310 installed in 2019?" with `RBS-310 installed 2016` already in the case: the engine asks for a fact that the matched case contradicts.

## Not done / limits
- Polling and badge behavior verified by reading code and by the real run (badge 1 after switching person), not by a timing test; no DOM unit tests (no jsdom in the project).
- Contract change request: `contract-requests/service-ui-2.md` (demo reset fields).

## Fix pass

Fixed:
- loopReason: buildResultView now returns `loopReason` (from state.loopReason); mock-api returns one (and no question) when the text contains "no one to ask"; test in tests/identity.test.ts asserts it.
- Receipt: raw recommendation kind replaced by plain prose per kind (engine.ts RECOMMENDATION_PROSE); test asserts no enum leaks.
- Settings "Server" row shows api.baseUrl (the live endpoint).
- Contact-draft subject cut at a word boundary (70 chars) with an ellipsis.
- Timeline node details keep line breaks (white-space:pre-line).
- Real harness: new state 06-result-last-node expands and scrolls to the final node (shows "Outcome unknown", grey). A green "Reported" node is not shown: the Elisa RBS-310 / TRN-088 cases have no reported outcome; a reported-outcome case was not exercised.

Not fixed (engine, not my paths; for the orchestrator): the investigation/memory output on the Elisa RBS-310 data still talks about an "SFP replacement" and "weak support" for a rectifier-module problem, the recorded recovery is called missing, and a follow-up question with empty template slots was reported after the answer. The question template should refuse to emit text with empty slots, and a test on Elisa data should check that question and recommendation text only mention components in the sources.

Verification: pnpm typecheck clean; pnpm test 196 pass, 0 fail; node scripts/real-check.mjs 18 PNGs, console errors 0; node scripts/screenshot.mjs re-run (see below).
