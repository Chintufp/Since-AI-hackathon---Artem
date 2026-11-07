# experiments

Runner skeleton and result conventions for the experiment queue in the technical handoff (section 6). Experiments use the same core contracts as the application and the evaluator in `benchmarks/`. The system under test never sees hidden truth.

## Status

| ID | Comparison | Status |
| --- | --- | --- |
| E00 | Real-system rules baseline on demo+train+validation (`results/e00-baseline`) | **done**, 17/17 checks pass after the src/ fixes (one documented truth-only residual on demo, tolerated as a known limitation; first provisional run archived in `results/archive-provisional/`; later runs in `archive-rerun-1/` and `archive-rerun-2/`, the latter a complete copy of the queue before run 3) |
| E01 | Extraction/linking: rules extractor vs a recorded Claude-agent arm (replay fixtures, scored directly and committed) | **done** (`results/e01-extraction`; re-run after extractor tuning) |
| E02 | Retrieval: lexical / exact / local trigram / hybrid | **done**, one-shot test confirmation in `results/e02-test` |
| E03 | Question selection: rules vs epsilon-greedy vs LinUCB (simulator arm and family arm) | **done**, rules stay; artifacts in `data/models/` |
| E04 | Assessment: combined vs separate | **done**, one-shot test confirmation in `results/e04-test` |
| E05 | Question generation pool size {1,2,4} (template generator) | **done** (a freer structured generator was not built) |
| E06 | Recipient eligibility: direct-only vs question-dependent | **done** |
| E07 | Coordinator budgets {1,3,5} x cooldown {0,30} | **done** (family arm and simulator budget layer) |
| E08 | Prompted LLM vs adapted small transformer outcome assessor | conditional, not run |
| E09 | Next-choice policy vs sequential RL on multi-step scenarios | conditional, not run |
| E10 | Optional evaluative preferences and alternate reward/feature designs | conditional, not run |

Read `RESULTS.md` (generated from `results/`) for tables, outcomes against the frozen criteria, failure examples and what the results do not show.

## Commands

```
node experiments/run.ts                 list experiments
node experiments/run.ts all             E00, E01, E02, E04, E03, E05, E06, E07, usefulness, then the report (about 3 s; test split closed)
node experiments/run.ts e00|e01|e02|e03|e04|e05|e06|e07|usefulness
node experiments/run.ts e00-reference   evaluator sanity references (hand-built from truth; not a system)
node experiments/run.ts test-final      one-shot test-split confirmation of the E02/E04 choices (refuses to run again)
node experiments/run.ts report          regenerate RESULTS.md
node --test 'experiments/**/*.test.ts'  harness, frozen decision rules, simulator and budget-layer tests
```

## Files

| File | Purpose |
| --- | --- |
| `harness.ts` | Runs the real system (store, import, investigation, question coordinator, selector) over a family's visible inputs; the oracle answers one reply at a time; collects `SystemKnowledge`, recommendations, question runs, evaluation records and latencies. Hidden keys are used only for the oracle and for scoring. |
| `scoring.ts` | Scores harness runs with `benchmarks/evaluator.ts` (plus linking@k, lookalike top-1, access checks). |
| `common.ts` | Variant running, pooled variants, harness-side extra metrics, decision records. |
| `config.ts` | Organization configuration (observability policy for E06), frozen before scoring. |
| `e01-convert.ts`, `runners-e01.ts`, `e01.test.ts` | E01: replay-id -> stored-evidence mapping, recorded proposals -> `SystemKnowledge` (direct) or a committable proposal, the three-variant runner, tests. The arm is one recorded Claude Sonnet subagent, never the small GPT and never an application route. |
| `runners-core.ts`, `runners-learning.ts` | E00/E02/E04/test-final and E03/E05/E06/E07/usefulness runners. |
| `report.ts` | Generates `RESULTS.md`. |

## Results convention

```
experiments/results/<run-id>/manifest.json   written BEFORE scoring (RunManifest)
experiments/results/<run-id>/results.json    per-variant metrics with denominators, failure examples, failure slices by tag
```

- A run id is directory-safe (for example `e03-selectors-2026-11-08`). `writeResults` refuses to run without a manifest.
- The manifest records hypothesis, dataset version, splits, visible inputs, variants with their route (`rules`, `local`, `replay`, `claude-agent-arm`), config, seeds, resource cap, the metrics reported together, acceptance criteria fixed beforehand (empty means "report without declaring a winner") and the stop rule.
- Every variant result carries `provenance`: `measured`, `replay-fixture`, `reference-oracle` or `simulated`. A fixture is never presented as a measured model result.
- Validation criteria are fixed before the test split is opened. The test families are hash-locked in `data/scenarios/TEST_LOCK.json`; `testFamiliesUntouched()` must be true.
- Prefer the simpler baseline when differences are inconclusive; report slices by scenario tag and show denominators.

## Adding an experiment

1. Add the system arms behind the harness so each emits `SystemKnowledge`, recommendations and question runs from visible inputs only.
2. Write the manifest (`writeManifest`), then score with `benchmarks/evaluator.ts`, then `writeResults`.
3. Update the status in `EXPERIMENTS` and in this table.
