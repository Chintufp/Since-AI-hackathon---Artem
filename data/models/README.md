# data/models

Local learned artifacts trained tonight on this Mac from synthetic data (pure TypeScript, no network). All are versioned JSON written by `src/libs/utils/models/artifacts.ts`.

| Artifact | Kind | Trained on | Used by |
| --- | --- | --- | --- |
| `linucb-e03-seed1.json`, `-seed2`, `-seed3` | LinUCB (alpha 0.5) | train families, online from harness-labelled evaluation records (3 training orders) | E03 family arm only; **not shipped**, rules stay the default selector |
| `usefulness-logistic-v1.json` | hashed logistic regression (4096 dims) | train families' evidence, labelled useful/irrelevant by truth incident membership (harness side) | evaluated in `experiments/results/usefulness-logistic-v1`; not wired into the application |

Regenerate with `node experiments/run.ts e03` and `node experiments/run.ts usefulness`. See `experiments/RESULTS.md` for metrics and limits.

`catalog.json` is not a learned artifact: it is the editable model catalog for Settings -> Models (B2), one list per slot (embed / extract / phrase) with size, dims or context, a one-line why, minimum RAM and the recommended entry. `listArtifacts` skips it.
