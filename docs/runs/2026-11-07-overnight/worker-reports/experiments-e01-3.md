# experiments-e01 (round 3)

Owned paths touched: `experiments/` (new `e01-convert.ts`, `runners-e01.ts`, `e01.test.ts`; edits to `run.ts`, `report.ts`, `README.md`, `harness.ts` (one `export`), regenerated `RESULTS.md`, new `results/e01-extraction/`), `data/replays/README.md`.

## What was added
- `node experiments/run.ts e01`, and `all` now runs e01 right after e00. Manifest is written first, then `results.json`, `decision.json`, `lexicon-gaps.json`, `per-family.json`, `mapping.json`.
- Variants (train and validation scored separately): `rules-extractor@current` (real import path, measured), `claude-agent-arm` (fixtures scored directly, no memory/commit; replay-fixture, route claude-agent-arm), `claude-agent-arm→commit` (same proposals through the real `commitProposal`; replay-fixture).
- Evidence-id mapping is exact (provider + seq / Message-ID / ts to the single non-quoted stored record): 274/274 train and 143/143 validation references mapped, 0 ambiguous, 0 claims dropped.
- For commit, directory ids in the fixtures are translated to the evidence authors' actor ids (commit resolves people by evidence actor ids), then the directory is applied as in the app.
- RESULTS.md has an E01 section stating the arm is a one-shot recorded Claude Sonnet subagent on visible sources, not the proposed small GPT and not an application route.

## Numbers now (claims precision / recall, all types)
| split | rules@current | arm (direct) | arm→commit |
| --- | --- | --- | --- |
| train (4 fam) | 0.227 (10/44) / 0.213 (10/47) | 0.446 (25/56) / 0.532 (25/47) | same as arm |
| validation (2 fam) | 0.154 (4/26) / 0.182 (4/22) | 0.481 (13/27) / 0.591 (13/22) | same as arm |

Rules numbers equal E00. 27 truth claims were recovered by the arm and missed by rules (action 10, observation 5, condition 4, advice 4, outcome 2, access-fact 2): `results/e01-extraction/lexicon-gaps.json`.

## Caveats
- Direct scoring has no derived attempts/outcomes; commit derives them (outcome reporter error 0.31 train, 0.29 validation vs rules 0.50/0.00 on very few items).
- Jaccard >= 0.5 matching punishes paraphrase; six families, one recording pass.
- Independent-support for the direct arm uses the importer's own copy lineage; a no-lineage variant is also reported (equal here, 0 overcounts).

## Blockers / notes
- Full suite: `pnpm test` shows 1 failure outside my paths: `src/libs/utils/questions/questions.test.ts:425` ("exhausted only when the per-investigation question budget is used"), caused by another worker's concurrent edit in src/. Typecheck passes; benchmarks+experiments tests 76/76 pass (6 new).
- Did not run `run.ts all` (E00 access-leak stop rule would stop it before E01 and it would overwrite other results); `e01` and `report` were run alone.
