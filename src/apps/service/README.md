# service

One local process exposing the Knowledge Twin engine as an HTTP JSON API (127.0.0.1) and as an MCP server over stdio. Both call the same `Engine` functions, so permissions, question limits, stable ids and trace events are identical for every caller (desktop, agent, harness).

## Launch
```
pnpm service                                   # HTTP on 127.0.0.1:47831, db data/local/knowledge-twin.sqlite
node src/apps/service/main.ts --port 0 --db :memory: --seed synthetic
node src/apps/service/mcp.ts --db data/local/knowledge-twin.sqlite [--agent-id id --agent-name name --agent-groups a,b]
pnpm demo:reset [-- --db path --seed elisa|synthetic|empty]   # scripts/demo-reset.ts
```
`main.ts`: `--port`, `--host` (default 127.0.0.1), `--db` (path or `:memory:`), `--seed` (runs the demo reset first). Prints `Knowledge Twin service listening on <url>`, logs requests to stderr, shuts down on SIGINT/SIGTERM. `mcp.ts` writes only protocol to stdout. MCP client config: `{"command":"node","args":["src/apps/service/mcp.ts"]}`.

## Files
`engine.ts` (composition and all behavior), `http.ts` (router, validation, errors), `mcp-tools.ts` (tool registration) + `mcp.ts` (stdio entry), `views.ts` (ResultView/QuestionView/PersonView builders), `schemas.ts` (zod), `directory.ts` (people.json -> person entities), `demo.ts` (demo reset), `errors.ts`, `paths.ts`. Participation lives in `src/libs/utils/participation`.

## HTTP API (contracts/service.ts `ApiRoutes`, 40 routes)
| Route | Notes |
|---|---|
| `GET /health` | `{ok, version, store, routes}` (routes actually served) |
| `POST /import` | formats teams-json, email-text, slack-export, slack-live, scenario-dir (path on this machine or inline payload), and B4 `paste` (inline only: the text, or `{text, attachmentNames?, authorName?}`; a chat thread, e-mail or Teams JSON inside is recognised and keeps its speakers; blank text is 400). A paste answers with `captured {cases[{id,title}], entities, people, from?, to?, dateKnown, alreadyKnown}` for the receipt. A scenario dir's `people.json` is applied as the directory. R46: `points` lists who earned for authored evidence that became a claim (people who take part only) |
| `GET /connections` | connector cards with last import batch |
| `GET /cases`, `GET /cases/:id` | access-filtered; optional `?principalId=` (directory person), else the settings' current person, else anonymous (organization-wide cases only) |
| `POST /investigate` | stable id from (principal, text, entities, observations, attachments): repeating a request is idempotent. `allowQuestions` default true over HTTP. B1: `at` (ISO with a zone) answers as of that moment: its own investigation id, later evidence/answers/claims left out, nobody asked; invalid `at` is 400 |
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
| `GET /events` | trace events by `traceId` / `since` |

Errors are `{error: message}` with 400 (validation), 403 (not allowed / not recipient / not starter), 404, 405, 409 (lifecycle), 413, 415 (bodies must be `application/json`). Requests whose Host is not loopback are refused (DNS rebinding guard). No CORS headers (the desktop shim handles its origin).

## MCP tools (`MCP_TOOLS`)
| Tool | Calls | Meaning for the agent |
|---|---|---|
| `kt_investigate` (text, principal?, observations?, allowQuestions?, at?) | `POST /investigate` | qualified recommendation, matches, people, ids; no human is asked unless `allowQuestions` (default false for agents); `at` = as of that moment |
| `kt_get_context` (investigationId, at?) | `GET /investigations/:id` | current state, gaps with what an answer would change; with `at`, the stored problem re-run as of then (`Engine.contextAt`, starter only) |
| `kt_request_clarification` (investigationId) | coordinator loop | `question-open` + questionId, or `deferred` / `exhausted` / `not-needed` with reason (limits, cooldown, access) |
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
- Several processes may share one SQLite file (WAL); the HTTP service and an MCP process on the same file see each other's writes.

## Checks run
`pnpm test` includes `tests/e2e.test.ts` (10), `tests/mcp.test.ts` (5, real stdio child), `tests/permissions.test.ts` (5, HTTP and MCP), `tests/service-main.test.ts` (2). See the worker report for counts.

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

## Model slots (B2, `models.ts`)
- `PUT /settings {models: {embed|extract|phrase: {provider: 'rules'|'local'|'api', model?}}}` changes only the slots named; every slot is `rules` by default (`DEFAULT_MODEL_SLOTS` in `org-config.ts`, overridable by `EngineOptions.models`). No API key is ever accepted in settings.
- `ModelManager` (`engine.models`): `GET /models` (detection: `which ollama`, `/api/version`, `/api/tags`, total RAM, free disk; the catalog `data/models/catalog.json` merged with installed models; a status chip per slot: `off`, `not downloaded`, `downloading N%`, `ready`, `failed: <reason>`), `POST /models/pull {model}` -> job polled with `GET /models/pull/:id` (nothing is pulled without that POST), `POST /models/key {provider, key}` (memory only: never SQLite, data/, traces or responses), `POST /models/test {provider, model?}` (one tiny call, reports the model that answered).
- `main.ts`: at start, every slot on `local` is warmed (an empty request, keep_alive 30m; `ollama serve` is started when installed but down); a model unloads after 30 minutes without a call; on SIGINT/SIGTERM everything the service loaded is unloaded (keep_alive 0) and a server it started is stopped. Slots on rules or api start nothing. `KT_AUTO_MODELS=0` turns the automatic work off.
- embed=local: `engine.embeddingIndex()` is a view over r_embedding with the cached provider; `refreshEmbeddings()` (serialized, after imports, answers and outcome reports when `autoModels` is on) embeds new or changed evidence, claims and case cards; investigations fuse the embedding list instead of trigrams. Tests inject a fake local provider through `EngineOptions.modelManager`; no test reaches Ollama.
- extract=local|api: `POST /import` is `engine.importAndEnrich`: the rules import, then the model's proposal per thread, validated (every claim, entity and link quotes its message) and committed as a union within 60 s; the response carries `extraction {route, modelClaims, dropped, fallback?}`. `importData` (demo reset, scripts) stays rules-only and synchronous.
- phrase=local|api: `wiring()` wraps the templates in `PhrasedQuestionGenerator`; `QuestionView.wordedBy` says "worded by local model <m>" only for accepted wording. Only quick yes/no questions of the `missing` and `outcome` kinds are phrased (standing outcome questions included); standing missing-symptom and pairing questions keep the template (D-INT-07). The standing pass after an answer reuses the answer's wiring, so the request has one phrase budget, and its eligibility pre-check uses the templates (D-INT-12).
- `POST /models/install` / `GET /models/install`: `brew install ollama` (macOS, Homebrew present, only from a click) with the output kept for the panel, then `ollama serve`; without Homebrew `unavailable` with the download link and the commands.
- Reward (BUILD_BRIEF 5.4): each answer to an investigation question writes `assessedBenefit {value, method: 'store-metric-delta@1'}` and `QuestionRecord.reward`, then calls `selector.update`; an outcome report re-measures answered outcome questions. Answers to B1's standing questions (`answerStanding`) record the evaluation's response only: no reward, no selector update (D-INT-11). The burden's quiet-hours term uses B1's `inQuiet` (local time in the quiet hours' zone, D-INT-06). Live LinUCB state is saved to `linucb-live.json` next to a file database (data/local/) and loaded back (`EngineOptions.linucbStatePath`, `false` = off). `engine.storeHealth(principalId?)` returns the store metric with its denominators.
