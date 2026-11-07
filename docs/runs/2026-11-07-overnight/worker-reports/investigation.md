# Worker report: investigation / question worker

Owned paths: `src/libs/utils/{retrieval,investigation,questions,policies,models}/`. Nothing outside them was edited except this report and `contract-requests/investigation.md`. No commits were made.

## Built
- **retrieval**: BM25, exact-identifier, local hashed-trigram (512-dim, labelled not learned) and hybrid retrievers (weighted reciprocal rank fusion, relative pruning, condition-aware score); access-filtered corpus; `compareConditions` (matching / conflicting / missing + `unchecked` expected traits, with history and identity keys handled by configuration).
- **investigation**: problem parser (configurable lexicon, shared vocabulary keys), rules assessor in `separate` and `combined` modes, support/applicability rules, evidence-class gated recommendation (`reuse`, `check-first`, `qualified`, `retain-uncertainty`, `none`), consequential gaps with `whatAnswerChanges`, permitted-observations handling, people with reasons and `askable`, budget derivation from persisted questions, and `investigate()` that rebuilds from recorded observations/answers.
- **questions**: template generator, question-dependent recipients (firsthand-on-case for outcome questions; entity links plus ObservabilityPolicy for condition questions; requester excluded), hard eligibility with all nine violations, coordinator (request, deliver with recheck, answer with evidence envelope and attributed claim updates, defer/dismiss/undo/cancel with `previousStatus`, `recordObservation`, `cancelObsolete`, `rebuild`), `EvaluationRecord` per decision (benefit null, effort counted).
- **policies**: rules selector, LinUCB (artifact round trip, null benefit skipped), epsilon-greedy and random baselines, replay ranker that blocks explicitly and falls back to rules, registry.
- **models**: route registry and network guard, replay provider with input-hash check, hashed logistic regression, artifact IO, `InMemoryStore` (full `KnowledgeStore`), synthetic fixtures, selection simulator with hidden knowledge kept inside it.

## Checks run
- `pnpm typecheck`: passes for the whole repo (at the time of the last run).
- `node --test` per module: retrieval 9/9, investigation 13/13, questions 18/18, policies 10/10, models 5/5 (55 tests, 0 failures).
- Required tests: (1) reuse path, (2) conflicting lookalike (unit.age and unit.model), (3) missing condition -> one gap -> one question to the firsthand person, requester excluded, yes / no / unknown behaviour, (4) requester observation cancels queued and delivered questions with `gap-resolved`, (5) daily limit, cooldown, max open, (6) duplicate and already-asked, (7) access, (8) LinUCB vs epsilon-greedy vs random for seeds 1, 2, 3 (beats both on every seed; zero ineligible selections) and artifact round trip, (9) logistic-hashed above 0.9 on a toy task, (10) every route listed in `state.routes`.

## Limitations
- Simulator results (LinUCB roughly 0.37 to 0.57 mean benefit vs 0.15 to 0.28 for the baselines, unanswered scored 0 by the evaluator only) are simulation outcomes by construction; they say nothing about real people.
- Only the recommendation-relevant hypothesis yields gaps; one question is active per investigation at a time; a deferred question is not resurfaced.
- Procedure-only candidates are assessed weak and never recommend a corrective action.
- Stored historical claims are not mutated by answers; answers are attributed evidence applied at assessment time.
- Vector route is surface similarity only. No model was trained on scenario data; `logistic-hashed` is only checked on a toy task.
- Directory convention (person groups = entity `accessScope.groups`, `role` / `available` attributes) needs confirming with the memory worker.

## Blockers
None.

## Requests
See `contract-requests/investigation.md` (ids on `RecipientEligibility` and `EvaluationRecord`, meaning of `EvaluationRecord.stateFeatures`, person directory fields).

## Fix pass
Reviewer findings addressed (all 62 tests in retrieval/investigation/questions/policies/models pass; `pnpm typecheck` passes; 7 new regression tests in `questions/questions.test.ts`):
- Major, problem-parser: the year rule now needs a hardware context word (old/unit/card/hardware/controller/installed/manufactured); bare "since"/"from" removed. In `investigate()`, an `origin: 'inferred'` condition never settles a distinguishing key (the key stays missing, so the gap and question remain).
- Major, eligibility/cross-investigation: `investigate()` reuses attributed yes/no answers given in other investigations about the same asset set and condition key (evidence must be visible to the principal; outcome answers are never reused), labelled as prior answers. In eligibility, a person who answered elsewhere gets a time-bounded `cooldown` (max of cooldownMinutes and 24h) instead of a permanent `duplicate`; an in-flight question elsewhere is still `duplicate`.
- Minor, answer operators: a yes/no answer is now recorded as agreement with the case condition (reserved values `ANSWER_MATCHES_CASE` / `ANSWER_DIFFERS_FROM_CASE`, understood by `agreement()`), so it works for every operator. Condition-specific templates apply only to `eq` conditions; other operators use the generic wording over the case label.
- Minor, ClaimUpdate.claimId: now always a real Claim id (gap target claim, else the attempt's advice claim, else the case hypothesis/advice claim); no claim means no claimUpdates.
- Minor, idempotent investigate(): `previous` defaults to the stored state for the deterministic investigation id.
- Minor, undo auth: undoing a cancelled question needs the investigation's requester or an agent principal; other undo paths still need the recipient.
Limitations added: reused prior answers have no age limit (suited to inventory facts such as unit revision); no contract changes requested.
