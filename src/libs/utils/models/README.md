# models

Explicit routes, replay, small local models, model artifacts and test doubles.

## Public interface (`index.ts`)
- `routes.ts`: `ROUTE_REGISTRY`/`routeInfo(key)` (every stage's route label), `uniqueRoutes`, `assertRouteInfo` (replay versions must start with `replay:`), `blockedProviderCall(name)` (always throws `NetworkProviderBlockedError`), `installNetworkGuard()` (replaces `globalThis.fetch` with a thrower; returns restore).
- `replay.ts`: `ReplayProvider<T>` loads JSON fixtures `{id, entries: {key: {inputHash, output, recordedBy}}}`; `get(key, input)` returns `undefined` when nothing was recorded and throws `ReplayMismatchError` when the live input hash differs. `hashInput` is key-order independent.
- `logistic-hashed.ts`: `LogisticHashed` (hashed unigram+bigram features, seeded SGD logistic regression, `predictProba`, `accuracy`, `toArtifact`/`fromArtifact`).
- `artifacts.ts`: `saveArtifact`/`loadArtifact`/`listArtifacts` for `data/models/<id>.json` (id validated; directory overridable).
- `providers/` (B2): the model layer's providers, contracts-only imports. `types.ts` (`ModelProvider`: embed, generateJson, generateText, warm, unload, detect, pull; `SLOT_TIMEOUT_MS` embed 5 s / extract 60 s / phrase 20 s; `ProviderError` codes), `ollama.ts` (`OllamaProvider`, injected fetch, loopback Ollama: /api/version, /api/tags, /api/embed, /api/generate with think:false, temperature 0, seed, format, keep_alive; /api/pull NDJSON; unload = keep_alive 0), `api.ts` (`ApiProvider`: Anthropic Messages with the schema as a forced tool, Gemini generateContent; refuses unless `{enabled: true}` and a key were given), `fallback.ts` (`withFallback(slot, call, rulesFn, {route, rulesRoute})` returns `{value, route, fallback?}`; the fallback route is `<rules version>[fallback:<slot>:<code>]`), `embed-cache.ts` (`EmbeddingCache` keyed by model + sha256(text), `textHash`).
- `rng.ts`: seeded `createRng`, `shuffleInPlace`.
- `testing/in-memory-store.ts`: `InMemoryStore` implements the full `KnowledgeStore` (deep-cloned records, `where`/`orderBy`/`limit`, term-overlap `searchText`, rollback `transaction`). Requires a string `id` on each record; types whose contract record has no `id` (evaluation, eligibility) must be stored with one added.
- `testing/fixtures.ts`: record builders and `buildSyntheticStore(options)`: neutral synthetic org (reference case with a diagnostic check then a corrective action on an older unit, an earlier case on another asset with a firsthand observer, distractor incidents, a group-restricted lookalike) plus people/principals.
- `testing/simulator.ts`: `SelectionSimulator`, `runSimulation(selector, {seed, steps})`, `defaultSimConfig(seed)`. Hidden knowledge (who knows which fact, answers, responsiveness, truth) stays in the simulator; selectors see eligible pairs and visible features only. Benefit: 1 for a definite correct answer on a decisive gap, 0 when nothing changes, `null` when unanswered (never 0).

## Dependencies
`contracts` only. No other module imports are allowed here (retrieval, investigation, questions and policies depend on `models`).

## Checks run
`node --test 'src/libs/utils/models/**/*.test.ts'`: 5 tests passing (toy task accuracy above 0.9 and determinism, artifact round trip in a temp dir, replay hash check, route guard and labels, in-memory store behaviour). Simulator behaviour is covered in `policies/policies.test.ts`.

## Known limitations
- `logistic-hashed` is exercised on a toy task only; it is not yet trained on scenario data (that belongs to the experiments).
- The route guard only blocks `fetch` and explicit provider calls; it cannot stop arbitrary sockets.
- `InMemoryStore.searchText` is a simple term-overlap scorer, not the SQLite full-text behaviour.
