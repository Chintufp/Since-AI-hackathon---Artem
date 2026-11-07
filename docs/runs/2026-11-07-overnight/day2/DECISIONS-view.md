# Decisions · B3 · View: the Context Layer page, provenance strip, Erkki's cost

Made by the B3 implementer on branch `day2/b3` (7 November 2026, from the run branch at 67dcb3f with B1 and B2 merged).
Each entry: what, why, how to reverse. Folded into the main DECISIONS at integration.

## D-B3-01 · `preview: true` on POST /investigate persists nothing

`InvestigateRequest.preview` (additive). The engine runs the same `investigate()` with `persist: false` (new optional
`InvestigateInput.persist`, default true): no investigation record, no `investigation.started` trace event (the event is
built in memory and not mirrored), no question loop (the coordinator is not called and no question generator is passed,
so the phrase model is never called either), and no quiet-hours delivery pass. The problem id includes the marker
`preview`, so a preview never reads or overwrites a stored investigation with the same text. The result is the ordinary
`ResultView` built through the requester's evidence gate.
Why: the Context Layer slider calls POST /investigate on every stop; each call would otherwise store an investigation
and an event, grow the store and count as a reuse of Erkki's knowledge (D-B3-07).
Reverse: drop `preview` from the schema and the branch at the top of `Engine.investigate`.

## D-B3-02 · `atEvidence`: an evidence cutoff inside an undated thread

`InvestigateRequest.atEvidence`, `Problem.atEvidence` and `RetrievalQuery.atEvidence` (additive) carry an evidence id.
`retrieval/access.ts gateAt(store, base, atMs, atEvidence?)` then shows undated evidence (time-only, date-only, unknown)
only when it belongs to the cutoff's thread (`thread.threadId`) and comes at or before it in thread order
(`eventTime.sequence`, then `thread.position`); undated evidence of every other thread is hidden. Dated evidence follows
`at` exactly as B1 built it (visible when at or before `at`). (Changed in review, D-B3-12: with a cutoff, every other
thread is hidden, dated or not; without `at` the moment is just before the earliest visible dated source; an id the
requester may not see is a 400 like an unknown one.) Without `at` the engine uses now as `at`; an unknown
evidence id is a 400. The cutoff is part of the problem id, and like `at` it never asks anyone. It is passed through
`buildCorpus`, `HybridRetriever.search`, `loadCaseFacts` (assessor) and the investigation's own gate.
Why: the Elisa TRN-042 thread has clock times and no date. B1's `at` keeps every undated item visible at every moment,
so "before 09:16 the agent is told nothing; after 09:22 check the counters, then bounce the interface" could not be
shown without inventing a date. Measured on the Elisa store with the problem "TRN-042 on firmware 4.2: replaced the
SFP, link up, counters zero, no traffic.": 09:14-09:18 `none`; 09:19-09:22 `check-first` "Check the traffic counters
first."; 09:25 on `qualified` (bounce the interface, reported once); after 14 Oct `qualified` with the caveat
"Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2".
Hiding other undated threads is deliberate: a time-only thread cannot be ordered against another undated thread, so
"what was known at 09:16 of this thread" cannot honestly include them. The page sends `at` = 1 ms before the earliest
dated item on the axis together with the cutoff (D-B3-04).
Reverse: drop the parameter from `gateAt` and its four callers.

## D-B3-03 · The time axis is one pure function the page embeds as source text

`context/time-axis.ts layoutTimeAxis(items, {x0, x1})` lays out the axis and the slider stops. It is written with no
imports and no outer references so `/context.html` can embed `layoutTimeAxis.toString()` (the service runs under Node's
type stripping, so the text is plain JavaScript); a test evaluates that text and compares it with the module. One
implementation, unit-tested, no build step for the page.
Reverse: inline a JavaScript copy in context-page.ts (and lose the test on what the browser runs).

## D-B3-04 · Axis order: undated threads, calendar, '?' gutter; what each stop sends

Segments left to right: one "same day, date unknown" segment per undated thread (clock minutes, then sequence; ticks
are the raw clock text; changed in review to thread order, D-B3-13), the calendar for known instants (UTC short dates, as B1's `shortDate`), then a '?' gutter for
items with no usable time (unknown, and date-only, whose raw text is not trusted onto a calendar). Undated threads come
first because B1's validity rule treats an undated source as valid from before any dated moment; the gutter comes last
because nothing places it in time. Stops: one per evidence item on a clock segment (`atEvidence` = that evidence,
`at` = 1 ms before the earliest dated item on the axis, so no dated item counts), one per distinct dated moment
(`at` = that instant), and `now` (no `at`). The visible set per stop mirrors `gateAt`: at a calendar stop every undated
item counts (B1), even though the gutter is drawn to the right of the line; the page says so in the gutter's label.
Reverse: `layoutTimeAxis` (the order of `parts`) and the stop builder.

## D-B3-05 · Provenance strip: which claim, which words

`service/provenance-strip.ts` builds `ProvenanceView` (additive on `ResultView`, `QuestionView`, `CaseView`; `text` is
the one line the panel shows). Which claim a heading rests on: the result uses the recommendation's basis references
(after the requester's gate, and as of the investigation's `at`/`atEvidence`); among visible claims supported by them
it takes access-fact, then advice, hypothesis, outcome ... and, within a type, the latest in the thread. The question
card uses the question's `targetClaimId`, else its investigation's basis. The case title uses the advice behind the
case's corrective attempt (a recovered one first), else the case's latest advice. Words: the asserter (directory name of
`assertedBy`, else the author of the visible message), the provider label (Teams, E-mail, Slack ...) plus
`describeTime` for undated sources ("09:22 (date unknown)") and B1's short date ("14 Oct") for dated ones, "reported
once" when exactly one independent visible source supports it (`independentSources`, visible references only), then the
status: "still believed true"; "superseded 6 Oct by Eino Salo" (newer value visible and valid at the moment); for a
claim bounded by a note (B1 D-B1-07, not superseded) "still believed true for software.version < 4.2 (bounded 14 Oct by
Erkki Expert)", because the advice still holds below 4.2 and saying "superseded" for a unit of unknown version would
mislead; "contradicted"; and the route only when a model proposed the claim ("local model qwen3:4b, committed by
rules"). Measured on the Elisa store: "Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true"
before 14 Oct, the bounded form after it, "Eino Salo · E-mail 6 Oct · reported once · still believed true" for the
barrier code.
Access: nothing is read except through the viewer's gate (scope plus at least one visible supporting reference); a
superseding or bounding claim is named only when visible and valid at the moment; with no visible basis there is no
strip. Test: views.test.ts (the member's strip rests on the private advice claim; the outsider's never does, has no
more sources, and with only private basis references there is none).
Panel: `<p class="rf-provenance">` between `.rf-result-title` and the notes, under the question's heading and under the
case view's title, textContent only, one line with ellipsis (the full line is the tooltip). Not repeated under the
matched case's title inside the result view (it would say the same thing twice in a height-capped block). The mock's
POST /investigate carries a strip so the mock screenshots show it.
Reverse: drop the three optional fields and `provenance-strip.ts`; the panel hides an absent strip.

## D-B3-06 · The Context Layer page: what it reads, how it draws, who it views as

`GET /context.html` (`context-page.ts`, an `HtmlResponse` like the activity page) holds no data: its script fetches
`GET /settings` + `GET /directory` (who "you" are), `GET /context?entity=&principalId=` (rows), and on every slider stop
`GET /context?at=` (each claim's `validAt` then) and `POST /investigate` with `preview: true`, `allowQuestions: false`,
the stop's `at`/`atEvidence`, the entity id and the viewer as principal. The viewer is `?principalId=` or the settings'
current person (shown as "viewing as <name> (groups)"); with neither, an anonymous group-less principal that sees
organization-wide knowledge only. Access is therefore applied per request, exactly as for the panel.
GET /context gained three additive fields for the page (B1's builder, `memory/context-assertions.ts`):
`source.thread` (evidence thread id, so undated items group per thread), `conditionedBy` (the visible note that bounds a
claim, only when the condition itself is shown) and `route` (the claim's route in words via B2's `modelProvenance`).
Drawing: diamonds per source evidence; one lane per claim, bar from its source position to `validTo` (known), or to the
superseder's position for an undated supersession, or open (gradient fade into the status column) with "still believed
true"; superseded bars grey with an arrow to the superseder's bar and "superseded 6 Oct by Eino Salo"; a claim bounded by
a note (TRN-042 after Erkki's 14 Oct firmware note) is hatched from the note's position with "superseded 14 Oct by Erkki
Expert · still true for software.version < 4.2" (B1 bounds rather than supersedes; the words keep both facts). Status
column says "status now"; dimming says what counts at t (source not visible at the stop, or `validAt` false then).
Bindings are chips (hedged dashed), people are lanes with a dot per assertion. The card shows kind, text, the provenance
strip, up to four caveats, applicability and the next step; results are cached per stop and problem text, requests
debounced 150 ms; stale responses are dropped. Default problem text per story (`CONTEXT_STORIES`): TRN-042 "on firmware
4.2" so the superseded caveat appears after 14 Oct (without a version B1 keeps the advice, D-B1-07), RBS-310 the barrier
code question; editable on the page and settable with `?text=`.
Not added: an api-client method or a mock handler for the page (it is a page, not JSON, like `GET /demo/activity.html`;
the panel's link to it is hidden in mock mode, D-B3-09).
Reverse: delete `context-page.ts` and the route; the three additive fields are inert.

## D-B3-07 · Erkki's cost: GET /costs from store records, reuse by distinct stored investigation

New route `GET /costs` (`costs.ts`, `Engine.costs`; route count 40 -> 42 with `GET /context.html`; the brief's "40 ->
41" counted only this route). Counted from store records, never from the JSONL activity log: the person's question
records by status (asked = all, answered, deferred, dismissed, open = queued + delivered, cancelled), seconds = the
answered questions' `EvaluationRecord.response.latencyMs` (delivery, else creation, to the answer, on the engine clock;
`clock: 'simulated'` and "(simulated)" in the line when the demo clock is simulated; under a host-fixed clock the label
is `real`), total and median. Reuse = distinct stored investigations whose recommendation is reuse, check-first or
qualified and whose basis cites the person (a basis message they wrote, or a claim they asserted that a basis message
supports), split by the `investigation.started` principal type. Investigation ids are stable, so a repeated identical
request is one reuse; previews are never stored (D-B3-01); states with `problem.at` (B1 D-B1-12 asks exactly this) and
standing upkeep states are skipped. Not counted: an answer reused inside another investigation without a recommendation
citing it (no record says so).
Default person: `personEntityId`, else the most-asked person (ties by id), else the settings' current person, else 404.
Any person's counts may be read: the same facts are already readable through `GET /questions?personEntityId=` in this
unauthenticated prototype, and only counts are returned (no question text, no answer value).
Tests (tests/costs.test.ts, explicit clock): asked/answered/open, 42 s between delivery and answer, the default person,
the store line's shape; reuse by a person, unchanged by a repeated request, +1 by an agent, unchanged by a preview and a
point-in-time view.
Reverse: drop the route, `costs.ts` and the client/mock entries.

## D-B3-08 · The store line and its "before"

`storeHealth` on the cost view is B2's `storeHealth` (D-B2-29 definitions) over the cases the `principalId` may see
(all cases without one), printed as BUILD_BRIEF 5.5: "Store: N cases · completeness a → b after k questions ·
correctness c · s singletons left". The "before" is captured in memory by `Engine.resetDemo` (store-wide) or, for a
principal or after a restart, at that principal's first request; k = answers stored since. The arrow is shown only
when k > 0 and the two values differ at two decimals. Not persisted: writing a baseline record into the store at every
reset would add a record type or a trace event that other counts (E00, event tests) would see; a restart simply starts
a new "before". A failure in the store metric never fails the cost (the block is left out).
Reverse: drop `healthBaselines` and the `storeHealth` block.

## D-B3-09 · Where the cost shows

Settings: one row under "Points & rating", labelled "<first name>'s cost", loaded when Settings opens (`loadCosts`,
like `loadPoints`; it calls `GET /costs` with the current person as `principalId` and lets the route pick the most-asked
person), two short lines: "asked 3 · answered 2 · 21 s · reused 5 (3 people, 2 agents)" and the store line; any failure
hides the row. Activity page: a card above the rows filled by the same 2 s tick from `GET /costs` (never from the JSONL
log), titled "<name>'s cost · simulated seconds" when the demo clock is simulated. Not checked visually in the desktop
app in this pass beyond the screenshot harness (D-B3-11).
Reverse: the row in `panel.ts` TEMPLATE and `loadCosts`; the `cost()` call in `activity-page.ts`.

## D-B3-10 · "Open the context layer" from the case view: one validated IPC channel, system browser

The case view (`renderCase`) shows a button "Open the context layer" for the case's first non-person entity when the
panel was given `openContext` (new optional panel option). The desktop renderer passes it only when the preload bridge
has `openContext` and the panel is not on the mock (no page there), so the button is hidden in mock mode and in a plain
browser. Path: `window.kt.openContext(name)` (preload checks `isEntityName`: 1-64 of letters, digits, `._ -`, no
surrounding spaces) -> IPC `kt:open-context` -> `window.ts handleOpenContext` (only from the companion's own
webContents) -> `flags.ts contextPageUrl(serviceUrl, name)` which yields `<serviceUrl>/context.html?entity=<encoded>`
only for an http loopback service URL without credentials -> `shell.openExternal`. The window's navigation lock and
window-open denial are unchanged. Chosen over an in-app BrowserWindow because the page is a wide chart (1280 px) and the
judge already has a browser tab for the activity page. Tested: flags.test.ts (names, URL shapes, remote host, file URL,
credentials). Not clicked at runtime in this pass (the desktop build passes).
Reverse: drop the IPC entry, `handleOpenContext`, the preload function and the panel option.

## D-B3-11 · Screenshots: a contextShots step in the Electron harness, context only

`shots.ts contextShots(url)` opens a plain 1280x800 BrowserWindow (sandboxed, not the companion window, which never
navigates) on `<service>/context.html?entity=TRN-042` and `RBS-310`, zooms the page out to fit 800 px when the chart is
taller (TRN-042: 0.8), moves the t line with the page's own slider keys and waits for the card to carry that moment
(`#told[data-t]`, set by the page when a result is drawn), then captures. Files: `context-<entity>-t-<moment>.png`
(outside the NN-* set that `post()` compares with HEAD); what the card said at each moment and how many bars were dimmed
go to `checks-real.json` (`contextShots`). `KT_SHOTS_ONLY=context` runs only this step; a full real run adds it after the
panel walk. Committed set (run: `KT_SHOTS_HIDDEN=1 KT_SHOTS_ONLY=context KT_SHOTS_OUT=docs/runs/2026-11-07-overnight/day2/screenshots node scripts/real-check.mjs`,
port 47951, seed elisa, in-memory db, 0 console errors):
- TRN-042 09:14 (before 09:16): `none`, 32 of 38 bars dimmed; 09:22: `check-first` "Check the traffic counters
  first."; 09:25 (after 09:22): `qualified`, bounce the interface; 14 Oct and now: `qualified` "Check the traffic
  counters first; the fix from TRN-042 was superseded for this version." with "Superseded on 14 Oct by Erkki Expert:
  fixed in firmware 4.2".
- RBS-310 14:02 (thread, date unknown): `none` "No barrier code for RBS-310 is on file."; 20 Aug: `reuse` 5802;
  6 Oct: `reuse` 7731 "replaces 5802 from 20 Aug", the 5802 bar grey with the arrow to 7731.
Not run in this pass: the mock harness (`scripts/screenshot.mjs`), which would re-take and overwrite the committed
day-1 panel PNG set; the strip and the cost row are in the mock (`POST /investigate` provenance, `GET /costs`) for its
next run, and were checked here through the page and the tests, not through panel screenshots.
Reverse: drop `contextShots` and the `KT_SHOTS_ONLY=context` branch.

## Review (two independent reviewers, after 428fc29)

### D-B3-12 · A time-only stop shows only its own thread, dated or not (major, fixed)

Finding: at a time-only stop the page said "only this thread up to here counts", but `gateAt` hid only *undated*
evidence of other threads; the stop's `at` was 1 ms before the earliest dated item *on the entity's axis*, so dated
evidence of other threads before it stayed visible (18 items at TRN-042 09:14 on the Elisa store), and with no dated
item on the axis no `at` was sent and the engine used now. Confirmed in the code.
Fix, both halves: (1) `gateAt` with `atEvidence` now hides every evidence item outside the cutoff's thread, dated or
not (a moment inside an undated thread cannot be ordered against any other source), so the page's label is what the
gate does; the axis's `visibleAt` mirrors it. (2) The moment itself is read before every dated source the viewer can
see: `access.ts earliestDated(store, gate)`; `GET /context` carries it as `earliestDated` (additive, through the
viewer's gate), the page passes it to `layoutTimeAxis` (`opts.firstDated`), and every time-only stop sends
`at` = 1 ms before min(axis, store) whenever any dated source exists; `Engine.investigate` with a cutoff and no `at`
uses the same moment (else now). Claim validity at a time-only stop is therefore read before any dated change.
Measured on the Elisa store after the fix: dated evidence of other threads visible at TRN-042 09:14 and RBS-310 14:02:
0 and 0; every slider answer is unchanged (TRN-042 none -> check-first -> qualified -> superseded caveat after 14 Oct;
RBS-310 none -> 5802 -> 7731). Tests: preview-at-evidence (dated evidence of another thread hidden; earliestDated;
a cutoff without `at` = the cutoff with `at` just before the first dated source), time-axis (firstDated, an entity
without dated items still sends `at`), context-page (`earliestDated` on GET /context, the first stop's `at`).
Reverse: the `if (ok && atEvidence !== undefined)` branch in `gateAt` back to undated only, and drop `earliestDated`.

### D-B3-13 · Undated threads are laid out in thread order (minor, fixed)

Finding: time-only items were placed by clock minutes, visibility followed sequence; a thread crossing midnight put
00:10 left of 23:50 and moving t right hid evidence. Fix: thread order (sequence, then minutes) decides left to right,
as the gate does; clock minutes only set the spacing while they rise with that order, otherwise the items are spaced
evenly; the tick labels stay the raw clock text. Test: time-axis (23:50, 00:10, 00:20: visible sets 1, 2, 3, 3).
Reverse: the sort in the time-only branch of `layoutTimeAxis`.

### D-B3-14 · Access facts: a hidden newer code does not close the old one (minor, fixed in B1 code)

Finding: with the 6 Oct 7731 e-mail restricted, a non-member got "No barrier code for RBS-310 is on file." at now
while the page showed 5802 "still believed true": `lookupAccessFacts` read the raw 5802 claim, whose validity was
closed by the hidden 7731 claim, so the answer told a non-member that something newer exists. Fix:
`lookupAccessFacts` presents a claim whose superseder the requester may not see as it was before it (no
`supersededBy`, status provisional, no close time set by that claim), the same rule as context-assertions (B1
D-B1-39). The non-member now gets the August code flagged as past its October change (check-first, as without the
follow-up), never 7731, "6 Oct" or "no code". Test: access-facts.test.ts (fails without the fix).
Reverse: drop `asSeen` in `access-facts.ts`.

### D-B3-15 · atEvidence the requester may not see is a 400 like an unknown id (minor, fixed)

Both reviewers: `Engine.investigate` checked the cutoff with `store.get` only, so a restricted id answered 200 and an
unknown one 400, and an invisible item could become the cutoff. Fix: the id must exist and pass the requester's
`evidenceGate`; otherwise the same 400 "Unknown atEvidence". Test: preview-at-evidence (same message for both; a member
of the group gets 200).
Reverse: the check in `Engine.investigate`.

### D-B3-16 · One phrase for a bounded claim (minor, fixed)

Finding: the card's strip said "still believed true for software.version < 4.2 (bounded 14 Oct by Erkki Expert)" right
above B1's caveat "Superseded on 14 Oct ...", and the page said "superseded 14 Oct ... · still true for ...". Now both
the strip and the page's status column say "bounded 14 Oct by Erkki Expert · holds for software.version < 4.2"
(`ProvenanceView.stillBelievedTrue` stays true: the advice holds inside the bound). B1's caveat text is unchanged (for a
problem on 4.2 the advice is superseded for that unit, which is what it says). Test: context-page (strip shape on the
synthetic TRN-117 bounded advice; the page source carries the phrase). Supersedes the words in D-B3-05 and D-B3-06.
Reverse: the two strings in `provenance-strip.ts` and `context-page.ts statusOf`.

### D-B3-17 · The Settings cost row keeps the reset's "before" (minor, fixed)

Finding: the Settings row asks `GET /costs` with the current person as `principalId`, and the per-principal baseline
was taken at that principal's first request, so answers given before the first Settings opening were folded into the
"before" and no arrow appeared, while the activity page (no `principalId`) used the reset's baseline. Confirmed with a
probe (answeredSince 0 vs 1). Fix: `Engine.resetDemo` takes the baseline for every directory person as well as the
store-wide one, at the same moment; a principal outside the directory still gets the lazy baseline (D-B3-08).
Test: costs.test.ts (after a reset and one answer, the first `GET /costs?principalId=` reports answeredSince 1, like
the activity page). Reverse: the loop in `resetDemo`.

### D-B3-18 · The simulated seconds label is tested (minor, fixed)

The same test runs on the demo clock (`clock: undefined`, `POST /demo/clock`) and asserts `seconds.clock ===
'simulated'`, "(simulated)" in the line and "simulated seconds" in the activity page's source.

### D-B3-19 · DEMO.md and the README lead to the Context Layer page (major, fixed)

Finding: no demo step or URL led a judge to `/context.html`, the slider or the cost card. Added a DEMO.md section
"The Context Layer: what an agent is told at time t" (both URLs, the four rows, what to drag, a table of what the card
says at 09:14-09:18, 09:19-09:22, 09:25 and 14 Oct / now for TRN-042, the RBS-310 story, `principalId`, `text`, the
synthetic TRN-117 fallback, the screenshots, the strip and Erkki's cost) after the activity-stream section, and one
bullet in the root README's judge quick start. The 3-minute script itself is unchanged (the page is an extra minute).
The UI README (Settings cost row, provenance strip, `openContext`, `costs()`) and the desktop README (`kt:open-context`
in the IPC table) were brought up to date as well (minor finding).
Reverse: remove the section and the bullets.
