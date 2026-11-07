# Knowledge Twin: how the system works today, and how its algorithm works

For Artem. Written 8 November 2026 from the code on `run/2026-11-07-overnight` at HEAD b7083d5 (all of B1 to B7, the B6 package and the round 5 fixes merged; 641 tests pass on the committed tree). Every claim names the file it comes from. Paths are relative to the repo root. Numbers are copied from result files, with denominators; where nothing was measured, it says "not measured".

Note: `docs/HOW_QUESTIONS_WORK.md` predates day 2. Its "no language model anywhere" and "nothing learns online" are now out of date (sections 6 and 7); the rest still matches the code.

## 1. What the system is

Knowledge Twin is a local service plus a desktop companion (Lumi) that turns work chat and e-mail into a memory of incidents: who saw what, who advised what, what was done, and what happened after. When someone describes a new problem, the engine finds past cases, decides separately whether each past fix worked (support) and whether it fits this unit (applicability), and returns one recommendation with its caveats and sources. When a missing fact would change that recommendation, it asks one person one yes/no question, under hard limits on how often anyone is interrupted. Answers are stored as attributed evidence and change the next recommendation. It runs on rules by default; models are opt-in per slot and only propose. The same engine is exposed over HTTP (42 routes, `src/apps/service/http.ts`) and over MCP (12 tools, `src/apps/service/mcp-tools.ts`), and an agent gets the same limits as a person.

## 2. The data model

All contracts live in `src/libs/utils/contracts/`.

- **Evidence envelope** (`contracts/evidence.ts`). One message or mail, verbatim, never edited, with author, `eventTime`, thread position, `accessScope` and `lineage`. Its `TimeRef` (`contracts/common.ts`) keeps unknown times unknown (`known: false`, `partial: 'time-only'`, raw text, sequence). The id is deterministic, so re-importing a file inserts nothing.
- **Claim** (`contracts/memory.ts`). One typed statement (observation, hypothesis, advice, action, outcome, condition, access-fact, ...) cut from an evidence span, bound to entities, with `supporting` refs, an `extraction` route and an optional `condition {key, operator, value, label}`. Validity (`contracts/memory.ts` lines 31 to 73): `validity.from`, `validity.to`, `validity.condition` (for example "software.version < 4.2"), `conditionedBy`, `cue`, and a `status` of `provisional | supported | contradicted | corrected | retracted | superseded`, plus `supersededBy`.
- **Case**: the incident container, with entity ids, observation and hypothesis claim ids, attempts, outcomes, evidence ids and structured `conditions`.
- **Attempt**: what was tried, who advised it, who performed it, `performed: reported | proposed-only`. **Outcome**: `result` (recovered, no-change, worse), `lasting` (unknown, lasted, recurred) and `basis` (reported or observed). There is no "solution" field. A fix is derived from an advice claim, an attempt and an outcome row.
- **Person link** (`PersonWorkLink`): person to claim or case with a contribution (reported-problem, advised, performed-check, performed-action, reported-outcome, observed-condition, mentioned) and a `firsthand` flag. Recipients are chosen from these.

**SQLite layout** (`src/libs/utils/memory/sqlite-store.ts`). One file, `data/local/knowledge-twin.sqlite`. One table per record type, `r_<type>`, with columns `id`, `json`, `created_seq` (line 113). `created_seq` is one global insertion counter shared by all tables. A full-text table `search_fts` using FTS5 over evidence text, claim statements and case titles, with a term-overlap fallback when FTS5 is missing (lines 117 to 126). Beside them, `r_embedding (id, kind in evidence|claim|case, refId, model, dims, textHash, vector BLOB, created_seq)` with its own counter, indexed on `(kind, model)` (lines 18 to 25). A row is skipped when its `textHash` is unchanged.

**Route labels.** `Route` is `'rules' | 'local' | 'replay' | 'claude-agent-arm' | 'api'` (`contracts/common.ts`). Every model-dependent output carries a `RouteInfo {route, version}`. `src/libs/utils/models/routes.ts` holds `ROUTE_REGISTRY` with 18 entries today, each with a `learned` flag (only `linucb` is `learned: true`). The rule from `docs/BUILD_BRIEF.md` section 1.4 is that a model proposes, `commitProposal` commits, and every stored object says which route produced it. In code, every claim gets `extraction: {route, version}` from the proposal at commit (`memory/commit.ts` line 161). That is why a reader can always tell a rules claim from a model claim.

Seeded Elisa demo store: 75 evidence, 121 claims, 7 cases, 11 attempts, 8 outcomes, 70 person links, 29 entities (`docs/HOW_QUESTIONS_WORK.md` section 10; I did not re-count the live file).

## 3. From a message to memory

**Capture.** Three ways in, all through `POST /import`:
- File import of Teams JSON, e-mail, Slack export (`src/libs/utils/connectors/`).
- "Remember this": a paste or dropped text file in the panel; `connectors/paste-thread.ts` sniffs thread, e-mail, JSON or note (D-B4-01 to D-B4-04). Only the explicit click stores; Send still investigates (D-B4-08).
- The Slack poller (`connectors/slack-poller.ts`): imports channel messages, DMs delivered questions, and reads 👍 / 👎 / 🤷 from the asked person only, answering through the normal route (D-B4-12 to D-B4-16). It runs on a fake workspace (`connectors/slack-fake.ts`) unless `KT_SLACK_LIVE=1`, and then only to `https://slack.com` (`connectors/slack-net.ts`, D-INT-17).

**Extraction.** The default is the rules extractor, `memory/extractor-rules.ts` (`rules-extractor@1`), driven by lexicons in `memory/extraction-config.ts`. With extract set to a model, `Engine.importAndEnrich` (`engine.ts` lines 491 to 521) commits the rules proposal first, then runs the model under one 60 s budget per import (`models/providers/types.ts` line 67) and validates it with `validateExtraction` (`memory/extractor-llm.ts`). Each claim, entity and link must cite an evidence id from this thread with an excerpt that is a verbatim substring of that message, or it is dropped. The excerpt must also carry the item: at least three words or the whole message, every id and number in the statement, and half of its content words (D-B2-54). The speaker is the author of the cited message, never what the model says (D-B2-55). `unionProposal` (line 325) then keeps only model claims that do not restate a rules claim, re-keyed to the rules incidents. So the commit order is rules first, model-only claims second, each with its own route label.

**commitProposal** (`memory/commit.ts` line 46) runs in one store transaction. It upserts entities, binds a claim to a case only when the incident has a reported symptom or an asset (line 128), merges supporting refs into an existing claim with a stable id, treats a verbatim copy as dependent support rather than a new source, and gives each record the most open scope among its sources.

**Supersession** (`memory/supersession.ts`, route `supersession-rules@1`), run inside that transaction:
- (a) Newer value. A live claim of the same type, overlapping subject, same condition key and qualifier, and a different value closes the older one: `to` = newer `from`, status `superseded`, `supersededBy`, revision + 1. Only keys in `validityCues.newerValueKeys` take part, today `site.access_code` and `software.version` (`memory/extraction-config.ts` line 115). When both times are known they decide; when the order rests on import order only, the newer claim needs an explicit cue such as "is now" or "changed the lock" (D-B1-08).
- Backfill. A dated value imported late that falls inside an older value's closed window re-closes the older one at the new value, so two codes are never valid at once (lines 72 to 91, D-B1-33).
- (b) Superseding note. "Fixed in firmware 4.2" gives older advice and hypotheses on that subject `validity.condition = "software.version < 4.2"` instead of closing them (D-B1-07).
- Human-confirmed or corrected claims are never touched; nothing is deleted.

**Point-in-time reads.** `memory/validity.ts` `validAt`: unknown `from` means valid from before any dated moment; a known `to` is exclusive; unknown `to` means still believed true, except on a superseded claim (D-B1-02). `at` is accepted on `POST /investigate`, `kt_investigate` and `kt_get_context` and must be ISO with a zone (`parseAt`). The retriever builds its corpus for `at` (`retrieval/hybrid.ts` `search`), the assessor reads case facts at `at` (`investigation/assessor.ts`), and answers and observations recorded after `at` are left out (`investigation/investigate.ts` line 169).

**GET /context and the Context Layer page.** `GET /context?entity=…&at=…` returns the assertions bound to an entity with source, person, time and status, and marks which are valid at `at` (`engine.ts` `contextAssertions` line 630, D-B1-05). `GET /context.html` (`src/apps/service/context-page.ts`) draws evidence on a time axis, claims as bars from valid-from to valid-to, bindings and people, with a draggable `t` line and a card showing what an agent is told at `t` (`POST /investigate` with `at`, under the viewer's access).

## 4. The algorithm when someone asks

`investigate()` lives in `src/libs/utils/investigation/investigate.ts` (line 152).

**1. Problem parser** (`investigation/problem-parser.ts`, route `problem-parser@1`). A configurable lexicon of regular expressions maps phrases to typed conditions. Examples: "counters are zero" gives `traffic.counters = zero`; "older unit" gives `unit.age = older`; "installed 2018" gives `unit.installed_year` (folded to older through 2019, marked inferred); "the 2021 batch" gives `unit.batch` unless hedged (D-B5-16); "firmware 4.2" gives `software.version`. A preceding negation skips a match; a separate parser catches a model name ("an N5 unit"). Access words ("barrier", "code", "driving out to") set `intent.access`, which is taken out of the conditions and sent to the access-fact lookup (`investigation/access-facts.ts`, D-B1-17). Any phrasing outside the lexicon produces nothing.

**2. Hybrid retrieval** (`retrieval/hybrid.ts`). Three ranked lists over the cases the requester may see:
- BM25 over case text (`bm25.ts`), pruned below 0.15 of the best hit.
- Exact entity match on an asset id or alias (`exact.ts`).
- Hashed character trigrams, 512 dims, cosine, not learned (`vector.ts`), weight 0.7.

They are fused by weighted reciprocal rank fusion with k = 60: each list adds `weight / (60 + rank)` to a case (`reciprocalRankFusion`, lines 18 to 29). The fused score is normalised, then adjusted by the condition comparison: plus 0.2 times the fraction of matching conditions, minus 0.1 per conflict, at most two. The top `k = 8` (`investigation/settings.ts` line 89) become candidates.

When the embed slot is on, the embedding list replaces the trigram list rather than joining it (D-B2-10). `retrieval/embedding-index.ts` embeds the query once, takes a brute-force cosine over `r_embedding` rows at three granularities (evidence, claim, case card), aggregates evidence and claim hits to their case by max, drops cosines below 0.3, and keeps only what the requester may see. The case card is generated from structured rows (`memory/case-card.ts`). If the query cannot be embedded in 5 s, trigrams stand in and the route says so. Cosine is never shown as confidence.

**3. Condition comparison** (`retrieval/conditions.ts`). Each candidate gets `matchingConditions`, `conflictingConditions` and `missingConditions`. Identity-like keys never match or conflict; history keys can only match. Answer markers are read here: `__answer:matches-case` is a match and `__answer:differs-from-case` is a conflict (lines 80 to 88).

**4. Assessor** (`investigation/assessor.ts`, `case-facts.ts`). Two separate verdicts.
- Support (`case-facts.ts` `supportFor`, line 129): `contradicted` if an outcome after the primary attempt is no-change, worse or recurred; `supported` if the attempt was reportedly performed and recovery was reported; `weak` if performed with no outcome, or only advised; `unknown` with no hypothesis or action.
- Applicability (`applicabilityFor`): a conflict on a distinguishing key is `inapplicable`; a distinguishing key still unknown, a conflict on another key, or nothing matched is `qualified`; otherwise `applicable`. The distinguishing keys are configuration: `unit.age, unit.model, unit.revision, software.version, unit.batch` (`investigation/settings.ts` line 91).

**Why a wrong link is worse than none.** Three guards keep a lookalike from driving the answer. A conflict on a distinguishing key makes a case inapplicable no matter how similar the text is. `investigation/related.ts` lets a candidate drive the recommendation, gaps, questions and people only if it matches at least 2 non-history conditions or concerns an entity of the problem (`relatedMinMatchingConditions: 2`, `settings.ts` line 118). Other candidates stay in the list but are inert. And the store metric counts a link made without an answer against correctness (section 6). At capture, the pairing of an orphan fix with an open problem is only proposed as a question; nothing is linked without a Yes (D-B1-29).

**5. Recommend** (`investigation/recommend.ts`). A decision table over (support, applicability, attempts). Kinds are `reuse | check-first | qualified | retain-uncertainty | none` (`contracts/investigation.ts` line 81). Each plan has a rank and the highest wins:
- inapplicable or contradicted: `retain-uncertainty`, rank 2, "Don't reuse the fix from TRN-042: …", with the caveat that the case does not apply "going by the answer you received" when an answer decided it.
- supported, applicable, with a diagnostic check: `check-first`, rank 5.
- supported, applicable, no check: `reuse`, rank 5.
- supported, qualified: `qualified`, rank 4, "Confirm the unit details (…) before …".
- a diagnostic check and support not unknown: a lower `check-first`, rank 3.
- otherwise `none`, rank 1. An action the problem says was already done is never recommended again.

The text is a short headline; `nextStep` and `caveats` carry the rest ("Reported once; cause and lasting effect not verified."), including ruled-out cases. `applyBounds` adds the superseded caveat when a "fixed in 4.2" note bounds the basis and the problem states a version inside the bound, and caps the result at `qualified` or `none` (D-B1-13). Wording never changes the gate.

**6. Provenance.** The recommendation carries `basis` evidence refs. `src/apps/service/provenance-strip.ts` renders the strip under a heading, for example "Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true". The investigation stores the routes it used, and a model-proposed node says so (`memory/provenance.ts`, D-B2-23).

**Experts disagree** (B5). `investigation/alternatives.ts` shows up to two qualified alternatives beside the recommendation; one answer on `unit.batch` or `unit.age` picks the branch without overwriting either expert (D-B5-09, D-B5-15).

## 5. The question machinery

**Gaps** (`investigation/gaps.ts`). For the hypothesis the recommendation depends on:
- Each missing distinguishing condition is a consequential gap with `whatAnswerChanges`. A condition hedged in its source never creates one. A key the requester can observe themselves (interface, optics, counters, traffic, alarms, power, temperature, BGP; `settings.ts` line 94) becomes "check this yourself", not a question to a colleague.
- A performed corrective action with no recovery is a consequential outcome gap.
- Unknown lasting is a non-consequential gap and never interrupts anyone.

**Standing gaps** (`memory/standing-gaps.ts`, route `standing-gaps@1`) are recorded at capture time on a per-case standing investigation: `missing-symptom` (a fix with no symptom; free text, Later pile only), `outcome` (a performed fix with no outcome after 24 h), `pairing` (an orphan fix and an open problem on one asset within 14 days). Settings: `defaultStandingGaps = { ask: true, outcomeAfterHours: 24, pairingWindowDays: 14 }` (`src/apps/service/org-config.ts`). Investigation questions always come first; standing ones never count against them (D-B1-27, D-B1-40).

**Templates** (`questions/generator-templates.ts`). Per-key wording such as "Is TRN-301 an older unit?" or "Did traffic return right after the interface reset on TRN-042?", always about the problem's asset and built only from what the requester may see.

**Recipients** (`questions/recipients.ts`). Outcome questions go to people with firsthand links on that case. Condition questions go to people with firsthand links to the problem's entities, plus people whose role or group may observe that key under the organization's policy (`org-config.ts` `defaultObservabilityPolicy`). The requester is excluded.

**Hard gates** (`questions/eligibility.ts`), run before any selector and never overridable: gap resolved, self, not answerable, access (the recipient must see the case and the evidence behind the asked condition), unavailable, budget, cooldown, already asked, duplicate. Defaults in `contracts/questions.ts` lines 156 to 162: `dailyLimitPerPerson: 3`, `maxOpenQuestionsPerPerson: 1`, `maxQuestionsPerInvestigation: 3`, `cooldownMinutes: 30`, plus a 24 h re-ask window for the same question to the same person (`eligibility.ts` line 9).

**Quiet hours** (`questions/quiet-hours.ts`). `defaultQuietHours = { start: '22:00', end: '07:00', timeZone: 'Europe/Helsinki' }` (`org-config.ts`), wired by `main.ts`, `mcp.ts` and `demo-reset.ts`, never a library default (D-B1-22). A question created inside stays `queued` with `deliverAfter` set to the next window; `deliverDue()` delivers it at or after that time through a fresh eligibility check, and is called on clock moves and on reads, not by a timer (D-B1-23). `demo:judge` turns quiet hours off; `demo:agent` turns them on (D-B1-35, D-B7-11).

**Selector.** The default is `RulesSelector` (`policies/rules-selector.ts`). Its gate is `score = consequential × (firsthand ? 1 : 0.6) × 1/(1 + open questions) × recency`, and it defers below 0.2. Among the pairs that pass the gate it now picks the highest value / cost (`policies/value-cost.ts`, D-B2-67, section 6); ties fall back to the score, then the action key. The alternative is LinUCB (`policies/linucb.ts`): a shared linear model over 7 visible features plus a bias (`policies/features.ts`: consequential, firsthand, recipientOpenQuestions, recipientAskedToday, candidateCount, gapDecidesApplicability, hypothesisSupportLevel), picking the highest `mean + alpha × uncertainty` with alpha 0.5 and a ridge prior lambda 1. Hidden truth never enters the features. The selector is chosen by `selectorId` (default `'rules'`, switchable with `PUT /settings`, `engine.ts` line 1213).

**Answers** (`questions/coordinator.ts` around line 520). Each answer is attributed evidence plus an `Answer` and, for Yes or No, an `Observation`. Yes on a condition question stores `__answer:matches-case`, No stores `__answer:differs-from-case`. The literal value is never copied and no `neq` is written. The comparison then reads Yes as a match (applicable, recommendation re-planned) and No as a conflict on a distinguishing key (inapplicable, retain-uncertainty). Historical claims are not edited. Not sure records no fact and keeps the gap open. Later defers, Dismiss dismisses, Undo withdraws cleanly (routes in `http.ts`). Standing answers: pairing Yes records a confirmed Pattern with the answer as evidence, No a rejected one, never proposed again; an outcome answer overlays an attributed outcome on the case (D-B1-29).

**Burden and points.** I found no burden meter widget in `src/libs/utils/ui/`. What exists is "Erkki's cost" (`src/apps/service/costs.ts`, `GET /costs`: asked, answered, seconds, reuse by people and agents) on the activity page, and the burden term in the reward. Points (`participation/participation.ts`) are per-person opt-in, nobody is opted in by default, and points never feed a reward.

## 6. The official metric

`src/libs/utils/memory/store-health.ts`, method label `store-metric-delta@1`.

**Completeness.** Six slots per case: symptom, distinguishing, attempt, outcome, lasting, validity (line 20). Distinguishing counts the fraction of keys known (`unit.age` is also known from an installation year or batch). Validity needs the advice claim to have a known `from` and a `to`, a condition, or an answer touching it within 90 days. `completeness(case)` = sum of slot values / 6. A singleton has at most 2 slots filled; a thin pair is a case whose claims each rest on one message. Store completeness is the mean weighted by how many investigations cited each case in the last 30 days, or the unweighted mean when nothing was retrieved.

**Correctness.** `(claims with ≥2 independent sources or an observed outcome − contradicted claims still cited by a recommendation − links made without an answer) / case claims`; null, never zero, when there are none.

**Value and cost of a question, before asking** (`policies/value-cost.ts`, D-B2-67). `value = consequential × (firsthand ? 1 : 0.6) × recency × expectedGain × retrievalWeight`. `expectedGain = (c + dc)(r + dr) − c·r`, never below 0, averaged over the Yes and No answers (D-B2-74): a missing distinguishing key adds `dc = 1/(6k)` while it is unknown; an outcome question adds `dc = 1/6` when the outcome slot is empty and `dr = 1/n` when its claim is not yet supported; pairing adds 0. `retrievalWeight` is the number of other investigations that retrieved the case in the last 30 days, plus 1 for an investigation gap. `cost = 1 + burden / 0.02`. The demo questions are unchanged by this ranking (the pinned tests pass unedited); the one behaviour change is on the developer fixture, where RTR-203 now asks the outcome question first (gain 0.0113 against 0.0017). Standing gaps are still ordered by kind in `engine.askStanding`, not by value / cost.

**Value and cost of a question, after the answer.** The reward in code (`coordinator.ts` lines 566 to 620, D-B2-30): `value = Δ(completeness × correctness of the touched cases) − burden`, with `burden = 0.02 × asked today + 0.02 × open questions + 0.05 if inside quiet hours` (`BURDEN`, line 117). If the metric cannot be measured before or after, the reward stays null and the selector learns nothing (never a zero, D-B2-60). When an outcome lands later, `rewardOutcome` re-measures and the selector applies a correction, not a second observation. 

**How an answer is read by the metric** (D-B2-66, superseding D-B2-51). An answer to an applicability question (gap kind `missing`) neither supports nor contradicts the case's claims. Yes records the value and No records the key as explicitly not applicable; either fills that key of the distinguishing slot. Only an answer about the claim itself, an outcome report, counts for correctness, and it counts against it only while a recommendation still cites the contradicted claim. Before this change every useful No scored as harm. The reward record now carries both scores before and after (D-B2-68).

**Live learning.** After every measured reward the coordinator writes `assessedBenefit` on the evaluation record and calls `selector.update`. The rules selector ignores it (its `update` is empty). For LinUCB, the service saves the state to `data/local/linucb-live.json` and loads it back on restart (`engine.ts` lines 225 to 260, D-B2-32). Undo does not unlearn. Since the default selector is rules, nothing learns live unless someone switches to LinUCB.

**On screen.** The activity page shows the store health line (`activity-page.ts` line 75, `costs.ts` `storeHealthLine`), for example "completeness a → b after n questions". `kt_store_health` gives the same numbers to an agent for the cases it may see.

## 7. The model layer

**Slots and providers.** Slots: `embed`, `extract`, `phrase`. Providers: `rules` (in process), `local` (Ollama at `127.0.0.1:11434`, `models/providers/ollama.ts`), `api` (Anthropic or Gemini, `models/providers/api.ts`). A model never decides case identity, support, applicability, recipients or memory writes (`docs/BUILD_BRIEF.md` 2.1).

**Default.** `DEFAULT_MODEL_SLOTS` puts all three on rules (`contracts/models.ts` lines 35 to 39, re-exported in `org-config.ts`). With rules everywhere, no new process starts and nothing calls out (D-INT-16). The local choices from the brief are `bge-m3` for embed and `qwen3:4b` for extract; phrase defaults to `qwen3:8b` in the brief. A fractional time budget used to crash the second phrase pass; the timeout is now rounded up (`models/providers/types.ts` line 82, D-B2-77). The `api` provider has no embed model in this build (`api.ts` `embed()` throws `unsupported`, D-B2-06). Timeouts: embed 5 s, extract 60 s, phrase 20 s; any failure falls back to rules for that call and the route is labelled with the fallback (`models/providers/fallback.ts`).

**Phrase validator** (`questions/generator-phrased.ts` `validatePhrase`, line 105). One line, under 160 characters (`MAX_PHRASE_CHARS`), ends in "?", one sentence, opens with a yes/no word, names the asset and the condition, introduces no id, number, capitalised word, action stem or negation absent from the input, and every non-glue word must come from the input (D-B2-56). On failure the template text is used. An agent's own wording (`kt_propose_question`, route `agent-worded@1`) goes through the same check, more strictly (D-B7-13).

**Replay fixtures** (`models/replay.ts`). E08 and E09 replay model outputs recorded once from the local Ollama. Each entry has an `inputHash` and an `outputHash`; a changed input is a `ReplayMismatchError`, an edited output a `ReplayOutputMismatchError` (D-B2-61). The replay route must be labelled `replay:`.

**Network guard** (`models/routes.ts` `installNetworkGuard`). It replaces `globalThis.fetch` with a thrower, except for origins on an explicit allowlist. Experiments install it with no allowlist, or with only `http://127.0.0.1:11434` in `--record` mode. Since round 5 the running service installs it too (`src/apps/service/guard.ts`, D-INT-20). The allowlist is derived from the live slots and re-derived on every `PUT /settings`: nothing when every slot is on rules, the Ollama host when a slot is local, the api host only when a slot is api and `KT_NO_API` is unset, and slack.com only under `KT_SLACK_LIVE=1`. A refused call logs the route label it lacked. One consequence: with every slot on rules, Settings → Models cannot reach Ollama, so it reports Ollama as not answering until a slot is set to local.

**KT_NO_API.** `demo:judge` sets `KT_NO_API=1` (`scripts/demo-judge.mjs` line 69); the service then refuses keys and keeps any api slot unavailable (`src/apps/service/main.ts` line 47, `models.ts` line 43), and the desktop does not pass a stored key (`src/apps/desktop/main.ts` line 100). API keys live in Electron `safeStorage` and reach the service in memory only (D-B2-36).

## 8. The agent surface

The 12 MCP tools (`src/apps/service/mcp-tools.ts`, D-INT-15): `kt_investigate`, `kt_find_people`, `kt_request_clarification`, `kt_clarification_status`, `kt_cancel_clarification`, `kt_record_observation`, `kt_record_outcome`, `kt_get_context`, `kt_participation`, `kt_list_gaps`, `kt_propose_question`, `kt_store_health`. Each calls the same engine function as its HTTP route. `kt_investigate` asks no human by default (`allowQuestions: false`). An agent principal without groups sees only organization-wide knowledge.

`kt_list_gaps` returns each open gap with what an answer changes, whether it decides applicability, who could answer and whether they can be asked now, and a confidence block of labels and reasons (D-B7-06, D-B7-07). `kt_request_clarification` takes an optional `gapId` and `preferPersonEntityId`; the preference is honoured only if that person is an eligible recipient, otherwise the reply is refused with the person the engine would ask (D-B7-09, D-B7-14). Every gate stays: 3 a day, 1 open, 3 per investigation, cooldown, access, quiet hours. The agent never gets a channel to a person.

**The 03:00 sequence** (`scripts/mcp-demo.ts`, `pnpm demo:agent`, D-B7-11). The MCP server starts at 03:00 Helsinki with quiet hours on. The script calls `kt_investigate`, `kt_list_gaps`, picks the gap that decides applicability, `kt_find_people`, then `kt_request_clarification` preferring Erkki. Quiet hours queue it until 07:00. The clock moves to 07:30, Erkki's tap in the panel answers it, and `kt_get_context` and `kt_list_gaps` show the changed next step. `--simulate-tap` answers for rehearsals. No model is called.

## 9. The surfaces

- **Lumi companion and panel** (`src/libs/utils/ui/companion.ts`, `panel.ts`). Lumi sits at the screen edge and comes in on pointer, on a question or when asked. Panel views: input, question, queue, settings, receipt, result, people, case, contact, and Settings → Models. Questions offer Yes, No, Not sure, Later, Dismiss and Undo, with a "Why this question?" rationale.
- **Settings → Models**: per slot rules, local or api, a status chip, Download (`POST /models/pull`), Ollama install (`POST /models/install`), and an api key with a Test call.
- **Second screen**: `GET /demo/activity.html` shows the simulated day, Erkki's cost and the store health line. `scripts/demo-play.ts` drives the running service through a labelled simulated day and never reads the hidden answer keys.
- **demo:judge** (`scripts/demo-judge.mjs`): resets the data, starts the service with quiet hours off and `KT_NO_API=1`, starts the stream after 240 s, opens the activity page and launches Lumi.
- **Demo mode** is one desktop flag, `KT_DEMO`, set by `demo:judge` (`src/apps/desktop/flags.ts`, D-B6-01). It adds three things. The panel footer gets "Be Veikko / Be Erkki" chips that switch the current person through the same path as Settings → You (`ui/demo-chips.ts`, D-B6-02); on a clean clone without Elisa's files they read "Be Ville / Be Erkki". Lumi starts in and leaves after 120 s without pointer or keyboard activity (`COMPANION.DEMO_LEAVE_AFTER_IDLE_MS`, D-B6-03). The activity page carries a persistent "Simulated day" banner with the simulated clock, and nothing simulated appears on the panel (D-B6-04).
- **Clean clone.** Without `private/`, `pnpm demo:reset` seeds a synthetic older-units stand-in (TRN-233, invented people) so `demo:agent` still finds the applicability gap and asks Erkki (`data/demo/older-units-synthetic/`, `tests/clean-clone-agent.test.ts`).
- **What is demo-only**: the demo clock (`GET/POST /demo/clock`), `POST /demo/reset`, the activity page and stream, the fake Slack workspace, `--simulate-tap`, the demo flags.

## 10. Experiments and numbers

All from `experiments/RESULTS.md` and `docs/runs/2026-11-07-overnight/day2/E08-E10.md`. The dataset is scenario families v1.0.0: 10 families (demo 2, train 4, validation 2, test 2), 3 problems each. The answers come from an oracle reading the hidden key, so these are simulated people. Answer keys are unreviewed, so every number is provisional (E08-E10.md, first paragraph).

**E00, the rules baseline on the real system.** 17/17 checks pass, including test-family hashes matching `TEST_LOCK.json`, idempotent re-import on 8 families, and trace completeness 24/24. Selected metrics (demo / train / validation):
- claim recall 0.480 (12/25) / 0.681 (32/47) / 0.636 (14/22);
- recommendation kind accuracy 0.167 (1/6) / 0.250 (3/12) / 0.500 (3/6), against a majority-class baseline of 0.500 (3/6) / 0.500 (6/12) / 0.667 (4/6);
- linking recall@3 1.000 (8/8) / 0.889 (16/18) / 0.778 (7/9);
- questions per investigation 0 (0/6) / 0.333 (4/12) / 0 (0/6);
- truth-based access leakage 0.024 (1/42) on demo (an e-mail with no ACL metadata); system-detectable leakage 0/42, 0/89, 0/50.

**E08, retrieval with bge-m3.** Manifest `experiments/results/e08-retrieval-embed/manifest.json`, fixture sha256 `f9c12a9c4330cd09`; vectors replayed from `data/replays/e08-bge-m3/`. On validation all five arms (BM25, trigram, bge-m3, hybrid, hybrid+bge-m3) tie: recall@3 0.778 (7/9), lookalike rejection 0.500 (1/2). Train: recall@3 0.889 (16/18), lookalike rejection 1/1. Demo: recall@3 1.000 (8/8). The frozen criterion is met by a tie. Paraphrase probe on the demo store, rank of TRN-117 (the stand-in for TRN-042, since `private/` was absent when it ran): "green light, nothing flowing" is not found by BM25, 5th by trigram and hybrid, 1st by bge-m3 and hybrid+bge-m3. That probe is three sentences, not a measured rate.

**E09, extraction with qwen3:4b.** Manifest `experiments/results/e09-extraction-model/manifest.json`, per-family fixture hashes (for example bgp-firmware-flaps `30bb9d5b9c8c9d9e`), seed 7, 6 families, 24 threads. Claim recall, train: rules 0.681 (32/47), model alone 0.362 (17/47), union 0.702 (33/47). Precision, train: rules 0.552 (32/58), union 0.440 (33/75). Validation: recall rules 0.636 (14/22), union 0.636 (14/22); precision rules 0.412 (14/34), union 0.333 (14/42). The validator dropped 28 items in total (17 on train, 11 on validation). Latency: 24 calls, mean 36.5 s, max 86.4 s; 4/24 calls and 6/6 whole imports exceed the 60 s budget, so with the live budget every one of these imports falls back to rules. The experiment lifted the budget to score the output.

**E10, store metric and bandit.** Re-run after D-B2-66 and D-B2-67, offline, rules only. Families sha256 `885928361d0f3da7`, seeds 1 to 3, results hash-locked in `experiments/results/e10-store-metric/lock.json` (`resultsSha256` 9248c6506f594c97, checked by `tests/e10-lock.test.ts`). Before: 5 cases, completeness 0.45, correctness 0.0167 (3/180 supported claims over three seeds), product 0.0075. After the simulated day the product on those cases is unchanged for both selectors on every seed. Questions asked 9 per selector; answered rules 5/9, LinUCB 6/9. No per-answer delta is negative any more (the sums were -6.77 and -13.54 points under the old reading). Completeness on the touched cases rose on 3/5 answers for rules (+12.49 points) and 4/6 for LinUCB (+16.66 points), but correctness on those cases is 0, so the product hides the gain. LinUCB wins 0/3 seeds; rules stay the default. A positive product delta does exist where a case has a supported claim: the RTR-117 outcome question answered Yes measures +2.25 points (`tests/store-health.test.ts`).

**Local-model done-lines** (recorded once each on 8 November with Elisa's files present, `E08-E10.md` section "Local-model done-lines", D-B2-70 to D-B2-73). These are single runs, not scored experiments.
- embed=local (bge-m3): "green light, nothing flowing" puts TRN-042 first, 0.667, as rules already did (0.625). bge-m3 changes the runners-up to the two other no-traffic-after-SFP cases. Met.
- extract=local (qwen3:4b): the Elisa thread imports in 41.8 s of the 60 s budget, labelled `ollama-extract@1:qwen3:4b`. The model proposed 5 claims and the validator kept 3; 1 new claim was committed, and the 121 rules claims are intact. Met.
- phrase=local (qwen3:4b): the model echoed the template sentence, so the card keeps template wording. Not met.

**What is weak.** Denominators are tiny (a validation lookalike rate rests on 2 problems). The data is synthetic and the people are simulated. Kind accuracy is at or below the majority baseline on every split in E00. The embedding gain shows only on a hand-picked paraphrase probe. The model extractor is too slow for its budget on this Mac. The store product did not move in a simulated day, because the touched cases have no supported claim yet; completeness did rise. phrase=local did not produce its own wording. The older learning experiment E03 asked no validation question on the family arm (RESULTS.md, "Reading the results first"). Real-user performance: not measured.

## 11. Known limits and open questions

1. **Lexicons decide what exists.** A paraphrase outside `problem-parser.ts` or `extraction-config.ts` yields no condition, so no match, no gap, no question. Embeddings help find the case, but not the condition that decides applicability.
2. **Distinguishing keys are hand-configured** (`settings.ts` line 91). A new equipment family needs new keys and templates.
3. **The metric's correctness denominator** is all live case claims, not only cited ones (D-B2-29), and `asked today` in the burden counts by UTC day while quiet hours use Helsinki time. Both are disclosed in SUBMISSION section 6.
4. **The bandit is off by default and has not won anywhere on real-shaped data.** Live state persists, but only if someone switches the selector.
5. **Ollama detection with every slot on rules** is blocked by the service guard, so Settings → Models shows Ollama as not answering until a slot is local (D-INT-20). Whether to allow detection is your call.
6. **Access on paste**: the service does not clamp `accessGroups` to the caller (D-B4-10). E-mail has no ACL source, which is the one truth-based leak in E00.
7. **Slack**: thread replies are not read (D-B4-13); the `im:history` scope question is open (D-B4-20).
8. **Times**: the Elisa thread has no dates, so ordering falls back to import order and supersession needs an explicit cue.
9. **Value / cost ranking** covers investigation questions; standing gaps still go in a fixed kind order. There is still no burden meter widget, only Erkki's cost line.
10. **Demo fragility**: rules-selector ties break by id order, and the experts-disagree question goes to Helmi once Erkki has answered TRN-301 (D-INT-17).
11. **Not verified**: the Electron companion was not clicked through on a clean clone; the chips were checked in a browser against the bundled renderer. The live Slack round trip (B4 D2) was never run, because no sandbox workspace was named. Real-user performance is not measured.
