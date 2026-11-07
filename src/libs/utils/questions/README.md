# questions

Question candidates, question-specific recipients, hard eligibility and the request/answer lifecycle.

## Public interface (`index.ts`)
- `TemplateQuestionGenerator(ctx)` implements `QuestionGenerator` (route `rules`): only open, consequential gaps become quick yes/no questions ("Is Asset-B2 an older unit?" using the problem's asset and the plain condition label, "Did traffic return right after the interface reset on TRN-042?" using the case's short label and the configured action phrase), with rationale citing evidence ids, `consequences {yes, no}`, normalised `dedupKey` (gap key + scope) and `recipientIds`. `evaluativePair(a, b)` builds an optional preference candidate (never mandatory, never factual evidence).
- `findRecipients(ctx, state, gap)`: past action/outcome questions -> people with firsthand links on that case (performed-action, reported-outcome, advised); current/inventory-condition questions -> people with firsthand links to the problem's entities plus people whose directory groups/roles are configured to observe that key; the requester is excluded.
- `evaluateEligibility(ctx, state, candidate, person)` -> `RecipientEligibility` with violations `gap-resolved`, `self`, `not-answerable`, `unavailable`, `access` (recipient must be allowed to see the cited case), `budget` (daily limit, max open, per-investigation cap), `cooldown`, `already-asked`, `duplicate`.
- `QuestionCoordinator`: `request(state)` -> candidates -> eligibility -> selector -> `PolicyDecision` (+ `EvaluationRecord`, assessedBenefit null) -> `QuestionRecord` queued then delivered after an eligibility recheck; `answer(questionId, value, principal)`; `defer`/`dismiss`/`undo`/`cancel`; `recordObservation`; `cancelObsolete`; `rebuild`.

## Answer semantics
- Every answer creates an evidence envelope (`kind: observation`, `provider: paste`, `connectionId: answer:desktop`), an `Answer` with attributed `claimUpdates`, and (for yes/no) an `Observation`. The investigation applies observations on rebuild: yes on a condition question -> `eq`, no -> `neq` (a conflict with the case's value, so a useful No flips the recommendation to `retain-uncertainty`); yes/no on an outcome question -> recovered / no-change. Unknown -> `no-change` update, no observation, the gap stays open and the person is not re-asked.
- Stored historical `Claim` rows are never mutated: answers are separate attributed evidence applied at assessment time (undo of an answer withdraws it cleanly).
- An observation or answer that resolves a gap cancels queued/delivered questions with `cancelReason: gap-resolved` (`obsolete` when the gap is gone, `duplicate` for twins).
- Budgets are derived from persisted question records (delivered today, last delivered, open ids); nothing else holds counters.
- Loop status after `request` (each with a `loopReason` from `settings.loopReasons`): `question-open` (waiting for the named recipient), `no-question-needed` (no candidates), `exhausted` only when the per-investigation question budget is used, `deferred` otherwise (no eligible recipient, everyone already asked, people busy/cooling down, or the selector held the question); `answered` after an answer.

## Phrase slot (B2)
`generator-phrased.ts`: `PhrasedQuestionGenerator({inner: TemplateQuestionGenerator, ctx, provider, model})` asks the phrase model for one sentence per quick candidate (gap, the case facts the requester may see, the asset, the template sentence) and accepts it only through `validatePhrase` (exported for B7): shape, asset and label named, no id, number (digits or words), negation or word that is not in the input apart from grammar. Consequences, dedup key, recipients and gates stay the template's; on a rejection or failure the template text stays and `candidate.phrasing.reason` says why. `generatedBy` becomes `ollama-phrase@1:<model>` only for accepted wording; `templateText` keeps the template wording.

## Dependencies
`contracts`, `investigation`, `retrieval/access`, `policies/features` (feature names, `actionKey`), `models/routes`, `models/providers` (contracts-only: `withFallback`).

## Configuration
Everything comes from `InvestigationSettings` (`coordinator` limits from contracts `CoordinatorSettings`, `observability`, `questions.conditionTemplates`, `questions.outcomePhrases`, `questions.evaluativePairs`). The selector is injected.

## Checks run
`node --test 'src/libs/utils/questions/**/*.test.ts'`: 18 tests passing (question and recipient pairing with requester excluded, yes/no/unknown answers with rebuild, outcome questions, observability-policy recipients, gap-resolved cancellation for queued and delivered questions, daily limit, cooldown, max open, duplicate and already-asked, access, unavailable, lifecycle/undo, no-question-needed, optional evaluative pair). Harness in `testing/harness.ts`.

## Known limitations
- A deferred question is not re-surfaced later (it counts as already asked).
- Only one question is active per investigation at a time.
- Answers from a person who also reported the original outcome are attributed but not marked non-independent.
- Question wording is template based and English only.

## Fix pass notes
- Eligibility: a person who answered the same dedupKey in another investigation is on a time-bounded `cooldown` (max of the configured cooldown and 24h), not a permanent `duplicate`. `investigate()` reuses that answer as attributed evidence for the same asset set.
- Answers record agreement with the case condition (`ANSWER_MATCHES_CASE` / `ANSWER_DIFFERS_FROM_CASE` from `retrieval/conditions.ts`), so every condition operator works; `ClaimUpdate.claimId` is always a real Claim id.
- `undo()` of a cancellation requires the requester or an agent. 25 tests in this module.

## Fix pass 3
- Templates never render an empty slot: when `{value}`/`{a_value}` is unknown the generic "Is this true for <asset>: <label>?" (a yes/no fact, so "No" means the condition does not hold; the asset is the one the problem names, never an asset that only belongs to the cited case) is used, and an outcome question for an attempt the requester cannot see (or that no longer exists) is skipped. Question text, rationale and consequences are built from the case as the requester may see it (`visibleCase`) and name actions only as far as that case's evidence mentions them (`casePhrase`). `question-text.test.ts` scans every generated text for double spaces, "undefined", "null", `{}` and empty parentheses.
- `RecipientReason.because` feeds the loop line "Asked <name> because they <contribution> in <case>".

## Quiet hours and standing gaps (B1)

- `quiet-hours.ts`: `inQuiet(now, qh)` / `nextWindow(now, qh)` over Intl local time. With `CoordinatorSettings.quietHours` (hosts wire `org-config.ts defaultQuietHours`, 22:00-07:00 Europe/Helsinki; never a library default), `request()` keeps a question created inside quiet hours `queued` with `deliverAfter` (trace `question.held`, loop "Queued until 07:00: nobody is woken at night"); `deliverDue()` delivers what is due through the usual eligibility re-check (`deliveredAt` = the window, so budgets count from it). The Engine calls it on clock moves and reads; `GET /questions` hides held questions until their window.
- Standing gaps (`memory/standing-gaps.ts` records them on a per-case `origin: 'standing'` state): kinds `outcome` (24 h after a fix with no outcome), `pairing` (orphan fix + open problem on the same asset) and `missing-symptom` (free text, `pile: 'later'`, delivered straight to `deferred`). The generator offers one kind at a time, recipients are the fix's performer only, and for non-standing candidates standing questions are ignored in budgets and duplicate checks (an investigation always outranks them). `coordinator.answer` on a standing state never re-investigates: outcome -> case overlay observation, pairing -> Pattern confirmed/rejected with the answer as evidence, missing-symptom -> attributed evidence on the case. Decisions D-B1-22..30.
