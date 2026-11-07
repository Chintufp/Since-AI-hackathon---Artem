# memory

Local SQLite store, rules extraction, evidence-backed memory commit, corrections and the case view.

## Public interface (`index.ts`)
- `openStore(path | ':memory:', {disableFts?})` -> `KnowledgeStore` (+ `searchMode`). One table per record type (`id`, `json`, `created_seq`), `json_extract` filtering (dotted paths allowed, names validated), expression indexes on caseId, personEntityId, investigationId, status, orgId, questionId, `lineage.sourceFingerprint`, `metadata.sourceKey`, `thread.threadId`. `searchText` uses FTS5 when available (score = -bm25, higher is better) else term overlap (score = fraction of query terms present). Nested `transaction()`; `clear()`.
- `importFromPath(store, {format, path|payload, connectionId?, orgId, accessGroups?, now?, config?})` -> `{batch, cases, claims, entities, people}`. Formats `teams-json`, `email-text`, `slack-export`, `paste`, `scenario-dir` (reads only teams*.json, text emails and Slack export folders; ignores `truth.json`/`incoming.json`). Wires adapters -> ingest -> context -> rules extractor -> commit. Safe to repeat.
- `extractFromContext(context, config)` / `createRulesExtractor` (route `rules`, `rules-extractor@1`), `defaultExtractionConfig` / `ExtractionConfig` (asset id patterns, aliases, cue lexicons, condition parsers keyed by `CONDITION_KEYS`, action lexicon, the `language` lexicon below; no demo names or ids in logic).
- `assignEpisodes(store, orgId, items, config)` (`episodes.ts`) — which case an extracted incident belongs to (see "Episodes"); `importFromPath` runs it between extraction and commit.
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
- Claim types by cues (lexicon below): hypothesis, advice (imperatives incl. "don't"), action (past tense/"did that", resolved to the last advice from another person), outcome, condition (never taken from hypothetical/if/advice sentences), access-fact (case-less), identity (from declared roles), other (general experience, documentation remarks).
- In the first message of an incident, outcome words describe the problem ("traffic is still not coming back") and are recorded as an observation, not an outcome.
- Statement text is the sentence made self-contained, never reworded beyond that: vocative and discourse markers ("Lauri, ...", "OK so ...") and comparison clauses ("same as ACC-12 last week") are dropped, the asset is named when the sentence does not, a performed action is stated as "<Performer> <past tense phrase>" ("Rolling back the hold timers now." by Toivo -> "Toivo rolled back the hold timers on AGG-014"), and an outcome says what it followed ("Both sessions are up after the hold timer rollback"). Negation and hedge words survive; hedged conditions keep a plain label; the hedge stays in the statement. The verbatim sentence is always the evidence excerpt.
- Outcome: `basis 'reported'`; `lasting` is `unknown` until later evidence says otherwise (see "Outcome state and lasting"). Status `reported-recovered` when the last recovered or partial outcome has no lasting evidence, `verified-resolved` when a separate later report says it held, `recurred` when the problem came back, `unknown-outcome` when an action was performed but no outcome, else `open`. Gaps are generated for lasting, timing, unverified cause and unreported attempt results.
- Independence: a claim is `supported` only with >= 2 supporting evidence records that are not copies or likely retellings of each other.
- Access: record scope = most restrictive of the import scope and cited evidence; the case view filters per item for the principal.
- Revisions: claims that depended on a superseded revision and were not re-proposed become `corrected`.

## Dependencies
`contracts/`, `connectors/`, `ingest/`, `context/`, `node:sqlite`. Acyclic: connectors <- ingest, context <- memory.

## Checks run
`node --test 'src/libs/utils/memory/**/*.test.ts'` — `case-view.test.ts` (no case for an aside, compact Elisa/dev-family/demo-family timelines, labels, retelling adds no repeats), store (FTS5 and fallback, rollback, injection guard, 5k puts < 2 s), extractor rules and configuration generalization, and pipeline tests on the Elisa files (skipped when `private/` is absent) and `data/fixtures/dev-family-01` (one case, retelling, attempt/outcome/links, Slack continuation, lookalike separation, access-fact, access filtering, edited-message revision, corrections, idempotent reimport). The Elisa assertions were run and passed.

## Known limitations
- Rules only: advice and cues are lexical; paraphrases outside the lexicons are missed (that is what the `local`/`replay` routes are for).
- Case identity is the asset id plus an episode number (see "Episodes"). Without times or recurrence cues, incidents on one asset stay together; incremental imports decide with the episodes already stored, so importing the sources one by one in a bad order can place a write-up differently than importing them together.
- Attempts are one per (case, action); two separate performances of the same action collapse. A performed action claim keeps only its first action as structured data.
- Person identity across providers uses exact normalized display name; two different people with the same name would merge.
- `lasting` is `confirmed` only from a later report, a different evidence item from the one reporting the attempt (one message by the performer is a single self-report), that the recovery held for a day or longer (duration phrases); a same-session "still up after ten minutes" is another reported outcome. It is never `observed`: the basis stays `reported`.
- Quoted segments are not extracted (they are copies); a forwarded message whose original is not in the store therefore contributes nothing.

## Fix pass

- Human link status (confirm/reject) is never moved by `rebuildCase`; a human `confirm` on a claim is not recomputed away on re-import (`human.ts`).
- Copy/retelling lineage is order independent: `ingest/import.ts` re-checks existing quoted segments and free-text emails after each batch; `refreshClaimSupport` recomputes claim support.
- Outcomes are attributed only to an attempt performed before them. A later no-change/worse report marks earlier recoveries `recurred`.
- Private-channel membership: the Slack export adapter reads `members` from `channels.json` (the people who posted stand in when it is absent) and tags each private-channel record with a membership grant. After commit, `applyMembershipGrants` (`membership.ts`) resolves each grant to a person entity (actor id, then name; a named member without an entity gets one), records `member-of:<group>` on it and merges the group into the person's `accessScope.groups` (additive, idempotent, never replaces). The service's `applyDirectory` keeps these on top of the directory groups. Skipped when the import overrides `accessGroups`. Limitation (access can only widen on re-import): an identical record that was already imported is a duplicate and is not rewritten, so re-importing cannot tighten the access scope of an existing record (or add grants to records imported before this existed). To tighten or re-derive, reset the store (`POST /demo/reset` or a fresh db) and import again, or import the changed record as a new revision.
- Access scope: entities, claims and cases take the least restrictive scope among their supporting sources; restricted evidence/claims/attempts are filtered per principal in `buildCaseView` (counts too). Entity details from narrower sources are not merged into a wider entity. Limitation: a case title or entity name first seen in a private source is visible once an org-wide source also supports it.
- `parseTimeRef`: known only for ISO 8601 / RFC 2822 strings that state a zone; zoneless and slash dates stay `known:false` with raw kept.
- A performed-action or yes/no condition claim cites only the speaker's message; the advice/question is context in the statement.

## Extraction lexicon (for organizations)

Everything vocabulary-like lives in `ExtractionConfig` (`extraction-config.ts`); the extractor, `language.ts`, `episodes.ts` and the case builder contain logic only. An organization passes `{ ...defaultExtractionConfig, ...overrides }` as `config` to `importFromPath` / `extractFromContext`; unset fields keep the generic defaults. The defaults are generic phrases and may be rich, but they never contain a sentence from a data set.

| Field | What it holds | Extend it to ... |
| --- | --- | --- |
| `assetIdPatterns`, `aliases` | what an asset id looks like; alias -> canonical name | recognize your equipment ids ("PUMP-12") and nicknames |
| `conditionParsers` | regex + builder per `ConditionKey` | add a condition key and its value mapping |
| `stateConditionKeys` | condition keys that describe a current reading (a sentence yielding one is also an observation) | mark your own reading keys |
| `actionLexicon` | regex -> canonical `ActionName` | name known actions (`interface.reset`) |
| `cues.*`, `imperative`, `performed`, `generic`, `documentation`, `hedges` | hypothesis hedges, advice words, imperative verbs, completion cues, general-experience and documentation remarks | add hedges ("I reckon"), advice imperatives |
| `problem`, `newProblem`, `maxSequenceGap` | what a problem statement and a new problem look like | add domain symptoms |
| `outcomeRecovered/NoChange/Worse/Recurred` | the original narrow outcome cues (kept; they also count as an outcome before any attempt) | rarely needed |
| `differentProblemOverlap` | after an outcome, a problem statement sharing less than this fraction of its content words with the incident so far names a different symptom or component: a new incident inside the same thread or chat | raise to split more eagerly |
| `episodeGapDays`, `followUpDays` | time windows for episode boundaries | tune for slow or fast processes |
| `declaredRoleClaims` | emit an identity claim for every role a message envelope declares (default off: the role stays a person attribute) | turn on if roles matter as claims |
| `language.verbs`, `irregularPast`, `nominals`, `objectFiller` | base forms of operations verbs (multi-word allowed), irregular pasts, the noun used in "after the <object> <noun>", words skipped when finding an action's object | add verbs ("descale"); their past/-ing forms are derived |
| `language.discourseMarkers`, `asideCue`, `referenceCue`, `intent`, `administrative` | leading fillers to drop, off-topic markers ("by the way"), comparison phrases before an asset ("same as"), intent/acknowledgement phrases, paperwork objects that are not equipment | adapt to another language register |
| `language.recurrenceCue`, `comeBackCue`, `longDuration`, `hedgeClause`, `closure`, `exclusion`, `readingQuestion`, `strongRecovery` | recurrence words, day-or-longer durations, "I suspect ..." clauses, "close the ticket" phrases, "that is not it" phrases, questions that ask for a reading, explicit recovery words | tune what counts as lasting, closure, ruled-out causes |
| `language.states` | the outcome-state classifier: `problemNouns`, `recurrence`, `worse`, `partial`, `noChange`, `recovered` | add your own states ("pressure holds") |

Outcome state: `classifyOutcomeState` returns `recovered | no-change | worse | partial` (or nothing) plus a `recurred` flag. Priority: recurrence (a recurrence word next to a problem noun, not "working again"), worse, partial, no change (including "still <bad state>"), recovered ("no flaps", "is up", "still stable"). A sentence only becomes an outcome claim when it follows an attempt (a performed change after the problem was stated, not a check), names an attempt itself ("since the rollback"), or matches the narrow original cues; weak positives ("looks fine") must also share words with the problem.

## Episodes

`assignEpisodes` runs over everything extracted in one import plus the episodes already stored. Anchored incidents (those with their own problem statement) go first: one that states a recurrence ("again", "came back", "another problem") is a new episode; others join the episode nearest in time (within `episodeGapDays`), else the first non-recurrence episode, unless that one already ended in an outcome and the two are further apart than `episodeGapDays` (then a new episode). Incidents with no problem statement of their own (write-ups, follow-ups) join the nearest timed episode within `followUpDays`, else the most similar by words among undated episodes, else the first. Keys are `asset:<id>`, `asset:<id>#2`, ...; re-importing evidence already stored keeps its episode. A standalone Slack message that names no asset and shares no words with the incident (a remark that landed in the same channel and day) is split off.

## Outcome state and lasting

- A recovery report is `lasting 'confirmed'` when a later separate report (a different evidence item than the attempt report; a single message containing the action and "stable for two days" stays `reported-recovered`) says it held for a day or longer ("no flaps for three days after the rollback", the `longDuration` phrases); it also confirms the other recovery reports of the same attempt. A case then reads `verified-resolved` (still reported, not observed).
- A later report that the problem is back, on the case or on a later episode of the same asset (the sibling case whose first problem statement is a recurrence and whose nearest earlier episode is this one), sets `recurred` on the recoveries and the case status `recurred`.
- Order across threads without event times is unknown: recurrence from "a later no change" is only inferred between reports whose order is known (same thread or both timed).

## Copies

A verbatim copy of another record (`lineage.copiedFrom`) is never a new statement. Its claims are merged at commit into the original's claim (same type, same passage) as extra, dependent support: no new claim, asserter or performer, and `independentSources` does not count it. A claim from a copy whose original is not found is committed as before.
