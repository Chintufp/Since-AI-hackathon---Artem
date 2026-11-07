# memory

Local SQLite store, rules extraction, evidence-backed memory commit, corrections and the case view.

## Public interface (`index.ts`)
- `openStore(path | ':memory:', {disableFts?})` -> `KnowledgeStore` (+ `searchMode`). One table per record type (`id`, `json`, `created_seq`), `json_extract` filtering (dotted paths allowed, names validated), expression indexes on caseId, personEntityId, investigationId, status, orgId, questionId, `lineage.sourceFingerprint`, `metadata.sourceKey`, `thread.threadId`. `searchText` uses FTS5 when available (score = -bm25, higher is better) else term overlap (score = fraction of query terms present). Nested `transaction()`; `clear()`.
- `importFromPath(store, {format, path|payload, connectionId?, orgId, accessGroups?, now?, config?})` -> `{batch, cases, claims, entities, people}`. Formats `teams-json`, `email-text`, `slack-export`, `paste`, `scenario-dir` (reads only teams*.json, text emails and Slack export folders; ignores `truth.json`/`incoming.json`). Wires adapters -> ingest -> context -> rules extractor -> commit. Safe to repeat.
- `extractFromContext(context, config)` / `createRulesExtractor` (route `rules`, `rules-extractor@1`), `defaultExtractionConfig` / `ExtractionConfig` (asset id patterns, aliases, cue lexicons, condition parsers keyed by `CONDITION_KEYS`, action lexicon, outcome polarity cues; no demo names or ids in logic).
- `commitProposal(store, proposal, context, {orgId, accessScope})` — entities (dedupe by normalized name/alias/actor id), claims (deterministic id from case key + type + statement, or condition key/value), cases (one per incident key, `asset:<normalized id>`), attempts, outcomes, person-work links, usefulness labels on evidence.
- `rebuildCase(store, caseId)` — derives attempts, outcomes, conditions, gaps, status and link statuses from the case's live claims (shared by commit and corrections).
- `applyCorrection(store, correction)` — retract/contradict/confirm a claim, outcome, case or link; propagates to case fields and link statuses; records the `Correction`; idempotent.
- `buildCaseView(store, caseId, principal)` -> `CaseView | undefined` (undefined when the principal may not see the case).
- `listCases(store, principal?, orgId?)`, `canSee`, `restrictiveScope`.

## Behavior worth knowing
- Claim types by cues: hypothesis, advice (imperatives incl. "don't"), action (past tense/"did that", resolved to the last advice from another person), outcome, condition (never taken from hypothetical/if/advice sentences), access-fact (case-less), identity (from declared roles), other (general experience, documentation remarks).
- In the first message of an incident, outcome words describe the problem ("traffic is still not coming back") and are recorded as an observation, not an outcome.
- Statement text is the verbatim sentence, so negation and hedges survive; hedged conditions get a "(hedged in source)" label.
- Outcome: `basis 'reported'`, `lasting 'unknown'` (a later report of recurrence sets `recurred`). Status `reported-recovered` when a recovered outcome exists, `unknown-outcome` when an action was performed but no outcome, else `open`. Gaps are generated for lasting, timing, unverified cause and unreported attempt results.
- Independence: a claim is `supported` only with >= 2 supporting evidence records that are not copies or likely retellings of each other.
- Access: record scope = most restrictive of the import scope and cited evidence; the case view filters per item for the principal.
- Revisions: claims that depended on a superseded revision and were not re-proposed become `corrected`.

## Dependencies
`contracts/`, `connectors/`, `ingest/`, `context/`, `node:sqlite`. Acyclic: connectors <- ingest, context <- memory.

## Checks run
`node --test 'src/libs/utils/memory/**/*.test.ts'` — store (FTS5 and fallback, rollback, injection guard, 5k puts < 2 s), extractor rules and configuration generalization, and pipeline tests on the Elisa files (skipped when `private/` is absent) and `data/fixtures/dev-family-01` (one case, retelling, attempt/outcome/links, Slack continuation, lookalike separation, access-fact, access filtering, edited-message revision, corrections, idempotent reimport). The Elisa assertions were run and passed.

## Known limitations
- Rules only: advice and cues are lexical; paraphrases outside the lexicons are missed (that is what the `local`/`replay` routes are for).
- Case identity is the asset id: a new problem on the same asset months later merges into the old case unless the text says "new/another problem" after an outcome.
- Attempts are one per (case, action); two separate performances of the same action collapse. A performed action claim keeps only its first action as structured data.
- Person identity across providers uses exact normalized display name; two different people with the same name would merge.
- `lasting` is never inferred as `confirmed`; a later "still stable" report is another reported outcome.
- Quoted segments are not extracted (they are copies); a forwarded message whose original is not in the store therefore contributes nothing.

## Fix pass

- Human link status (confirm/reject) is never moved by `rebuildCase`; a human `confirm` on a claim is not recomputed away on re-import (`human.ts`).
- Copy/retelling lineage is order independent: `ingest/import.ts` re-checks existing quoted segments and free-text emails after each batch; `refreshClaimSupport` recomputes claim support.
- Outcomes are attributed only to an attempt performed before them. A later no-change/worse report marks earlier recoveries `recurred`.
- Access scope: entities, claims and cases take the least restrictive scope among their supporting sources; restricted evidence/claims/attempts are filtered per principal in `buildCaseView` (counts too). Entity details from narrower sources are not merged into a wider entity. Limitation: a case title or entity name first seen in a private source is visible once an org-wide source also supports it.
- `parseTimeRef`: known only for ISO 8601 / RFC 2822 strings that state a zone; zoneless and slash dates stay `known:false` with raw kept.
- A performed-action or yes/no condition claim cites only the speaker's message; the advice/question is context in the statement.
