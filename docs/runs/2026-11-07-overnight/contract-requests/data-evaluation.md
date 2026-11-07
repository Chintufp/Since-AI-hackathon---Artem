# Contract and tooling requests from the data/evaluation owner

None blocks work; everything was worked around locally.

1. **`ScenarioTruth` person fields.** `expectedClaims[].by`, `attempts[].by`, `outcome.reportedBy` and `knowledge` keys are typed `string`. The data uses directory person ids (`person:directory:<slug>`). Suggest documenting this in `contracts/scenarios.ts`.
2. **Email source id form.** Truth uses `email:<Message-ID header value>` including angle brackets. The evaluator normalizes brackets, so adapters may strip or keep them; suggest the ingest module state its convention.
3. **Multi-step problems and expected recommendation timing.** `IncomingProblems[].key` has one `consequentialGap`. Multi-step is encoded through ordered `distinguishingConditions` and extra `answers`. `expectedRecommendation` is the class after the key's answer is revealed. An optional `steps` array and an `interimRecommendation` would make this explicit; not needed for E00.
4. **`package.json` test script.** `pnpm test` covers `tests/` and `src/` only. Suggest adding `'benchmarks/**/*.test.ts'` so the 54 benchmark tests run with the rest.
5. **Extension condition keys.** Nine keys outside `CONDITION_KEYS` appear in observations and answers (`interface.crc_errors`, `power.mains_sag`, `power.breaker_inspected_at_first_visit`, `power.scope`, `site.access_code_current`, `cable.condition`, `cable.guard_fitted`, `config.saved_startup`, `config.rollback_supported`). Suggest the memory/investigation modules accept unknown dotted keys from configuration.
