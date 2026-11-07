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

## D-B7-04 · Agent wording is a trace event and a generator wrapper; 'agent' joins `phrasing.by`

`kt_propose_question` checks the text with B2's `validatePhrase` and exactly the input the phrase model gets
(`phraseCheckFor(facts, visibleCaseFacts(...))`, both now exported from `generator-phrased.ts`; the class calls the same
functions, so the model path is unchanged). Every proposal is traced as `question.proposed` on the investigation
(`{gapId, text, accepted, reason?, by, at}`); RecordTypes stays closed. `AgentWordedGenerator` wraps the engine's
generator (templates or the phrase slot) in `wiring()`: for a gap with an accepted wording it re-checks the text against
the facts of that moment and, if it still passes and differs from the template sentence, replaces `text`, keeps
`templateText`, sets `generatedBy` to the new route label `agent-worded@1` and `phrasing.by: 'agent'`. The question card
then says "worded by the agent" (`views.ts wording()`). The agent's wording outranks a model's wording for that gap (the
agent asked for it). A later rejected proposal does not erase an accepted one. An accepted wording applies to the next
question for the gap; an already open question keeps its words (the response says so).
Contract change (named by the brief: the card must say "worded by the agent"): `QuestionCandidate.phrasing.by` widens
from `'model' | 'template'` to add `'agent'`. The route is `rules` (`Route` stays closed): the words are the agent's, the
acceptance is the rules validator, and no model of ours runs; the version string and `phrasing.by` say who worded it.
Reverse: drop the wrapper in `wiring()`; the events then do nothing.

## D-B7-05 · The three new tools are MCP only

`kt_list_gaps`, `kt_propose_question`, `kt_store_health` call engine methods (`listGaps`, `proposeQuestion`,
`storeHealthView`) and have no HTTP route; their MCP_TOOLS entries say "MCP only". The route count stays 40. Why: four
items build in parallel and B3 adds routes; the brief asks for the tools, and explicitly for no store-health route. The
HTTP investigation result already carries the gaps (without recipients). Reverse: add routes mapping to the same methods.

## D-B7-06 · Who can answer a gap, and "askable now"

`kt_list_gaps` lists only open gaps. Recipients come from `findRecipients` (already gated by the requester's evidence
visibility) for gaps a question is built for (a template candidate exists); `askableNow` is `evaluateEligibility` for
that person and that candidate (every gate), with the violations in plain words. Quiet hours do not block: a question
asked at night is held, so the response also says `quietHours: {now, heldUntil}`. A gap the requester can check
(requester-observable key) or a non-consequential one (lasting) lists nobody and says why (`notAskedBecause`).
`decides`: missing -> applicability, outcome -> support, non-consequential -> nothing.

## D-B7-07 · Confidence block: labels, reasons, visible evidence, the gaps that move them

For the selected hypothesis (the recommendation's basis case, `basisCaseId`): `support` and `applicability` labels from
the assessor, reasons split from `Hypothesis.notes` (the applicability reasons are the assessor's fixed phrases:
"conflict on distinguishing ...", "distinguishing condition not yet known ...", "non-distinguishing conflict ...", "no
condition of the case ...", "no conflicts; ..."; every other note is about support), evidence refs = the hypothesis basis
through the requester's evidence gate, `movedByGapIds` = open gaps on that case deciding that label, `settledBy` =
resolved ones with what resolved them. No number anywhere in the block; a test asserts the tool's JSON has no `score` or
`cosine` key. `null` when there is no basis case. Reverse: `confidenceView` in `service/inquiry.ts`.

## D-B7-08 · storeHealth for a principal applies the evidence gate

`Engine.storeHealth(who)` takes a person id (as before) or a Principal (agents); for either, the cases are those the
principal may see by scope and by evidence (`listCases` + `visibleCase`, as the case views do), passed as `caseIds`.
Before, a person id filtered by case scope only. Without a principal nothing changes (the reward and the experiments call
the library directly). Slot values of a visible case are still computed from the case's records (only counts leave the
engine, never content). `storeHealthView` adds the open standing gaps on those cases by kind and the quiet-hours state;
the agent cannot request standing questions itself (they belong to the system's standing states), the engine asks them.
Reverse: back to `principalFor` + scope-only in `storeHealth`.

## D-B7-09 · `kt_request_clarification` with a gapId or a preference

A `gapId` must belong to the investigation (404 otherwise). A gap without a question (resolved, requester can check, not
consequential) returns `not-needed` with the reason and does not touch the loop line (another gap may still need a
person). The open-question rule stays for single requests: if the investigation already has an open question, that one
is returned (as before), and the reason says so when it is for another gap or another person. A preference is resolved
through the directory (an entity id, or an actor id of that person). Refusal reason: the person's gates in plain words
plus who the engine would ask instead (`wouldAsk {personEntityId, name, because, gapId, text}`), or that nobody else can
be asked now.

## D-B7-10 · Two processes on one database file: the new-row counter also reads the disk (fix)

The night sequence has two writers on one SQLite file: the service (Erkki's tap) and the MCP server (the agent's
outcome report). `sqlite-store` kept its insertion counter (`created_seq`, also the `search_docs`/FTS rowid) in memory,
read once at open, so the MCP server's next insert reused a rowid the service had just written: `kt_record_outcome`
failed with "UNIQUE constraint failed: search_docs.rid" (also on the run branch: the old demo:agent `--outcome` after a
tap in the panel). Now a new row first moves the counter past `MAX(created_seq)` of its table and `MAX(rid)` of
`search_docs` on disk (two indexed MAX lookups, only for new ids). Test: sqlite-store.test.ts "two stores on one file"
(fails without the fix). Order across tables stays monotonic per writer; nothing else changes.
Reverse: the `if (!existing)` block in `put`.

## D-B7-11 · demo:agent is the 03:00 sequence; quiet hours on for it (reverses D-B1-35 for demo:agent only)

`pnpm demo:agent` starts the MCP server with `--clock 2026-11-08T01:00:00Z` (03:00 Helsinki) and `--quiet-hours on`;
`pnpm demo:judge` keeps quiet hours off (D-B1-35 stands for it). Sequence: kt_investigate -> kt_list_gaps (gaps and the
confidence block) -> the first askable gap that decides applicability -> kt_find_people -> kt_request_clarification with
`gapId` and `preferPersonEntityId` = the person whose name contains `--prefer` (default "Erkki"; refused -> the script
takes the engine's `wouldAsk`) -> queued, `deliverAfter` 07:00 printed -> the clock moves to 07:30 (`--morning`): when
`GET /health` on KT_PORT (`--port`) reports the SAME database file, `POST /demo/clock` on that service, so the companion
delivers Erkki's question; otherwise the MCP server is restarted with `--clock 07:30` (it delivers on its own clock) ->
"Waiting for Erkki's tap" and `kt_clarification_status` polled up to `--wait` seconds (default 180) -> kt_get_context and
kt_list_gaps after -> kt_record_outcome with `--outcome`. `--simulate-tap` answers as the asked person (`--answer`,
default yes) through the service's answer route when it serves the database, else through an in-process Engine on the
same file with the org configuration and the morning clock. A service on another database is never touched. The service
clock goes back to real time at the end unless `--keep-clock`. `--day` runs on real time with quiet hours off.
`tests/service-main.test.ts` now guards these flags instead of `--quiet-hours off`.
Why the real date in `--night`: the brief names it; on a later date it still works (only the order of capture time and
the simulated night changes). Reverse: `--day` behaviour as the default.
