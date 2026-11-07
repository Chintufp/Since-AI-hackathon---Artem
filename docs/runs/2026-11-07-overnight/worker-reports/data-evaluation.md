# Worker report: data/evaluation owner (E00 foundation)

## Built

- `data/scenarios/`: 10 synthetic families (demo 2, train 4, validation 2, test 2) with Teams JSON, email text files and Slack export folders, `people.json`, hidden `truth.json` and `incoming.json` (30 problems), `families.json`, `TEST_LOCK.json` (hashes of the two test families) and `REVIEW.md` (label definitions, authoring procedure, ambiguities, reviewer checklist). Every tag is covered by at least two families (verified by a test).
- `benchmarks/`: `evaluator.ts` (knowledge accuracy, resolution accuracy, recommendation quality, question value and burden, incoming linking, access leakage, efficiency, failure slices by tag), `oracle.ts`, `splits.ts` (loaders, leakage check, test-lock flag), `load.ts` (visible vs hidden loaders), `manifest.ts` (RunManifest, results schema), `reference-systems.ts` (reference oracle and silent system), `text.ts`, `run.ts`, `authoring/` (specs and deterministic builder), README.
- `experiments/`: `run.ts` skeleton listing E00 to E10 (E00 ready, E01 to E07 pending harness, E08 to E10 conditional; `e00` command runs and writes `results/e00-reference/`), README, `results/` directory convention.

## Tests

`node --test 'benchmarks/**/*.test.ts'`: 54 passed, 0 failed. `pnpm typecheck`: passes for the whole repo.
Coverage: evaluator on tiny hand-made inputs (perfect system 1.0 or 0 error everywhere; wrong-claim, type-confusion, false merge, false split, wrong person, performed-state, outcome reporter, firsthand link, copy over-count, false solved, false advice, missed opportunity, constant silence; null denominators stay null); oracle (key-only answers, single-valued inference, unknown, unavailable and unanswerable no-answer, scope); splits leakage on the real manifest and on synthetic violations plus the test-lock flag; manifest round trip and validation; per-family schema and consistency (file layout, Teams seq, email Message-ID, Slack ts, people mapping, key versus knowledge, tag coverage, organizer text absent, hidden truth absent from `src/`, visible loader exposes no keys); reference oracle scores 1.0 or 0 error across all families.

## Limitations

- Keys are unreviewed (single-author, single pass); everything scored on them is provisional. See `data/scenarios/REVIEW.md` for 12 ambiguities and a reviewer checklist.
- No derived or paraphrase families exist, so `derivedFrom` is untested on real data (tested on synthetic manifests only).
- Claim matching is lexical; the truth claim list is not exhaustive, so precision is a lower bound.
- One consequential gap per problem in the contract: multi-step is encoded through ordered conditions and answers.
- The reference oracle is built from truth and validates the evaluator only; it is not a measured model.
- No end-to-end baseline arm was run, since the ingest/memory/retrieval/investigation modules are other workers' paths and the harness wiring is pending.

## Blockers

None. I did not run `pnpm test` for the whole repo because the root script does not include `benchmarks/`.

## Requests

See `docs/runs/2026-11-07-overnight/contract-requests/data-evaluation.md` (document `by` ids, email id convention, optional steps/interim recommendation fields, add benchmarks to the `test` script, accept extension condition keys).

## Fix pass

Findings addressed (all majors, plus the cheap minors):
- question.gapFoundRate no longer penalizes obeying the eligibility rule: unreachable gaps (unanswerable or all answerers unavailable) leave the denominator; asking an unavailable person is a hard-rule violation (`question.askedUnavailable`, added to `hardRuleViolations`). `perfectQuestionRuns` now skips unavailable answerers; test asserts the reference oracle has 0 violations on every real family.
- falseAdviceRate counts any issued kind (reuse/check-first/qualified) on inapplicable/none problems; added `recommendation.majorityBaselineKindAccuracy` (13/24 = 0.542 on non-test problems).
- Oracle: unscoped answers are not applied to other scopes; boolean complements and valueless questions answered.
- Actions: `benchmarks/actions.ts` declares the 12 extension actions with canonical roll-up; evaluator matches exact then canonical; unmatched system attempts become `attribution.attemptsNotInTruthRate` and failure examples; test checks every truth action is declared.
- `benchmarks/run.ts reference` excludes test split unless `--include-test`.
- bgp-firmware-flaps-p1 answerers include Hanna; optic-forwarding-a-p2 includes Helmi as answerer; gapConditionKeys now uses decisive conditions minus requester observations (config-rollback-private-p1 decisive condition corrected to `config.rollback_supported=false`).
- Copies: multi-parent supported (spec, builder, evaluator); handover email copies teams:1 and teams:9; independence counted per claim.
- changed-permissions: documented as static restricted access only (not realized as a change over time); contract tag cannot be renamed.

Tests: `node --test 'benchmarks/**/*.test.ts'` 62 pass / 0 fail; `pnpm typecheck` passes; `node benchmarks/run.ts check` OK (test lock unchanged, test families not edited).

Remaining: in frozen test family transponder-laser-p1, ismo-vainio can observe a gap key but is not an answerer (same class as the Helmi finding); not edited to keep the test lock. The new audit test skips the test split. Contract request: none (a `conditionKey` on consequentialGap would remove the gapConditionKeys heuristic).
