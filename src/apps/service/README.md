# service

One local process exposing the Knowledge Twin engine as an HTTP JSON API (127.0.0.1) and as an MCP server over stdio. Both call the same `Engine` functions, so permissions, question limits, stable ids and trace events are identical for every caller (desktop, agent, harness).

## Launch
```
pnpm service                                   # HTTP on 127.0.0.1:47831, db data/local/knowledge-twin.sqlite
node src/apps/service/main.ts --port 0 --db :memory: --seed synthetic
node src/apps/service/mcp.ts --db data/local/knowledge-twin.sqlite [--agent-id id --agent-name name --agent-groups a,b]
pnpm demo:reset [-- --db path --seed elisa|synthetic|empty]   # scripts/demo-reset.ts
```
`main.ts`: `--port`, `--host` (default 127.0.0.1), `--db` (path or `:memory:`), `--seed` (runs the demo reset first). Prints `Knowledge Twin service listening on <url>`, logs requests to stderr, shuts down on SIGINT/SIGTERM. `mcp.ts` writes only protocol to stdout; it also takes `--quiet-hours on|off` (default the org-config window, on), `--clock <iso>` (B7: start the engine clock at a simulated moment, e.g. `2026-11-08T01:00:00Z` = 03:00 Helsinki; it then runs at real speed), `--standing-gaps off`, `--org-policy none` and `--agent-id/--agent-name/--agent-groups`. MCP client config: `{"command":"node","args":["src/apps/service/mcp.ts"]}`.

## Files
`engine.ts` (composition and all behavior), `http.ts` (router, validation, errors), `mcp-tools.ts` (tool registration) + `mcp.ts` (stdio entry), `views.ts` (ResultView/QuestionView/PersonView builders), `schemas.ts` (zod), `directory.ts` (people.json -> person entities), `demo.ts` (demo reset), `errors.ts`, `paths.ts`. Participation lives in `src/libs/utils/participation`.

## HTTP API (contracts/service.ts `ApiRoutes`, 42 routes)
| Route | Notes |
|---|---|
| `GET /health` | `{ok, version, store, routes}` (routes actually served) |
| `POST /import` | formats teams-json, email-text, slack-export, slack-live, scenario-dir (path on this machine or inline payload), and B4 `paste` (inline only: the text, or `{text, attachmentNames?, authorName?}`; a chat thread, e-mail or Teams JSON inside is recognised and keeps its speakers; blank text is 400). A paste answers with `captured {cases[{id,title}], entities, people, from?, to?, dateKnown, alreadyKnown}` for the receipt. A scenario dir's `people.json` is applied as the directory. R46: `points` lists who earned for authored evidence that became a claim (people who take part only) |
| `GET /connections` | connector cards with last import batch |
| `GET /cases`, `GET /cases/:id` | access-filtered; optional `?principalId=` (directory person), else the settings' current person, else anonymous (organization-wide cases only) |
| `POST /investigate` | stable id from (principal, text, entities, observations, attachments): repeating a request is idempotent. `allowQuestions` default true over HTTP. B1: `at` (ISO with a zone) answers as of that moment: its own investigation id, later evidence/answers/claims left out, nobody asked; invalid `at` is 400. B3: `atEvidence` (evidence id, with `at` or now) shows undated evidence only of that evidence's thread up to it (the Context Layer slider inside a thread with no date); `preview: true` computes the result and persists nothing (no investigation, trace event, question or decision record). The result carries `provenance` (the strip under the headline, through the requester's gate) whenever the recommendation or the case it points at rests on a visible claim; with nothing found (`kind: none`, no case) there is nothing to cite and the field is absent (D-INT-21). Minimal body: `{"text": "TRN-233: what should I know before working on it?", "principal": {"id": "<person id>", "displayName": "...", "groups": [], "type": "human"}}` (`principal` is an object, not an id string; the text must name an asset or you pass `entityIds`). The Context Layer page sends `{text, principal, entityIds: [<entity id from GET /context>], allowQuestions: false, preview: true}` |
| `GET /investigations/:id` | optional `?principalId=` must be the starter (403 otherwise) |
| `GET /context` | B1: `?entity=` (id, name or alias) `&at=` (default now) `&principalId=`: assertions bound to the entity with validity windows (`validFrom`/`validTo` as time positions, never a synthesised iso), `validAt`, status (`superseded` + `supersededBy`), validity condition, asserter, source (provider, time text, excerpt), plus bindings (firsthand people, hedged classes). Access as every read: an entity the principal may not see is 404 |
| `GET /questions` | `personEntityId` (an entity id, a directory id or a provider identity such as `person:slack:U…`, resolved through the directory like the answer path), `status` (default open: queued, delivered, deferred; `all` for everything) |
| `GET /questions/:id` | viewed as the recipient |
| `POST /questions/:id/answer` | recipient only (403). Same answer again is idempotent; a different one needs undo first (409). Receipt carries `pointsAwarded` when the recipient takes part in points (yes/no 2, not sure 0) |
| `POST /questions/:id/defer`, `/dismiss`, `/undo` | recipient only |
| `POST /questions/:id/cancel` | only the requester that started the investigation (human or agent) |
| `POST /preferences` | preference between two questions; own person only; never evidence |
| `POST /observations` | starter only; resolves matching gaps, cancels obsolete questions |
| `POST /outcomes` | starter only; stored as its own `OutcomeReport` + evidence, never written into the historical case; identical report is idempotent |
| `GET /people` | `investigationId`, `principalId` (starter) |
| `POST /contact-draft` | reviewable message: current symptoms, checks performed, unresolved question. Person must be in the requester's people list. Never sent |
| `GET /directory` | `DirectoryEntry[]` `{personEntityId, name, role?, groups, available}` sorted by name: the visible organization directory (never knowledge or answers). The desktop's "You" picker reads it |
| `GET /settings`, `PUT /settings` | settings record `user` in the store; unknown keys are 400; extension `selectorId` (default `rules`) |
| `GET /participation/:personEntityId` | own balance and events (R46): `?principalId=` (else the settings' current person) must resolve to that person, 403 otherwise; `{participates: false, points: 0, events: []}` for a person who does not take part |
| `GET` / `PUT /participation/:personEntityId/optin` | whether the person takes part in points (default no); PUT `{principal, participates}` only by that person (403). Opting out hides the rows, nothing is deleted |
| `GET /participation/rating` | rating among the people who take part (balance, last 7 days, answers, outcomes, rank, totals); `?personEntityId=` (must be the caller) fills `me` with the last 10 events. People who do not take part appear nowhere |
| `POST /demo/reset` | `{seed?, defaultPerson?}`: clear (settings kept), import Elisa example if present under `private/`, the `demo` split families (sources + people.json only), `data/fixtures/dev-family-01` and (B1) the generated dated follow-ups in `data/demo/followups/`; `empty` only clears |
| `GET /demo/activity`, `GET /demo/activity.html` | the activity log (`since`, `limit`) as JSON, and a page that shows it |
| `GET /costs` | B3, "Erkki's cost": `?personEntityId=` (default: the most-asked person, else the settings' current person; 404 for an unknown person) `&principalId=` (scopes the store line). From store records only (questions, answers, evaluations, investigations): asked / answered / deferred / dismissed / open / cancelled, answer seconds (delivery to answer on the engine clock, labelled `simulated` under the demo clock), reuse of the person's knowledge by people and by agents (distinct stored investigations with a reuse / check-first / qualified recommendation citing their messages or claims; previews, point-in-time views and standing upkeep never count), and `storeHealth` (BUILD_BRIEF 5.5 line with denominators; the "before" is the last demo reset, kept in memory). `costs.ts` |
| `GET /context.html` | B3: the Context Layer page for `?entity=<name>` (`&principalId=`, `&text=`): evidence diamonds, claim bars with validity windows, bindings and people on a time axis that never invents a date, and a t slider; the card shows what an agent is told at t from `POST /investigate` with `preview: true`. The page holds no data; it fetches per viewer (`context-page.ts`) |
| `GET /events` | trace events by `traceId` / `since` |

Errors are `{error: message}` with 400 (validation), 403 (not allowed / not recipient / not starter), 404, 405, 409 (lifecycle), 413, 415 (bodies must be `application/json`). Requests whose Host is not loopback are refused (DNS rebinding guard). No CORS headers (the desktop shim handles its origin).

## MCP tools (`MCP_TOOLS`)
| Tool | Calls | Meaning for the agent |
|---|---|---|
| `kt_investigate` (text, principal?, observations?, allowQuestions?, at?) | `POST /investigate` | qualified recommendation, matches, people, ids; no human is asked unless `allowQuestions` (default false for agents); `at` = as of that moment |
| `kt_get_context` (investigationId, at?) | `GET /investigations/:id` | current state, gaps with what an answer would change; with `at`, the stored problem re-run as of then (`Engine.contextAt`, starter only) |
| `kt_request_clarification` (investigationId, gapId?, preferPersonEntityId?, gapIds?) | coordinator loop | `question-open` + questionId (`deliverAfter` when held by quiet hours), or `deferred` / `exhausted` / `not-needed` with reason (limits, cooldown, access). B7: `gapId` asks about that gap only; `preferPersonEntityId` asks that person only if every gate allows it, else `refused` with the person's gates in words and `wouldAsk` (who the engine would ask instead); `gapIds` (max 3) asks each gap of its own best person, every budget applying, and returns `questions[]` |
| `kt_list_gaps` (investigationId) | `Engine.listGaps` (MCP only) | B7: every open gap: what an answer changes, `decides` applicability / support / nothing, `requesterCanCheck`, who could answer (entity id, name, role, firsthand, because, `askableNow` with the gates that stop them), the template question and an accepted agent wording; a `confidence` block for the basis case (support and applicability labels, reasons, visible evidence refs, `movedByGapIds`, `settledBy`) with no number in it; quiet-hours state |
| `kt_propose_question` (investigationId, gapId, text) | `Engine.proposeQuestion` (MCP only) | B7: the agent's own wording, accepted only through the phrase validator (one yes/no sentence < 160 chars naming the asset and the condition, nothing absent from the gap and the visible case); used for that gap's next question (card: "worded by the agent"); else `{accepted: false, reasons, usedText}` = the template |
| `kt_store_health` () | `Engine.storeHealthView` (MCP only) | B7: completeness and correctness with denominators, singletons, thin pairs and the open standing gaps, over the cases the principal may see (evidence gate); no HTTP route |
| `kt_clarification_status` (questionId) | `GET /questions/:id` | status; answer value when answered; unknown = no update, deferred/dismissed != no |
| `kt_cancel_clarification` (questionId, reason?) | `POST /questions/:id/cancel` | cancel what you started |
| `kt_record_observation` (investigationId, condition, caseId?) | `POST /observations` | attributed observation; rebuilds the recommendation |
| `kt_record_outcome` (investigationId, result, ...) | `POST /outcomes` | separate attributed report; does not verify a cause |
| `kt_find_people` (investigationId) | `GET /people` | experience reasons, askable flag; ask through the loop, do not contact directly |

Every tool takes `principal: {id, displayName, groups}` (always treated as type `agent`); omitted means a group-less default agent. Investigations belong to the principal that started them.

## Behavior worth knowing
- Access: investigations run with the starter's principal; retrieval, case views, people and question timelines are filtered by it. A caller known to the directory (with groups) can never exceed the person's groups = directory groups plus source-derived channel memberships (a private Slack channel's members, recorded on the person as `member-of:<group>`, additive; the directory stays the authority for organization groups); for unknown principals the claimed groups are trusted (the prototype does not authenticate).
- Question limits (daily, cooldown, max open, per-investigation) are the coordinator's hard eligibility; they apply to agents the same as to people. Configure through `EngineOptions.coordinator` / `investigation`.
- Selector from settings `selectorId` (`rules` default; `linucb`, `epsilon-greedy`, `random`, `ranker-replay`; aliases bandit/ranker). Routes used appear on every result; nothing here calls a model provider.
- Mutating calls append trace events (store `trace` table, mirrored into `InvestigationState.events`).
- Several processes may share one SQLite file (WAL); the HTTP service and an MCP process on the same file see each other's writes. A new row's counter is moved past the one on disk, so two writers never collide on the search rowid (D-B7-10).
- B7 inquiry (DECISIONS-inquiry): the coordinator's request options (`gapId`, `preferPersonEntityId`, `dryRun`, `skipActiveCheck`, `excludePersonIds`) are filters over a pure `plan()`; no option widens a gate. A refused preference writes only a `clarification.refused` trace event. Agent wordings are `question.proposed` trace events read by `AgentWordedGenerator` (route `agent-worded@1`, `phrasing.by: 'agent'`). Confidence is labels with reasons and evidence; retrieval scores are never shown under a confidence name.

## Checks run
`pnpm test` includes `tests/e2e.test.ts` (10), `tests/mcp.test.ts` (5, real stdio child), `tests/inquiry.test.ts` (8, B7 over a real stdio child each), `tests/permissions.test.ts` (5, HTTP and MCP), `tests/service-main.test.ts` (2). See the worker report for counts.

## Known limitations
- No authentication: caller identity is asserted in the request. Do not expose beyond loopback.
- `POST /import` reads any local path the process can read (local prototype).
- `GET` reads without a principal (`/questions`, `/investigations/:id` without `principalId`) are trusted-local reads.
- The directory (people.json) is re-applied after imports only for directories loaded in the running process.
- A re-asked identical problem by the same principal maps to the same investigation (by design).
- No CORS, no TLS, no rate limiting.

## Fix pass notes
- POST/PUT require `Content-Type: application/json` even with no body (blocks cross-origin simple requests such as a bodyless `/demo/reset`); send `{}`.
- Directory persons are capped at their directory groups plus source-derived memberships exactly, including an empty list. `applyDirectory` merges the two; it never drops a channel membership.
- Undoing a cancellation is owner-only. Answering or dismissing a deferred question undoes the deferral first.
- Malformed percent-encoded path parameters return 400.

## Identity in the desktop app
- The panel's Settings has a "You" row (a `<select>` of `GET /directory`, `name · role`), stored with `PUT /settings {currentPersonEntityId}`. Every call's principal is built from that directory entry (id, displayName = name, groups from the directory, type human).
- Nobody chosen: investigating still works as the labeled guest `{id:'person:desktop:guest', displayName:'Guest', groups:[]}`; the queue says "Choose who you are in Settings to see your questions." and no person is invented. A guest is never a question recipient, so the service answers 403 to any answer/defer/dismiss/undo by it (`tests/identity.test.ts`).
- The question badge counts only the current person's questions. It refreshes when the panel opens and after answering, and polls `GET /questions` every 20 s only while the panel is open (no timer at all while collapsed).

## B1 part B (access facts, quiet hours, standing gaps)

- `POST /investigate` answers a site-access question ("I'm driving out to RBS-310 tomorrow. What's the barrier code?") from the access facts bound to the site (`reuse`/`none`, `recommendation.askWho` in the state when missing or lapsed; never the field group).
- Quiet hours (`org-config.ts defaultQuietHours`, wired by `main.ts`/`mcp.ts` unless `--quiet-hours off` or `--org-policy none`, and by `scripts/demo-reset.ts`): a question created 22:00-07:00 Helsinki time stays `queued` with `deliverAfter`; `GET /questions` hides it until then; moving the demo clock (`POST /demo/clock`), listing questions, investigating, requesting clarification and reading a clarification status deliver what is due. `QuestionView` carries `deliverAfter` while held and `answerType: 'free-text'` for a standing missing-symptom question.
- Standing gaps (`org-config.ts defaultStandingGaps`, same wiring, `--standing-gaps off`): recorded on every import and clock move, asked through the coordinator after imports, answers and `Engine.upkeep()`. A free-text answer is `POST /questions/:id/answer {value: 'yes', text}`.

## Network guard (D-INT-20, `guard.ts`)
- `main.ts` replaces `globalThis.fetch` before listening. The allowlist is re-derived from the live settings on every call: nothing with every slot on `rules`; `http://127.0.0.1:11434` while a slot is `local`; `api.anthropic.com` and `generativelanguage.googleapis.com` only while a slot is `api` and `KT_NO_API` is not `1`; `https://slack.com` only under `KT_SLACK_LIVE=1`; and the service's own origin. A refused call throws `NetworkProviderBlockedError` and logs `network guard refused fetch to <origin>; missing route: <route label>` to stderr. Consequence: with every slot on rules the Models panel cannot see Ollama (detection reports it as not answering) until a slot is switched to local.

## Model slots (B2, `models.ts`)
- `PUT /settings {models: {embed|extract|phrase: {provider: 'rules'|'local'|'api', model?}}}` changes only the slots named; every slot is `rules` by default (`DEFAULT_MODEL_SLOTS` in `org-config.ts`, overridable by `EngineOptions.models`). No API key is ever accepted in settings.
- `ModelManager` (`engine.models`): `GET /models` (detection: `which ollama`, `/api/version`, `/api/tags`, total RAM, free disk; the catalog `data/models/catalog.json` merged with installed models; a status chip per slot: `off`, `not downloaded`, `downloading N%`, `ready`, `failed: <reason>`), `POST /models/pull {model}` -> job polled with `GET /models/pull/:id` (nothing is pulled without that POST), `POST /models/key {provider, key}` (memory only: never SQLite, data/, traces or responses), `POST /models/test {provider, model?}` (one tiny call, reports the model that answered).
- `main.ts`: at start, every slot on `local` is warmed (an empty request, keep_alive 30m; `ollama serve` is started when installed but down); a model unloads after 30 minutes without a call; on SIGINT/SIGTERM everything the service loaded is unloaded (keep_alive 0) and a server it started is stopped. Slots on rules or api start nothing. `KT_AUTO_MODELS=0` turns the automatic work off.
- embed=local: `engine.embeddingIndex()` is a view over r_embedding with the cached provider; `refreshEmbeddings()` (serialized, after imports, answers and outcome reports when `autoModels` is on) embeds new or changed evidence, claims and case cards; investigations fuse the embedding list instead of trigrams. Tests inject a fake local provider through `EngineOptions.modelManager`; no test reaches Ollama.
- extract=local|api: `POST /import` is `engine.importAndEnrich`: the rules import, then the model's proposal per thread, validated (every claim, entity and link quotes its message) and committed as a union within 60 s; the response carries `extraction {route, modelClaims, dropped, fallback?}`. `importData` (demo reset, scripts) stays rules-only and synchronous.
- phrase=local|api: `wiring()` wraps the templates in `PhrasedQuestionGenerator`; `QuestionView.wordedBy` says "worded by local model <m>" only for accepted wording. Only quick yes/no questions of the `missing` and `outcome` kinds are phrased (standing outcome questions included); standing missing-symptom and pairing questions keep the template (D-INT-07). The standing pass after an answer reuses the answer's wiring, so the request has one phrase budget, and its eligibility pre-check uses the templates (D-INT-12).
- `POST /models/install` / `GET /models/install`: `brew install ollama` (macOS, Homebrew present, only from a click) with the output kept for the panel, then `ollama serve`; without Homebrew `unavailable` with the download link and the commands.
- Reward (BUILD_BRIEF 5.4): each answer to an investigation question writes `assessedBenefit {value, method: 'store-metric-delta@1'}` and `QuestionRecord.reward`, then calls `selector.update`; an outcome report re-measures answered outcome questions. Answers to B1's standing questions (`answerStanding`) record the evaluation's response only: no reward, no selector update (D-INT-11). The burden's quiet-hours term uses B1's `inQuiet` (local time in the quiet hours' zone, D-INT-06). Live LinUCB state is saved to `linucb-live.json` next to a file database (data/local/) and loaded back (`EngineOptions.linucbStatePath`, `false` = off). `engine.storeHealth(principalId?)` returns the store metric with its denominators.
