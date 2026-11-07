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
`at` exactly as B1 built it (visible when at or before `at`). Without `at` the engine uses now as `at`; an unknown
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
are the raw clock text), the calendar for known instants (UTC short dates, as B1's `shortDate`), then a '?' gutter for
items with no usable time (unknown, and date-only, whose raw text is not trusted onto a calendar). Undated threads come
first because B1's validity rule treats an undated source as valid from before any dated moment; the gutter comes last
because nothing places it in time. Stops: one per evidence item on a clock segment (`atEvidence` = that evidence,
`at` = 1 ms before the earliest dated item on the axis, so no dated item counts), one per distinct dated moment
(`at` = that instant), and `now` (no `at`). The visible set per stop mirrors `gateAt`: at a calendar stop every undated
item counts (B1), even though the gutter is drawn to the right of the line; the page says so in the gutter's label.
Reverse: `layoutTimeAxis` (the order of `parts`) and the stop builder.
