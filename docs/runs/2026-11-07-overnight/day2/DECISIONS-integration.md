# Decisions · Day 2 integration (day2/b2 models merged after day2/b1 engine)

Merge commit `e844b0b` ("Merge day2/b2 (models) into the run branch"). day2/b1 (engine: validity, `at`, GET /context,
access facts, quiet hours, standing gaps; DECISIONS-engine.md) was already merged; day2/b2 (models: slots, providers,
embeddings, case cards, extractor-llm, phrase slot, store health + reward, Settings -> Models, E08-E10;
DECISIONS-models.md) conflicted in 15 files. Every conflict keeps both sides; where the two could not both hold as
written, the judgement is recorded here.

After the merge: `pnpm typecheck` clean, `pnpm test` 507/507 pass (private/ present), `node --test experiments/*.test.ts`
23/23 pass.

## D-INT-01 · Plain unions (no judgement beyond keeping both)

- `contracts/questions.ts`: `QuestionCandidate` keeps B1's `origin?: 'standing'` and `pile?: 'later'` and B2's
  `templateText?` and `phrasing?`. `deliverAfter` and `answerType: 'free-text'` came in without conflict.
- `contracts/service.ts`: imports both `ContextAssertionsView` (B1) and the model slot types (B2).
- `org-config.ts`: one import of `ModelSlots, QuietHours`; `defaultQuietHours`, `defaultStandingGaps` and
  `DEFAULT_MODEL_SLOTS` are all exported.
- `views.ts`: `questionView` carries B1's `deliverAfter` (while held) and `answerType: 'free-text'`, then B2's
  `wordedBy`/`templateText`.
- `memory/index.ts`: exports both B1's context-assertions/standing-gaps/validity and B2's case card; the
  extractor-llm/enrich exports merged cleanly. `ImportFromPathRequest` has both `standing` and `onCommitted`.
- `http.ts`: one schema import list with `contextQuerySchema` and the four model schemas.
- `service/README.md`: B1's "part B" section, then B2's "Model slots" section.
- `ui/styles.css`: B1-side panel styles (info tooltip, similar cases, thumbnails, Connections page) and B2's Models
  styles. `ui/mock-api.test.ts`: B1's GET /context mock test and B2's three Models mock tests.

## D-INT-02 · Route count is 40

The route table in `http.ts` has 40 entries: the 32 before day 2, B1's `GET /context`, and B2's seven model routes
(`GET /models`, `POST /models/pull`, `GET /models/pull/:id`, `POST /models/test`, `POST /models/key`,
`POST /models/install`, `GET /models/install`). B1's tests said 33, B2's said 39; both `tests/e2e.test.ts` and
`tests/points.test.ts` now assert 40, and e2e checks `GET /context` by name along with the model routes.

## D-INT-03 · Order inside importFromPath: standing gaps, then onCommitted

`recordStandingGaps` (when `standing` is passed) runs right after the rules commit, then `onCommitted` hands the
threads to the extract slot. `onCommitted` only collects the items (the model pass runs afterwards, awaited, in
`Engine.importAndEnrich`), so the order does not change what the rules import records.

## D-INT-04 · On the model import path, standing gaps are re-recorded and asked after the union

`Engine.importData` asks standing gaps (B1) only when it is NOT called with `onCommitted` (the rules-only path: demo
reset, scripts, extract on rules). `importAndEnrich` (extract on local/api) does it after the model's union instead:
when the model committed claims it calls `recordStandingGaps` again over the union, then asks (when
`standingGaps.ask`). Reason: otherwise the background ask races the awaited model pass and may ask about a symptom the
model's proposal is about to supply. With extract on rules the path is exactly B1's.

## D-INT-05 · Engine.answer keeps both tails

After an answer: the receipt is built (B1 order), `afterChange()` starts the embedding refresh when `autoModels` is on
(B2), then `await askStanding()` (B1). After an import: `afterChange()` runs on both paths (B2), as in B2.
Engine imports keep `evaluateEligibility` (B1) and add `PhrasedQuestionGenerator` and `LinUcb` (B2).

## D-INT-06 · The reward's quiet-hours burden term uses B1's quiet hours (fix)

B2's coordinator `burden()` compared `HH:MM` of the UTC clock against `quietHours.start/end`, written before B1's
`QuietHours` existed. B1's quiet hours are local wall-clock hours in an IANA zone (`Europe/Helsinki` in org-config), so
the UTC comparison would charge the term at the wrong hours (two or three hours off). The term now calls B1's
`inQuiet(now, quietHours)` from `questions/quiet-hours.ts`. Weights (`BURDEN`) unchanged. No test exercised the
mismatch; existing reward tests run without quiet hours and are unaffected.

## D-INT-07 · B1's standing kinds are not phrased by the model

`PhraseFacts.kind` widens to `'missing' | 'outcome' | 'missing-symptom' | 'pairing'` so the template generator can
return facts for every candidate (`generateDetailed`). `PhrasedQuestionGenerator` phrases only quick yes/no candidates
of the investigation kinds (`missing`, `outcome`); a missing-symptom question (free text, opens with "You ...") and a
pairing question (names two cases) keep the template wording and carry no `phrasing` mark, like evaluative
candidates. Reason: B2's validator requires a yes/no opener and checks the condition label or action noun of the two
kinds it was built for; a free-text question would always be rejected, and the pairing question's consequences name
both cases, which the validator does not check. This is a scope cut, not a refusal: phrasing the standing kinds needs
its own checks. No dedicated test was added for this guard (follow-up).

## D-INT-08 · E08/E10 run on the store they were recorded on, without B1's follow-ups

After the merge two experiment tests failed: the E08 paraphrase probe chose TRN-042 as its target, and the
embed=local service test found three texts with no recorded vector. Cause: B1's demo reset always imports
`data/demo/followups` (D-B1-16), and Erkki's 14 Oct note names TRN-042, so the probe's "Elisa present?" check
(`entity TRN-042 exists`) became true on a clean store, and the follow-up texts were never embedded when E08 was
recorded (outputs are hash-locked; re-recording needs Ollama, and this integration is offline). The experiments'
`demoEngine` and the embed=local service test now pass `NO_FOLLOWUPS` (follow-up directories that do not exist, which
the reset skips), exported from `experiments/runners-models.ts`. The real demo reset (service, judge demo) still
imports the follow-ups. Not done: re-running `node experiments/run.ts e08|e10` to confirm the committed results are
reproduced byte-for-byte after the merge, and recording vectors for the follow-up texts.

## D-INT-09 · Model status chip styles are scoped to the Models view (fix)

B2 added `#kt-panel .rf-chip { border-radius:999px; max-width:60%; white-space:nowrap; ... }` for the slot status
chip, but `.rf-chip` is also the attachment chip in the input view (the run branch's thumbnail chips use it). The four
B2 chip rules are now `#kt-panel .rf-models-view .rf-chip...`, so attachment chips look as before and the Models view
is unchanged.

## D-INT-10 · Panel views and Back

`ViewName` has both `'connections'` (run branch, Artem 7 Nov) and `'models'` (B2). `BACK` is the union
(`result -> input`, `connections -> settings`, `models -> settings`, plus the shared entries), and the `back` action
keeps the run branch's people-from-case rule. Settings shows both rows (Models, Connections); the action switch has
both the `connections`/`conn` cases and B2's `models`/`model-*` cases.

## D-INT-11 · Standing answers carry no measured reward (left as built)

B2's reward (store-metric delta minus burden, `selector.update`) is measured in `QuestionCoordinator.answer` for
investigation questions. B1's standing answers go through `answerStanding`, which B2 never saw; they still write the
evaluation's response but no `assessedBenefit` and no selector update. Extending the reward to standing answers would be
new behaviour on neither branch (and D-B2-51 already notes that the metric reads an applicability "no" as a
contradiction), so it is left for a later decision rather than invented during the merge.
