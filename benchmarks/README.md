# benchmarks

Deterministic E00 evaluator, person-answer oracle, split/leakage checks and run-manifest conventions for the synthetic scenario families in `data/scenarios/`. This is the **harness side**: it is the only code that reads hidden truth. Nothing under `src/` may import from here.

## Layout

| File | Purpose |
| --- | --- |
| `evaluator.ts` | Pure scoring functions. Every metric is `{value, numerator, denominator}` or `null` when the denominator is zero. Failure examples (`id`, `familyId`, `metric`, `reason`) come with every report. |
| `oracle.ts` | `answerFor(key, personId, question, ctx)` returns `'yes' \| 'no' \| 'unknown' \| 'no-answer'` strictly from the answer key. |
| `splits.ts` | `loadFamilies(split)`, `checkLeakage(manifest)`, the frozen test-family hash lock (`testFamiliesUntouched`). |
| `load.ts` | `loadVisibleInputs(familyId)` (what the system may see) and `loadHidden(familyId)` (keys, harness only). |
| `manifest.ts` | `RunManifest`, `writeManifest/readManifest`, `RunResults` schema under `experiments/results/<id>/`. |
| `reference-systems.ts` | A reference oracle built from truth and a silent system, used to sanity-check the evaluator. Never a measured model result. |
| `text.ts` | Statement normalization and Jaccard. |
| `run.ts` | `node benchmarks/run.ts check` (layout, leakage, test lock) and `reference` (pooled reference scores). |
| `authoring/` | Family specs and `build.ts`, which regenerates `data/scenarios/`. Contains the answer keys; harness side only. |

## Running an implementation without seeing keys

The system under test receives only:

1. `sources/` (Teams JSON, email text, Slack export) and `people.json`, through `loadVisibleInputs(familyId)`;
2. per incoming problem: `id`, `text`, `requester`, `observations` (the `key` is dropped by the loader);
3. oracle answers to questions it actually asks, one reply at a time.

The harness then scores. Skeleton:

```ts
import { loadVisibleInputs, loadHidden } from './load.ts';
import { answerFor } from './oracle.ts';
import { knowledgeAccuracy, recommendationQuality, questionValueAndBurden } from './evaluator.ts';

const visible = loadVisibleInputs(familyId);          // give this to the system
const out = await systemUnderTest(visible);           // -> SystemKnowledge, recommendations, question runs
const { truth, incoming, people } = loadHidden(familyId); // harness only
const k = knowledgeAccuracy(out.knowledge, truth, { people });
const r = recommendationQuality(out.recommendations, incoming.problems, () => familyId);
```

During a simulated investigation the harness answers a question with
`answerFor(problem.key, personId, { conditionKey, expected, scopeEntity }, { people })`. The system never gets `problem.key`.

### What the system must expose to be scored

`SystemKnowledge` = `{ claims, entities, links, cases, attempts?, outcomes?, evidenceSourceIds, independentSupport? }` (contract types).

- `evidenceSourceIds` maps each evidence id to `"<provider>:<sourceId>"`. Source ids are Teams `seq` (string), the email `Message-ID` header value (angle brackets optional; compared after normalization) and Slack `ts`. This is how claims, cases, attempts and outcomes are tied back to truth incidents.
- `independentSupport` is the number of independent supporting sources the system itself counted per claim. If omitted the evaluator assumes the number of distinct supporting sources, so a retelling that is listed as support counts as an over-count.
- Recommendations: `{problemId, kind}` with the contract `RecommendationKind`. Questions: `{problemId, questions: [{conditionKey, recipientId, answered}]}`.

## Metric definitions and denominators

All counts are reported; nothing is rounded into a single score.

- **claims.\<type\>.precision / recall.** A system claim matches a truth claim when the `ClaimType` is equal and token Jaccard of the statements is at least 0.5 (stop words removed), one-to-one, best pairs first. Unmatched system claims with a same-type Jaccard in [0.3, 0.5) or an other-type Jaccard of at least 0.5 are **ambiguous**; claims of type `other` are **unknown**. Both are reported in `counts` and excluded from the precision denominator. The truth claim list is not exhaustive, so precision is a lower bound.
- **entities.recall**, **cases.falseMergeRate** (cases whose evidence maps to two or more incidents / cases mapped to any incident), **cases.falseSplitRate** (incidents spread over two or more cases / incidents touched by any case), `cases.missingIncidents` as a count.
- **attribution.\*ErrorRate**: claim person, attempt performer, attempt performed-state (advice reported as performed or the reverse), outcome reporter, and firsthand links given to people with no firsthand knowledge (the wrong-recipient trap). Unresolvable actors are counted as unattributed, not as errors.
- **copies.overcountRate**: claims supported by a copy/retelling whose independent-source count exceeds the truth count. A retelling may copy several originals (one `copies` row per parent); a copy adds no independent source when any original it retells is already among the claim's supporters.
- **resolution.falseSolvedRate**: cases claimed `verified-resolved` while truth `lasting` is not `confirmed`, over cases whose truth is not confirmed. `resolution.statusAccuracy` plus a confusion table. A reported recovery is not a verified one.
- **recommendation.\***: `kindAccuracy`, `supportedApplicableRate` (issued while the key says reuse/qualified, over issued), `falseAdviceRate` (any issued kind, i.e. reuse, check-first OR qualified, when the key says inapplicable/none, over issued), `majorityBaselineKindAccuracy` (constant majority-class baseline to read kindAccuracy against), `eligibleCoverage`, `missedOpportunityRate` (none/retain-uncertainty when the key expects reuse).
- **question.\***: `gapFoundRate`, `unnecessaryQuestionRate` (questions where `noQuestionNeeded`), `wrongRecipientRate` (recipient not in `consequentialGap.answerers`), `questionsPerInvestigation`, `unansweredRate`; counts for missed gaps, hard-rule violations (passed in) and the largest per-person interruption count.
- **incomingLinking**, **accessLeakage** (a shown source belongs to an incident whose access groups exclude the requester), **efficiency** (latency; calls/tokens are `null` when not measured, never 0).
- **sliceFailuresByTag** groups failure examples by family scenario tags.

`expectedRecommendation` in a key is the class the system should end with **after** the key's answer for the one consequential gap has been revealed (or after it proved unanswerable). Multi-step problems list their steps in order in `distinguishingConditions` and have answers for more than one key.

## Checks run

`node --test 'benchmarks/**/*.test.ts'` covers: evaluator behaviour on tiny hand-made inputs (a perfect system scores 1.0 or 0 error everywhere, each known-wrong system lowers the specific metric, null denominators stay `null`); oracle semantics; split leakage over the real `families.json` and on synthetic violations; manifest round trip; schema and consistency checks over every real family (file layout, Teams seq / email Message-ID / Slack ts derivation, people mapping, key-versus-knowledge consistency, tag coverage, no organizer text, no hidden truth under `src/`); and the reference oracle scoring 1.0 across all families.

The repository `pnpm test` script covers `tests/` and `src/` only; run the benchmark tests with the command above.

## Known limitations

- Statement matching is lexical (Jaccard). Paraphrases with little word overlap count as misses; ambiguity is reported, not hidden.
- Keys were authored by one agent in one pass and are **unreviewed**; results remain provisional until the review in `data/scenarios/REVIEW.md` is complete.
- `incoming.json` keys carry one consequential gap per problem; multi-step behaviour is encoded through ordered conditions and answers, not a separate contract field.
- The evaluator cannot see why a system produced an output; it never gives credit for correct kind with a wrong rationale.


## Fix pass (reviewer findings)

- **Question metrics obey the hard eligibility rule.** `questionValueAndBurden(..., { unavailable })`: a gap nobody available can answer (`gap.unanswerable`, or every answerer unavailable) leaves the `gapFoundRate` denominator (asking no one is correct; reported in `question.gapsNobodyAvailableCanAnswer`); a question to an unavailable person is counted in `question.askedUnavailable` and added to `question.hardRuleViolations`. The reference oracle (`perfectQuestionRuns(problems, people)`) now skips unavailable answerers.
- **Gap-found matching** uses the key's decisive conditions (`distinguishingConditions`), minus conditions the requester already observed; unrelated answerer-known keys no longer count.
- **Oracle**: unscoped answers are not reused for questions about another entity; boolean complements (`=true: no` is `=false: yes`) and valueless questions (a known yes for the key answers yes) are answered.
- **Actions**: truth uses a few finer actions than contracts `ACTIONS`; `benchmarks/actions.ts` declares them with their canonical roll-up. System attempts match exact action first, then canonical roll-up, each truth attempt once. Unmatched system attempts are reported as `attribution.attemptsNotInTruthRate` plus failure examples. (actions.ts imports the `ACTIONS` value from contracts; the evaluator otherwise imports types only.)
- `benchmarks/run.ts reference` excludes the test split unless `--include-test` is passed.
