# Decisions · B2 part A (models: providers, storage, retrieval)

Worktree `day2/b2`, branch off `run/2026-11-07-overnight` at e25b6af. Each entry: what, why, how to reverse.

## D-B2-01 · Baseline in this worktree is 384 pass / 1 fail / 2 skipped, not 387 pass
`src/libs/utils/investigation/elisa-text.test.ts` "elisa TRN-088 ..." fails on the untouched branch in this worktree because the Elisa files live only in git-ignored `private/`, which the worktree does not have (the test runs `resetDemo('elisa')` without a `hasElisa` guard). Verified by running it three times with every change of mine reverted. Not changed here (out of scope, and the rule is that code must work without `private/`; the test itself is the one that assumes it). Reverse: nothing to reverse; a `hasElisa` skip guard in that test would make the worktree count 386 pass / 3 skipped.

## D-B2-02 · `SlotChoice`, `ModelSlots` and `DEFAULT_MODEL_SLOTS` live in `contracts/models.ts`; `org-config.ts` re-exports the default
The type is needed by `contracts/outcomes.ts` (UserSettings.models), `contracts/service.ts` and the ui mock, none of which may import the service. `apps/service/org-config.ts` exports `DEFAULT_MODEL_SLOTS` as the organization's configuration point, as the brief asks. Reverse: move the constant back into org-config and import it in the mock from there.

## D-B2-03 · Precedence of slot choices: stored settings > `EngineOptions.models` > all rules
Same pattern as `selectorId` (the host option is the default, the stored user choice wins). `GET /settings` now always carries `models` (an additive field). A models patch merges per slot, so `PUT {models:{embed:...}}` leaves extract and phrase as they were. The `PUT /settings` request type widens `models` to `Partial<ModelSlots>` (additive). Reverse: make the host option win by swapping the spread order in `Engine.getSettings`.

## D-B2-04 · The API key never travels in settings
`settingsPatchSchema` is still `.strict()`, and each slot object is `.strict()` too, so a `key` inside `models` is a 400. Keys go through `POST /models/key` (memory only). Reverse: n/a (a brief rule).

## D-B2-05 · Provider details chosen here
- `keep_alive` default `'30m'` on every Ollama call (matches the warm-up), seed default 7, temperature 0, `think:false` always.
- `warm`/`unload` of an embedding model go through `/api/embed` with `input: []` (verified live on 0.40.9: returns `{"embeddings":[]}`); generative models through `/api/generate` with no prompt (verified: `done_reason: "unload"` with keep_alive 0).
- A 404 whose message says "not found" becomes `ProviderError('model-missing')`, so the status chip can say "not downloaded" rather than "failed".
- `withFallback` has its own deadline (the slot timeout) on top of the provider's AbortSignal, so a provider that ignores its signal still cannot stall a call. The fallback label is `<rules version>[fallback:<slot>:<code>]`, with the full reason in `fallback.reason`.
Reverse: constants in `providers/ollama.ts` and `providers/fallback.ts`.

## D-B2-06 · The api provider has no embed model in this build; vendor is picked from the model name
`ApiProvider.embed` throws `unsupported` (the brief allows "or none, keep local"), so embed=api always falls back to rules with that reason. A model whose name starts with `gemini` goes to Gemini, anything else to Anthropic. Gemini uses `responseJsonSchema`. Reverse: add Voyage / `text-embedding-004` in `api.ts` behind the same key check.

## D-B2-07 · Providers read `globalThis.fetch` at call time
So `installNetworkGuard()` still blocks them in experiments (tested). Tests inject a fake fetch; none needs Ollama or the internet.

## D-B2-08 · r_embedding has its own created_seq counter and an extra (kind, refId) index
Row id is `${kind}:${model}:${refId}`, so one record can carry vectors of several models side by side and switching models never overwrites the other's rows. Its `created_seq` is its own counter (not the global record seq), so the JSON tables' seq and the search rowids are untouched. A second index on `(kind, refId)` serves `deleteRef`, which removes the record's rows for every model. `EmbeddingTable` is declared in `contracts/store.ts` and `KnowledgeStore.embeddings` is optional (additive); `InMemoryStore` has none and callers check. Blobs are copied into an aligned buffer on read. Reverse: drop the table and the field; nothing else reads it.

## D-B2-09 · Case card wording rules
`memory/case-card.ts` reads live condition claims (they carry who said it and the statement the hedge regex reads), then case conditions not already covered; conditions whose key starts with `unit.`, `software.`, `firmware.` or `hardware.` describe the asset (sentence 1), the rest are symptoms (sentence 2). A condition is hedged when it is inferred or its claim statement matches the extraction config's hedge words; the note names the people who said it ("per Erkki Expert, hedged"). The `unit.age` + `unit.installed_year` merge reuses the view config. A performed attempt with no advisor whose past phrase is already a symptom ("SFP replaced") is not repeated. Outcome per attempt: result, and lasting only for recovered/partial. Deviation from the brief's example: the card says "recovered", not "traffic returned", because the rows store the result class, not the phrase (the card must not invent text). Reverse: `CaseCardConfig`.

## D-B2-10 · The embedding list replaces the trigram list in the fusion (not added to it)
The brief names hashed trigrams as the embed slot's rules fallback, so with embed=local the fused lists are bm25 + exact-id + embed; on a failed query embedding they are bm25 + exact-id + trigram, and the route says `+embed[fallback:<code>]`. Embed weight 1 (trigrams had 0.7), relative floor 0.75 of the best cosine, absolute floor cosine 0.3. These are untuned guesses until E08 measures them. Reverse: keep the trigram list in `HybridRetriever.allLists` and lower the weight.

## D-B2-11 · Access rules for embedding hits are stricter than for the lexical corpus
A case-card hit counts only when the requester may see every piece of the case's evidence, because the card summarizes all of it (a merged case with one private message could otherwise rank on the private part). Claim hits need the claim's scope and a visible supporting reference; evidence hits need that evidence to be visible. Everything is then intersected with the access-filtered corpus keys. Reverse: `EmbeddingIndex.search`.

## D-B2-12 · Retrieval may import `models/providers` (contracts-only); the case card is injected
`retrieval/` now depends on `models/providers` for `withFallback` and `EmbeddingCache` (both depend on contracts only), and never on `memory/`: the engine passes `cardText: (id) => caseCard(store, id)`. Reverse: move the two helpers into retrieval.

## D-B2-13 · Automatic model work is opt-in per Engine (`autoModels`), on in main.ts
Background indexing after imports/answers/outcomes, and warming a slot just switched to local, run only when `EngineOptions.autoModels` is true. `main.ts` sets it (unless `KT_AUTO_MODELS=0`); tests and scripts that build an Engine directly do not, so a test that flips a slot to local can never reach a real Ollama by accident. Requests that need a model (an investigation with embed=local, GET /models, a pull) work either way. Reverse: default `autoModels` to true in the Engine constructor.

## D-B2-14 · The catalog stays at `data/models/catalog.json`; `listArtifacts` skips it
As the brief names it; `artifacts.ts` has a small `NOT_ARTIFACTS` set. Installed models not in the catalog are offered per slot by capability (`embedding` for embed, `completion` and not `embedding` for extract and phrase). Availability: installed wins; else Ollama missing; else too large (minRamGb above total RAM); else not downloaded. Reverse: move the file to `data/models/catalog/` and drop the filter.

## D-B2-15 · Status chip rules
`off` for rules. api: `failed: no <vendor> key` until a key is posted, then `ready` (a recorded call failure shows instead). local: a running pull for that model shows `downloading N%`; then a recorded failure (warm, index or query) as `failed: <reason>`; then `failed: Ollama not running|not installed`; then `not downloaded` when `ollama list` lacks it; else `ready`. Changing a slot clears its recorded failure. Model names compare with Ollama's implicit `:latest`. Reverse: `ModelManager.slotStatus`.

## D-B2-16 · `ollama serve` is started as a child the service owns, and stopped on shutdown
When a slot is local, the binary exists and the server is down, `warmSlots` spawns `ollama serve` (not detached) and polls `/api/version` for up to 10 s. On shutdown the service unloads its models (at most 3 s) and kills only a server it started itself; a server Artem started stays. Brew install is not run by the service in this stage (the next stage's UI offers it with a visible log); `GET /models` returns the three setup commands to copy. Reverse: spawn detached in `defaultStartServer`.

## D-B2-17 · Pull jobs are in memory, one running job per model, polled as JSON
The HTTP layer has no SSE, so `POST /models/pull` returns `{jobId, state, percent ...}` and the panel polls `GET /models/pull/:id`. A second click on a model already downloading returns the same job. Jobs do not survive a restart; shutdown aborts running downloads (Ollama resumes a partial pull on the next request). The model name must look like an Ollama tag (`[A-Za-z0-9._:/-]+`). Reverse: `ModelManager.startPull`.

## D-B2-18 · Route count tests updated 32 -> 37
`tests/e2e.test.ts` and `tests/points.test.ts` assert the number of contract routes; both now expect the five new model routes by name. This is the only change to an existing test's expectation.
