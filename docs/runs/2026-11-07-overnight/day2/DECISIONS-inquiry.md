# Decisions · Day 2 B7 (agent-driven inquiry: gain or lose confidence through the right people)

Branch `day2/b7`, from `run/2026-11-07-overnight` at `67dcb3f` (B1 and B2 merged: 511 tests, 40 routes, 9 MCP tools).
Each entry: what was decided, why, and how to reverse it.

## D-B7-01 · Request options are filters over the same loop, with a pure plan()

`QuestionCoordinator.request(state, opts)` takes `{gapId?, preferPersonEntityId?, dryRun?, skipActiveCheck?,
excludePersonIds?}` (`RequestOptions`). The work before any store write moved into `plan()`: generate, hard
eligibility for every listed pair (unchanged), then the filters (`gapId` keeps that gap's candidates, `excludePersonIds`
drops people from the eligible set, a preference keeps only that person's eligible pairs) and the selector. With no
option the call is the pre-B7 one (same records, same ids; all 511 earlier tests unchanged). With a `gapId` the
candidate cap is lifted to the number of gaps so the filter cannot lose its gap to `maxCandidates`.
Why: the brief requires every gate to stay; filters can only narrow what the gates allow. A pure plan lets a refusal say
who would be asked instead without leaving decision rows behind.
Reverse: inline `plan()` back into `request()`.

## D-B7-02 · A refused preference records a trace event only

When the preferred person has no eligible pair, `request()` writes no eligibility, decision, evaluation or question
record and does not change the loop line; it traces `clarification.refused` on the investigation with the person, their
violations (the candidate with the fewest violations speaks for them; `not-answerable` = not a recipient for this gap)
and `wouldAsk` (the pair the selector picks over the unrestricted eligible set, with the gap, the question text and the
recipient's `because`). The decision and evaluation rows stay what the selector actually did; a refusal is the agent's
request turned down, not a selector decision. The decision row's `eligible` is the set the selector chose from (the
preferred person's pairs when the preference was honoured), so propensities stay honest for the bandit logs.
Reverse: persist the plan's records in the refused branch.

## D-B7-03 · Batch mode skips the open-question answer only on its own path

`requestMany(state, gapIds)` (max 3, duplicates dropped) runs `request()` per gap with `skipActiveCheck` and the people
already chosen in this call in `excludePersonIds`; it stops at `maxQuestionsPerInvestigation` (counted before each gap;
eligibility checks it again). A gap that already has an open question in the investigation is refused by the usual
`already-asked`/`duplicate` gates, so nothing is asked twice. After the call the loop line is `question-open` when any
question opened (a later gap that found nobody does not overwrite it), "Queued until 07:00" when the first one is held.
Reverse: delete `requestMany`.
