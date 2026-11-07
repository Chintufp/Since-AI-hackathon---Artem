# experiments

Runner skeleton and result conventions for the experiment queue in the technical handoff (section 6). Experiments use the same core contracts as the application and the evaluator in `benchmarks/`. The system under test never sees hidden truth.

## Status

| ID | Comparison | Status |
| --- | --- | --- |
| E00 | Frozen scenarios, evaluator, transparent end-to-end baseline | **ready** (evaluator, oracle, splits, references run; baseline arm plugs in) |
| E01 | Extraction/linking: structured baseline vs context-aware proposals | pending harness |
| E02 | Retrieval: lexical vs embeddings/hybrid | pending harness |
| E03 | Question selection: rules vs ranker vs contextual bandit | pending harness |
| E04 | Assessment: combined vs separate support/applicability | pending harness |
| E05 | Question generation: templates vs freer structured proposals | pending harness |
| E06 | Recipient ranking: direct contributors vs observable-condition eligibility | pending harness |
| E07 | Coordinator settings: budgets, cooldowns, stopping | pending harness |
| E08 | Prompted LLM vs adapted small transformer outcome assessor | conditional |
| E09 | Next-choice policy vs sequential RL | conditional |
| E10 | Optional evaluative preferences and reward/feature designs | conditional |

`node experiments/run.ts` prints this list from `EXPERIMENTS` in `run.ts`. `node experiments/run.ts e00` validates the data (leakage, frozen test lock), writes `results/e00-reference/{manifest.json,results.json}` and scores two reference variants (a reference oracle built from truth, and a silent system) on the demo, train and validation splits. Those numbers validate the evaluator; they say nothing about any model and are tagged `provenance: reference-oracle`.

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
