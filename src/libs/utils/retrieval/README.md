# retrieval

Candidate retrieval for a new problem: which historical cases/procedures might apply, and how their conditions compare with the problem's.

## Public interface (`index.ts`)
- `HybridRetriever(store, opts)` implements contracts `Retriever`: BM25 + exact-identifier + (optional) local trigram vectors, fused with weighted reciprocal rank fusion (`reciprocalRankFusion`). `Bm25Retriever`, `ExactIdRetriever`, `TrigramVectorRetriever` are the single-route versions.
- `compareConditions(problemConditions, caseConditions, {ignoredKeys, historyKeys})` returns matching / conflicting / missing + `ExpectedTrait`s (status `unchecked`). Same key equal = matching, different = conflicting, case key absent in the problem = missing. `neq` answers (a "No") conflict with an `eq` of the same value and stay unresolved otherwise.
- `buildCorpus(store, principal)`, `canSee(scope, principal)`, `resolveEntityIds(text, entities)`, `Bm25Index`, `TrigramIndex`/`embedTrigrams`, `tokenize`.

## Behaviour
- Corpus text per case = title + visible claim statements + condition labels + entity names/aliases; procedures = purpose + steps + verification + labels. Access scope is applied while building the corpus, so no downstream stage can see a hidden case.
- Exact retriever: entities named by name/alias in the problem text (and `query.entityIds`) boost cases on those entities. Person entities are never matched.
- Vector route: hashed character trigrams, 512 dims, signed hashing, cosine. Route `local`, labelled "not learned". It is a surface-similarity signal, not a trained encoder.
- Weak lexical/vector noise is pruned relative to each list's best hit before fusion (`minRelative`, defaults 0.15 / 0.5). Final candidate score = normalised fusion score + 0.2 x matching fraction - 0.1 x conflicts (bounded), so a lookalike with a conflict is still listed (and then rejected by the assessor) rather than hidden.
- A procedure that cites a visible candidate case is merged into that candidate (`procedureId` set); otherwise it is its own candidate.

## Dependencies
`contracts`, `models/routes` (route labels). No other module.

## Configuration
`RetrieverOptions`: `ageFold` (fold a stated year into an age class; `foldYearToAge`, `isSoftCondition` exported), `vector` (default true), `rrfK`, `weights`, `minRelative`, `ignoredKeys` (identity keys such as `site.id`), `historyKeys` (multi-valued keys such as `action.performed`, which can only match).

## Checks run
`node --test 'src/libs/utils/retrieval/**/*.test.ts'`: 9 tests passing (tokenizer, BM25, trigram vectors, exact-id, all three retrievers and route labels, access filtering, RRF, condition comparison, negative answers).

## Known limitations
- The index is rebuilt per search (fine for tens/hundreds of records; add caching keyed on store revision for more).
- Tokenizer is English-oriented with only plural stemming.
- Trigram vectors capture spelling overlap, not meaning; no learned embedding was trained.
- Condition values are compared as lower-cased strings (numbers for `gte`/`lte`); no unit conversion.

## Fix pass 3: per-evidence access
`evidenceGate(store, principal)` and `visibleCase(case, gate)` (access.ts): a case or claim whose evidence is entirely invisible to the principal is not in the corpus, case conditions keep only visible evidence references, and a case with no visible evidence is skipped. `canSee` on the record scope still applies first.
