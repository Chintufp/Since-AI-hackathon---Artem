# memory

Local SQLite store, rules extraction, evidence-backed memory commit, corrections and the case view.

## Public interface (`index.ts`)
- `openStore(path | ':memory:', {disableFts?})` -> `KnowledgeStore` (+ `searchMode`). One table per record type (`id`, `json`, `created_seq`), `json_extract` filtering (dotted paths allowed, names validated), expression indexes on caseId, personEntityId, investigationId, status, orgId, questionId, `lineage.sourceFingerprint`, `metadata.sourceKey`, `thread.threadId`. `searchText` uses FTS5 when available (score = -bm25, higher is better) else term overlap (score = fraction of query terms present). Nested `transaction()`; `clear()`.
- `importFromPath(store, {format, path|payload, connectionId?, orgId, accessGroups?, now?, config?})` -> `{batch, cases, claims, entities, people}`. Formats `teams-json`, `email-text`, `slack-export`, `paste`, `scenario-dir` (reads only teams*.json, text emails and Slack export folders; ignores `truth.json`/`incoming.json`). Wires adapters -> ingest -> context -> rules extractor -> commit. Safe to repeat.
- `extractFromContext(context, config)` / `createRulesExtractor` (route `rules`, `rules-extractor@1`), `defaultExtractionConfig` / `ExtractionConfig` (asset id patterns, aliases, cue lexicons, condition parsers keyed by `CONDITION_KEYS`, action lexicon, outcome polarity cues; no demo names or ids in logic).
- `commitProposal(store, proposal, context, {orgId, accessScope})` — entities (dedupe by normalized name/alias/actor id), claims (deterministic id from case key + type + statement, or condition key/value), cases (one per incident key, `asset:<normalized id>`), attempts, outcomes, person-work links, usefulness labels on evidence.
- `rebuildCase(store, caseId)` — derives attempts, outcomes, conditions, gaps, status and link statuses from the case's live claims (shared by commit and corrections).
- `applyCorrection(store, correction)` — retract/contradict/confirm a claim, outcome, case or link; propagates to case fields and link statuses; records the `Correction`; idempotent.
- `buildCaseView(store, caseId, principal, viewConfig?)` -> `CaseView | undefined` (undefined when the principal may not see the case). Compact timeline (see "Case view" below). `defaultViewConfig` / `ViewConfig` (`view-config.ts`) hold the presentation vocabulary: action labels (`interface.reset` -> "interface reset", fallback humanizes dotted names), past-tense phrases, symptom/change phrases for the short label, condition merges, acronyms. `caseLabel(...)` builds the short label.
- `listCases(store, principal?, orgId?)`, `canSee`, `restrictiveScope`.

## Case view (compact timeline)
Problem (red) -> Reported conditions (yellow, one node) -> Possible cause (one node merging all hypotheses, each with its author) -> Suggested checks (one node merging advice and advice against) -> one node per performed attempt, in order ("Attempted interface reset": advised by, performed by as reported, time) -> Reported outcome (green only when one exists; states reporter, which attempt it followed, and that timing/cause/lasting are unconfirmed) or Outcome unknown (grey). Typical size 5-8 nodes.
- A change performed before the first problem sentence (no advice) is not an attempt: it appears in Reported conditions ("SFP replaced before the problem").
- Condition labels are plain ("Interface up", "Older unit (installed around 2019)"). Hedged conditions (a hedge word in the source sentence, tested against the verbatim statement with `ExtractionConfig.hedges`) keep `origin: 'reported'` (investigation treats `inferred` as not settling a key) and the node detail says "Reported as likely rather than certain: ...". Stored labels from older databases are cleaned of the legacy "(hedged in source)" suffix at display time.
- Repeats are dropped: a claim whose words mostly overlap an earlier one, or that comes from a retelling/copy of a message which already yielded a claim of that type (the "RE:" email), does not add a bullet; hypothesis lead-ins ending in ":" are not shown. A person restating the same outcome for the same attempt merges into one node.
- `CaseView.title` / `Case.title` is a short label: asset id + a few words, e.g. "TRN-042 · no traffic after SFP change" (symptom from conditions via `ViewConfig.symptoms`, "after ..." from a change condition that precedes the problem; fallback is the first content words of the problem sentence). `rebuildCase` recomputes it; the long first sentence stays in the Problem node and the observation claim.
- Caveat is one sentence: recovery/outcome status, then "N independent of M source record(s)" (plus retracted/corrected count when there is one). Open-gap counts are not repeated there.

## Behavior worth knowing
- A case exists only when the thread has a reported symptom (an observation claim) or an asset entity. An aside with neither (for example a Slack remark about van stock) keeps its evidence and claims case-less, like access facts.
- Claim types by cues: hypothesis, advice (imperatives incl. "don't"), action (past tense/"did that", resolved to the last advice from another person), outcome, condition (never taken from hypothetical/if/advice sentences), access-fact (case-less), identity (from declared roles), other (general experience, documentation remarks).
- In the first message of an incident, outcome words describe the problem ("traffic is still not coming back") and are recorded as an observation, not an outcome.
- Statement text is the verbatim sentence, so negation and hedges survive; hedged conditions keep a plain label; the hedge stays in the statement.
- Outcome: `basis 'reported'`, `lasting 'unknown'` (a later report of recurrence sets `recurred`). Status `reported-recovered` when a recovered outcome exists, `unknown-outcome` when an action was performed but no outcome, else `open`. Gaps are generated for lasting, timing, unverified cause and unreported attempt results.
- Independence: a claim is `supported` only with >= 2 supporting evidence records that are not copies or likely retellings of each other.
- Access: record scope = most restrictive of the import scope and cited evidence; the case view filters per item for the principal.
- Revisions: claims that depended on a superseded revision and were not re-proposed become `corrected`.

## Dependencies
`contracts/`, `connectors/`, `ingest/`, `context/`, `node:sqlite`. Acyclic: connectors <- ingest, context <- memory.

## Checks run
`node --test 'src/libs/utils/memory/**/*.test.ts'` — `case-view.test.ts` (no case for an aside, compact Elisa/dev-family/demo-family timelines, labels, retelling adds no repeats), store (FTS5 and fallback, rollback, injection guard, 5k puts < 2 s), extractor rules and configuration generalization, and pipeline tests on the Elisa files (skipped when `private/` is absent) and `data/fixtures/dev-family-01` (one case, retelling, attempt/outcome/links, Slack continuation, lookalike separation, access-fact, access filtering, edited-message revision, corrections, idempotent reimport). The Elisa assertions were run and passed.

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
