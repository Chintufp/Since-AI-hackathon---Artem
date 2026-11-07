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

# Decisions · B2 part B (extraction, phrasing, reward, Settings UI)

## D-B2-19 · The extract model runs inside POST /import, awaited, with one 60 s budget for the whole import
`Engine.importAndEnrich` (POST /import; "Remember this" will post there too) runs the sync rules import first, then, when the extract slot is on local or api, the model over the same threads (`memory/enrich.ts`), all calls sharing the slot's 60 s deadline. It is all-or-nothing: if any call fails, times out or returns output that does not match the schema, nothing from the model is committed and the response's `extraction.route` is `rules-extractor@1[fallback:extract:<code>]` with the reason; the rules import is complete either way. Chosen over a background pass because the brief wants the import result to say what the model did, and the panel has no import-progress polling. `Engine.importData` stays synchronous and rules-only, so `demo:reset`, the experiments harness and every existing caller are byte-identical; a demo reset with extract=local therefore imports rules-only (re-import through POST /import to enrich). Reverse: call `importAndEnrich` from `resetDemo`, or move the pass into `afterChange` as background work.

## D-B2-20 · The union is two commits: rules first, then the model's proposal re-keyed to the rules incidents
`unionProposal(rules, model)` keeps the rules incidents (episode keys, so no second case), drops model claims that restate a rules claim (same type and same words, or same type on the same message with overlapping spans), drops the model's incidents and usefulness labels, does not repeat a link the rules already proposed, and re-sends the rules observation claims of non-asset incidents so those incidents still count as problems (they already exist, so they keep 'rules'). Because `commitProposal` never relabels an existing claim, claims the rules produced keep `extraction.route = 'rules'` and only model-only claims get `{local, 'ollama-extract@1:<model>'}` (or `api-extract@1:<model>`). No contract change (no per-claim route field). A model claim whose wording is outside the rules lexicon is stored but creates no attempt or outcome row (case-builder re-derives those from wording). Reverse: add `ProposedClaim.route` and merge into one proposal.

## D-B2-21 · Validator rules
Schema mismatch throws (fallback). Per item, every EvidenceRef must name a message of this thread and its excerpt must be found in that message's `extractionText` (exact, else with any whitespace run matching any whitespace run); one bad ref drops the whole claim, entity or link, and the drop is reported. Spans are set from where the excerpt sits and the excerpt is replaced by the verbatim slice. A link to a person not in the thread is dropped; an asserter not in the thread is replaced by the first cited message's author (never invented). Entity attributes are not in the model schema (the rules and the claim-to-attribute path fill them). `confidence` is kept and never read. Reverse: `validateExtraction`.

## D-B2-22 · memory/ now depends on models/providers (contracts-only) and zod
For `withFallback`, `SLOT_TIMEOUT_MS` and the zod schema that is both the validator and (through `z.toJSONSchema`) Ollama's `format` / the api tool schema. Same reasoning as D-B2-12. Reverse: move `enrich.ts` into the service.

## D-B2-23 · How provenance shows on a node
A statement a model proposed gets "(proposed by local model qwen3:4b, committed by rules)" after it in the node detail (problem, possible cause, suggested checks); the conditions node gets a trailing "Some of these were proposed by ...". `TimelineNode.provenance?: string[]` (additive) carries the same text for the panel. An api route says "hosted model". Nodes built only from rules claims are unchanged. Reverse: `memory/provenance.ts` and the `tag` helper in case-view.

## D-B2-24 · Defaults for an api slot without a model name
extract: `claude-haiku-5-5`, phrase: `claude-sonnet-5-5` (the brief's names). An api slot without a key for that vendor falls back with code `disabled` and the chip shows the reason. Reverse: `Engine.slotModel`.

## D-B2-25 · Phrase validator details (`validatePhrase`, exported for B7's kt_propose_question)
One line, one sentence (no inner `?`, no `. ! ;` followed by more text), ends with `?`, at most 159 characters, opens with Is/Are/Was/Were/Does/Did/Has/Have/Can/Could/Should, and none of the template-scan defects (double space, undefined, null, empty parentheses, braces, space before punctuation). "Names the asset / condition label / action noun / case label": asset-like ids must appear; otherwise the significant words (first four letters, stop words out). When a template is given, only the words the template itself uses for that label are required (the template "Is TRN-301 an older unit?" names the label "older unit revision, 2019" by "older" only, so a phrasing must too); without a template at least half of the significant words. "Introduces nothing new": every asset-like id, every number outside an id, every capitalized word after the first, and every action word (a stem list: replac, swap, reboot, reset, roll, upgrad, ...) must also occur in the input (gap, what the answer changes, case label, the visible case facts, the template sentence, the problem text). The input deliberately excludes the prompt's instructions. Untuned; a false rejection only costs the template wording. Reverse: `generator-phrased.ts`.

## D-B2-26 · Phrase calls run per candidate in parallel, each within the slot's 20 s, as JSON `{question}`
Uses `generateJson` with a one-field schema (same provider surface as extract, so the api provider's forced tool works too). The generator's `route` is a getter for the last run: the phrase route when any wording was accepted, the template route marked `[fallback:phrase:<code>]` when a call failed, else the plain template route; this is what lands in `state.routes`. Per candidate, `phrasing: {by:'model'}` or `{by:'template', reason}` and `templateText` are additive fields on QuestionCandidate; `generatedBy` changes only when the wording was accepted. Reverse: `PhrasedQuestionGenerator.generate`.

## D-B2-27 · questions/ depends on models/providers; the template generator exposes `generateDetailed`
`generateDetailed` returns each factual candidate with the facts it was built from (asset, condition label, action noun, case label, gap, problem text, template text); `generate` is that plus the evaluative pair, so the rules path is unchanged (question-text tests untouched and green). Reverse: inline the facts into the phrased generator.

## D-B2-28 · Honesty lines in the panel
The question card shows "Worded by local model qwen3:8b" under the why line (italic, small) with the template wording as its tooltip; `QuestionView.wordedBy` / `templateText` are additive. The result card lists model participation from `result.routes` in plain words (matched by meaning with local model bge-m3; question worded by ...; a model was not available, rules used); with every slot on rules nothing new is shown. Case-node provenance is part of the node detail (D-B2-23).

## D-B2-29 · Store metric definitions where the brief leaves room (`memory/store-health.ts`)
- symptom: a live observation claim with a supporting reference.
- distinguishing: the brief's "every key has a value" would almost never be filled on this data (cases rarely state all four keys), so one answer could never move it. The slot counts known keys proportionally (3 of 4 known = 0.75); "filled" for the singleton count still means all known. A key is known from a case condition or condition claim with a value (or operator `absent` = explicitly not applicable), from its alias (`unit.age` from `unit.installed_year`), or from an answered question recorded on that case.
- attempt: a performed attempt with a performer.
- outcome: any outcome row of the case, an answered outcome question on it, or an outcome report naming it. Not only rows of "the corrective attempt": the case builder sometimes attaches the outcome to the check that preceded the fix (RTR-117 does), which would read as no outcome.
- lasting: an outcome or report whose lasting is not unknown.
- validity: the advice claim (the corrective attempt's, else the first) has a known `from` and a `to`, a condition, or a "supersession check" newer than 90 days, read as an answer that supported or contradicted that claim in the window (B1's supersession records can be added here).
- Store completeness: weighted by investigations (updated in the last 30 days of the engine clock) whose candidates cite the case; with no retrievals the unweighted mean is used and `denominators.retrievals = 0` says so.
- Correctness: denominator = live case-bound claims (the brief's "cited claims", i.e. what retrieval can cite); supported = >= 2 independent sources counting supporting answers as sources, or the advice of an attempt with an observed recovery; contradicted-and-cited = status contradicted (or more contradicting than supporting answers) and among the source claims of a standing recommendation (anything but none / retain-uncertainty); links made without an answer come from an injectable `links` hook, 0 until B1's pairing links exist. Null (not 0) when there is no claim.
Reverse: `storeHealth` options and `caseHealth`.

## D-B2-30 · Reward = delta(completeness x correctness of the touched cases) - burden
Touched cases = the gap's case. Measured before the answer is stored and after the rebuild (the rebuilt investigation is stored first so its retrieval counts). Burden = 0.02 x questions delivered to the recipient today (other than this one) + 0.02 x their other open questions + 0.05 inside quiet hours (read from `settings.coordinator.quietHours` when B1 adds it; absent today). Untuned. An 'unknown' answer is a real measurement (usually value = -burden); no answer (deferred, dismissed, expired: response 'none') never writes a benefit, so it stays null. Written to `EvaluationRecord.assessedBenefit = {value, method: 'store-metric-delta@1'}` and `QuestionRecord.reward` (additive). Reverse: `QuestionCoordinator.measure/burden/learn`.

## D-B2-31 · Live `selector.update` after every measured benefit, again when an outcome lands
`answer()` calls `selector.update([record])`; `Engine.recordOutcome` calls `coordinator.rewardOutcome`, which re-measures the answered outcome questions of that investigation and, when the number changed, updates the same evaluation row and calls `update` again (LinUCB then learns from that decision twice, once per measured value; the brief asks for exactly this). A selector error never breaks an answer. The rules selector has no `update`: its formula stays the fixed prior. Reverse: drop the `learn` call.

## D-B2-32 · Live LinUCB state in data/local/linucb-live.json; Undo does not unlearn
After each update the service writes the LinUCB artifact (id `linucb-live`, dataset `live`) next to the file database (data/local/, git-ignored), never data/models; `Engine.selector('linucb')` loads it at first use (a file from another feature list is ignored). `:memory:` and provided stores keep it in memory only (tests); `EngineOptions.linucbStatePath` overrides, `false` turns it off. Undo of an answer withdraws the answer but not what the bandit learned (LinUCB has no exact downdate in this build and the measured change did happen); the old `reward` stays on the question as history and a new answer learns again. Reverse: rebuild LinUCB from the evaluation rows minus undone answers.

## D-B2-33 · store-health lives in memory/; questions/ imports it
It reads only store records. `investigation` constants it needs (outcome key, distinguishing keys) are passed in. Reverse: move it to investigation/.

## D-B2-34 · Settings -> Models is its own panel view, opened from one Settings row
The old disabled Provider select and the Model text row are replaced by a "Models" row (summary such as "all rules" or "local: find, read · hosted: word") with an Open button, like Points. The view lists the three slots ("Find by meaning", "Read threads", "Word questions") with a rules/local/hosted segmented choice, the chip from GET /models (state colours: grey off/not downloaded, green ready, gold downloading, muted red failed), for local a model select from the catalog plus installed models (recommended marked, size, availability; a too-large entry is disabled with "Too large for this Mac: needs about N GB"), its "why", and a Download button that POSTs /models/pull and polls GET /models/pull/:id every second with a progress bar. Each change is a PUT /settings with only that slot. Hosted "embed" is shown but disabled (D-B2-06). Mock: richer catalog (sizes, a too-large qwen3:32b on a 24 GB mock machine) and the install route. Harness: one shot `models` appended after `closed-again` so the existing shots keep their numbers (not run in this stage; it needs Electron and the committed PNG set). Reverse: restore the two rows in `panel.ts`.

## D-B2-35 · Installing Ollama from the panel: POST /models/install runs `brew install ollama` with a visible log
Two routes (POST and GET /models/install; route count 37 -> 39). macOS with Homebrew at /opt/homebrew or /usr/local: the service spawns `brew install ollama`, keeps the last 200 output lines for the panel (polled each second, last 8 shown), and on success starts `ollama serve` as an owned child (stopped on shutdown, D-B2-16). Without Homebrew the job is `unavailable` and the panel shows the download link (https://ollama.com/download) plus the three commands with Copy buttons. Only a click starts it; tests inject a fake installer. Reverse: drop the two routes; the panel then shows only the commands.

## D-B2-36 · API keys: Electron safeStorage in main, the service gets them in memory only
`src/apps/desktop/keychain.ts` (pure, tested with a fake safeStorage): the preload exposes `saveModelKey(vendor, key)`, validated in preload and again in main (vendor anthropic|gemini, printable ASCII, at most 400 characters, empty = forget). Main encrypts with `safeStorage` into `<userData>/model-keys.json` (mode 600; never the repo or data/; only ciphertext), then POSTs the key to the service (`POST /models/key`, memory only, D-B2-04); after each service start main hands the stored keys over again. When the OS offers no encryption nothing is written and the key lives only in the service's memory. In the browser mock or without the bridge the panel posts the key straight to the service and says it lasts until a restart. The Test button calls POST /models/test and shows the model that answered; a link opens the vendor's key page. Not exercised live (no key, no network in this stage). Reverse: drop the IPC; keys then go through POST /models/key only.

## D-B2-37 · Engine.storeHealth() exists for scripts and B3, without a route
The brief puts the numbers on the activity page and the slides (5.5), which B3/B6 build; adding a route now would add a contract, a client method and a mock for a screen that does not exist yet. Reverse: add `GET /store/health` mapping to `engine.storeHealth(principalId)`.
