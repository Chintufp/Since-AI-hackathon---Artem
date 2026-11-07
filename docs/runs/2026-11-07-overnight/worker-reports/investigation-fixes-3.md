# investigation-fixes-3

Role: investigation-fixes. Owned paths: investigation/, questions/, retrieval/, policies/, service views.ts and engine.ts (text/view only, no routes).

## Results
- `pnpm typecheck` clean. `pnpm test`: 216 pass, 0 fail (196 before). `node --test 'benchmarks/**/*.test.ts' 'experiments/**/*.test.ts'`: 75 pass, 1 fail (`experiments/harness.test.ts` "runFamily ... case vendor webinar maps to a truth incident"). That failure is not from these changes: `caseIncidents` is computed from the imported store and the truth file only, and it appeared while another worker had uncommitted edits in `src/libs/utils/memory/` (extraction-config.ts, extractor-rules.ts, language.ts). Recorded as a blocker for that worker, not fixed here.
- `node experiments/run.ts e00`: 16/17 checks pass. access-leakage and access-own-scope are PASS for train and validation and access-own-scope PASS for demo. The one remaining failure is `access-leakage:demo` (1/42): `remote-power-access-p3` shows `email:f02-access-310@kalevanet.example`, an e-mail with no ACL metadata, so its stored scope is `org`; the system cannot detect it. Only the truth-based metric sees it. No system-detectable leak remains. (E00 results files in experiments/results/e00-baseline were rewritten by running it; RESULTS.md was not regenerated.)

## 1. Access leak
Reproduced first (`investigation/access-leak.test.ts`: org-visible merged case whose cause, advice, attempts and outcome evidence comes from a group-scoped channel; 4 of 5 tests failed with the private evidence ids in recommendation.basis, hypotheses[].basis and people[].reasons[].evidence). Fix:
- `retrieval/access.ts`: `evidenceGate` (per-evidence visibility: visible refs, "has visible support" = no refs or at least one visible) and `visibleCase`.
- `investigation/visible-candidates.ts`: candidates with no visible evidence dropped; conditions (matching, conflicting, expected traits, missing) whose evidence is entirely invisible removed, a hidden case condition is never reported as unknown, refs trimmed, condition-listing reason strings rebuilt.
- `case-facts.ts` `loadCaseFacts(..., viewer)`: claims/attempts/outcomes with entirely invisible evidence dropped, refs trimmed, case conditions filtered, case undefined when no evidence is visible. `viewerOfState` WeakMap so the assessor (contract only passes the state) uses the same gate.
- `people.ts`: links whose evidence is entirely invisible dropped, refs trimmed. `corpus.ts` applies the same rule, so BM25/trigram never index hidden claims/conditions.
- `views.ts`: `sanitizeState` (candidates, hypothesis/recommendation basis, people evidence), per-evidence filtering of case timeline evidence and sources, `visibleRationale` for the question "why" (drops cited evidence ids and the hypothesis sentence the viewer cannot see). `engine.people()` uses the gate. Tests: `access-leak.test.ts` (5), `apps/service/views.test.ts` (2).
- Documented assumption: an evidence reference whose evidence record is not stored cannot be checked and follows the record that carries it (the synthetic fixtures have no evidence records; imported data always has them).

## 2. Result timeline case
`investigate` records `basisCaseId` (the case of the selected hypothesis, also for none/retain-uncertainty) in the started/rebuilt trace event; `basisCaseId(state)` exported; `ResultView.caseView` uses it, falling back to the case whose hypothesis cites the recommendation evidence for older states. With no related candidate there is no timeline (previously the top-scored lookalike was shown). Checked on the Elisa TRN-088 problem: heading and timeline both TRN-042 while the match list still starts with TRN-117.

## 3. Question slots
`generator-templates.ts`: slot check with fallback "Can you confirm the equipment details for <asset> (<label>)?", whitespace/empty-parenthesis tidy, outcome questions skipped when the attempt is missing or invisible. `questions/question-text.test.ts` scans every generated text (initial, queued, after answer, follow-up, five condition shapes) for double spaces, undefined, null, braces, empty parentheses.

## 4. Text only from the basis case
Root cause on Elisa data: extraction labels "Swapped module 2" in RBS-310 as `sfp.replace`. Presentation fix (the extraction label is the memory owner's): `phrases.ts` `casePhrase`/`actionIsGrounded` with configurable `actionEvidenceTerms` and `unverifiedAction`; an action is named only if the case's visible evidence text contains one of its terms, else "the earlier step" (people: "Performed an action in RBS-310"). Applied in recommend, gaps, people, hypothesis statement and question generator. "gives weak support / qualified applicability" replaced by plain statements. Tests: `text-grounding.test.ts` (synthetic rectifier case with a mislabeled attempt), `apps/service/regression.test.ts` (dev-family-01 plus a rectifier problem: every action phrase in recommendation, people, question text must be an attempt of the cited case). `plainLabel` now turns nested parentheses into a comma clause ("older unit, installed 2016").

## 5. loopReason
`loopReasonFor` fallback so every loop value has a line (views use it; engine passes configured reasons). question-open now reads "Asked <name> because they <contribution> in/on <case or asset>" (`LoopReasons.asked`, `RecipientReason.because`). The coordinator already set a reason for exhausted/question-open on the stored state; the absence seen earlier came from other paths (older stored states), now covered by the fallback.

## 6. Receipt
`engine.receipt`: `You answered yes to "<question>". The recommendation ...` / `You were not sure about "<question>". No new fact was recorded, and you will not be asked this again.`; test scans for status words, dotted identifiers, underscores, undefined/null.

## Deliberately changed assertions
- `questions/questions.test.ts` polish exhausted test: `/Waiting for .* to answer/` -> `/^Asked Site-Five because they observed conditions on Asset-B2$/` (the loop line now says why the person was asked).
No other existing assertion changed.

## Service checks (own instance, port 47855, :memory:, seed elisa; stopped afterwards)
- TRN-088 problem: check-first, "Check the traffic counters before replacing the SFP again.", timeline TRN-042 (the basis), no question needed.
- RBS-310 rectifier problem: text mentions no SFP, interface or other action not in the case ("repeating the earlier step", people "Performed an action and reported recovery in RBS-310"), question "Can you confirm the equipment details for RBS-310 (older unit, installed 2016)?", loop "Asked Ilmari Karjalainen because they reported a problem on RBS-310". The recommendation kind for this problem moved between runs (none -> qualified) because the memory worker's extraction changed under me.
- config-rollback-private through the harness: e00 access checks PASS (train).

## Limitations
- The extraction mislabel itself (module swap read as SFP replacement, "SFP replaced" condition and the "Attempted SFP replacement" timeline node in the case view) is in ingest/memory and unchanged; only wording derived from it in this module is grounded.
- Grounding needs readable evidence text; without it the label is kept.
- e-mail without ACL metadata remains undetectable (demo p3).

## Fix pass

Verified: `pnpm typecheck` clean; `pnpm test` 229 pass / 0 fail; `node --test 'benchmarks/**/*.test.ts' 'experiments/**/*.test.ts'` 77 pass; `node experiments/run.ts e00` 17/17 checks pass (access-own-scope PASS for demo/train/validation; access-leakage PASS for train/validation; demo keeps the one known limitation, the `remote-power-access` email without ACL metadata, which is not system-detectable).

Fixed (each with a regression test):
1. recipients.ts: `findRecipients` now applies the requester's evidence gate (`gate.supported(link.evidence)`) and `visibleCase` for linked cases, same rule as `buildPeople`. A person known only through private evidence is neither asked nor named in `loopReason`. Test: `questions/access-recipients.test.ts` (fails when the gate is removed).
2. eligibility.ts: the recipient's own gate must see the case, the target condition's evidence (age-folded keys included) or the outcome attempt's evidence, otherwise `access` violation. Same test file (fails when removed).
3. coordinator.ts: `answer()` looks the condition up through the gap's `targetCondition.key` over `foldYearToAge(case.conditions)`, so a yes/no to a folded `unit.age` question becomes an observation. `AnswerResult.recommendationChanged` compares kind+text before/after the rebuild; `loopReasons.answeredNoChange` (new setting) and the engine receipt ("Your answer was recorded, and the recommendation did not change.") use it. Test in the same file.
4. recommend.ts: a corrective action that the requester's own text reports as done (`action.performed`, `component.replaced` -> `<x>.replace`) is never recommended again; with a diagnostic the plan is check-first, otherwise a rank-1 `none` ("You already did the SFP replacement; TRN-117 has no other reported fix."). Elisa TRN-088 now gives check-first on TRN-042, caveView = basis case. Contradicted caveat is plain prose ("The problem came back after the module swap."). Test: `investigation/elisa-text.test.ts`.
5. phrases.ts: `config.rollback` phrase entry; fallback handles noun-only compound verbs (rollback, setup, rollout, failover, cutover, backup, shutdown, rerun) and consonant doubling (swap -> swapping). The text scan in `elisa-text.test.ts` rejects "rollbacking", "swaping", "reseting", raw action ids.
6. people.ts: "performed X and reported recovery" is used only if the outcome did not recur; identical reason sentences are shown once (two cases sharing a short label).
7. generator-templates.ts: generic fallback is a yes/no fact, "Is this true for {asset}: {label}?" (changed assertion in `question-text.test.ts`); no label -> candidate skipped; the asset is the one the problem names (unresolved asset-like token such as ACC-33, entities that only belong to the cited case are dropped when such a token exists).

Deliberately changed assertions: `questions/question-text.test.ts` fallback regex (generic wording changed as above).

Not fixed / blockers:
- GET /investigations/:id without principalId and GET /questions/:id without any principal still return the full view. The typed contract (contracts/service.ts) has no principal on those calls and `tests/e2e.test.ts` reads without one, both outside my paths. I tried requiring a principal (engine.getInvestigation), saw tests/e2e fail, and reverted with a comment. A contract change plus a test update is needed.
- TRN-117 extraction attributes the SFP replacement to Helmi and the recovery to the SFP replacement while Aarne performed the reset (people line "Performed the SFP replacement in TRN-117" for Helmi remains). That is memory/extractor territory; the investigation now no longer acts on it for TRN-088.
- Two unrelated `src/libs/utils/memory/pipeline.test.ts` failures appeared mid-run (another worker editing extraction); the full suite was green when I finished.
