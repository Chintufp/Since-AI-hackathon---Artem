# policies

Selectors that choose one eligible question-recipient pair, or defer. Hard eligibility is applied before them; they only see `eligible` pairs and visible features.

## Public interface (`index.ts`)
- `RulesSelector`: deterministic baseline. score = consequential x (firsthand ? 1 : 0.6) x 1/(1 + openQuestionsForPerson) x recency (unknown recency = 1). Defers when nothing is eligible or the best score < threshold (default 0.2). Propensity 1.
- `LinUcb`: LinUCB contextual bandit, one shared linear model over the features `consequential, firsthand, recipientOpenQuestions, recipientAskedToday, candidateCount, gapDecidesApplicability, hypothesisSupportLevel` (plus bias). `alpha` configurable; `update(records)` learns only from records with a known `assessedBenefit` (null = unknown is skipped, never 0; `stateFeatures` of a record are the features of the chosen action); `toArtifact()`/`toModelArtifact()`/`LinUcb.fromArtifact()` JSON round trip. Route `local`; deterministic (propensity 1).
- `EpsilonGreedy` (non-contextual: running mean per recipient, epsilon-random exploration, real propensity) and `randomSelector` (epsilon = 1): simulator baselines.
- `RankerReplaySelector`: route `replay`. Plays back a recorded ranking from a `ReplayProvider` (input hash must match the eligible set). Without a matching recording it returns an explicit `blocked: ...` decision made by the rules selector and labelled route `rules`; it never simulates an LLM ranker.
- `createSelector(id)`: `rules | linucb | epsilon-greedy | random | ranker-replay` (aliases `bandit`, `ranker` from `CoordinatorSettings.selectorId`). `actionKey`, `vectorize`, `FEATURE_NAMES`.

## Dependencies
`contracts`, `models` (rng, replay). The simulator in `models/testing` repeats the feature names as literals so `models` does not depend on `policies`.

## Checks run
`node --test 'src/libs/utils/policies/**/*.test.ts'`: 10 tests passing. On the simulator (300 steps, seeds 1/2/3; mean benefit with unanswered scored 0 by the evaluator) LinUCB at alpha 0.5 scored about 0.39/0.57/0.37 vs epsilon-greedy 0.17/0.28/0.22 and random 0.17/0.21/0.15 (rules about 0.29/0.43/0.29); no selector ever chose an ineligible action. This is a simulator result, not evidence about real people.

## Known limitations
- The simulator's benefit depends on the visible features by construction (firsthand knowledge, decisive gaps), so the LinUCB advantage shows only that the contextual model can learn them.
- Learning skips unanswered outcomes, so it cannot learn to avoid unresponsive people from missing feedback alone.
- LinUCB ignores `defer` as an arm (optional `deferBelow` threshold only); one global model, no per-person parameters.
- Next-choice versus whole-investigation optimisation (U01) is not addressed.

`RulesSelector` order (D-B2-67, brief 5.3): the score above is the gate (defer when no pair reaches the threshold); among the pairs that pass it the highest value / cost (`value-cost.ts`: consequential x p(answer) x expected gain in completeness x correctness x retrieval weight, over 1 + burden / BURDEN.open) is asked, then the score, then the key. Without an `expectedGain` feature the order is the score alone. The ranking compares the candidates of one investigation state; investigation gaps come before standing gaps by flow (an investigation asks at once, `askStanding` skips anyone with an open question), not by this formula. LinUCB does not start from this order: ridge prior only, and `vectorize` leaves out `expectedGain`, `retrievalWeight` and `quietHours` (D-B2-74).
