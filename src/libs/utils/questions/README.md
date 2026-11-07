# questions

Question candidates, question-specific recipients, hard eligibility and the request/answer lifecycle.

## Public interface (`index.ts`)
- `TemplateQuestionGenerator(ctx)` implements `QuestionGenerator` (route `rules`): only open, consequential gaps become quick yes/no questions ("Was Asset-B2 on the older unit revision?", "Did traffic return right after the interface reset in ..."), with rationale citing evidence ids, `consequences {yes, no}`, normalised `dedupKey` (gap key + scope) and `recipientIds`. `evaluativePair(a, b)` builds an optional preference candidate (never mandatory, never factual evidence).
- `findRecipients(ctx, state, gap)`: past action/outcome questions -> people with firsthand links on that case (performed-action, reported-outcome, advised); current/inventory-condition questions -> people with firsthand links to the problem's entities plus people whose directory groups/roles are configured to observe that key; the requester is excluded.
- `evaluateEligibility(ctx, state, candidate, person)` -> `RecipientEligibility` with violations `gap-resolved`, `self`, `not-answerable`, `unavailable`, `access` (recipient must be allowed to see the cited case), `budget` (daily limit, max open, per-investigation cap), `cooldown`, `already-asked`, `duplicate`.
- `QuestionCoordinator`: `request(state)` -> candidates -> eligibility -> selector -> `PolicyDecision` (+ `EvaluationRecord`, assessedBenefit null) -> `QuestionRecord` queued then delivered after an eligibility recheck; `answer(questionId, value, principal)`; `defer`/`dismiss`/`undo`/`cancel`; `recordObservation`; `cancelObsolete`; `rebuild`.

## Answer semantics
- Every answer creates an evidence envelope (`kind: observation`, `provider: paste`, `connectionId: answer:desktop`), an `Answer` with attributed `claimUpdates`, and (for yes/no) an `Observation`. The investigation applies observations on rebuild: yes on a condition question -> `eq`, no -> `neq` (a conflict with the case's value, so a useful No flips the recommendation to `retain-uncertainty`); yes/no on an outcome question -> recovered / no-change. Unknown -> `no-change` update, no observation, the gap stays open and the person is not re-asked.
- Stored historical `Claim` rows are never mutated: answers are separate attributed evidence applied at assessment time (undo of an answer withdraws it cleanly).
- An observation or answer that resolves a gap cancels queued/delivered questions with `cancelReason: gap-resolved` (`obsolete` when the gap is gone, `duplicate` for twins).
- Budgets are derived from persisted question records (delivered today, last delivered, open ids); nothing else holds counters.
- Loop status after `request`: `question-open`, `no-question-needed` (no candidates), `exhausted` (every pair blocked by a permanent violation), `deferred` (transient violations or the selector deferred); `answered` after an answer.

## Dependencies
`contracts`, `investigation`, `retrieval/access`, `policies/features` (feature names, `actionKey`), `models/routes`.

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
