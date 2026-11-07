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

## HTTP API (contracts/service.ts `ApiRoutes`, 24 routes)
| Route | Notes |
|---|---|
| `GET /health` | `{ok, version, store, routes}` (routes actually served) |
| `POST /import` | formats teams-json, email-text, slack-export, scenario-dir (path on this machine or inline payload); a scenario dir's `people.json` is applied as the directory |
| `GET /connections` | connector cards with last import batch |
| `GET /cases`, `GET /cases/:id` | access-filtered; optional `?principalId=` (directory person), else the settings' current person, else anonymous (organization-wide cases only) |
| `POST /investigate` | stable id from (principal, text, entities, observations, attachments): repeating a request is idempotent. `allowQuestions` default true over HTTP |
| `GET /investigations/:id` | optional `?principalId=` must be the starter (403 otherwise) |
| `GET /questions` | `personEntityId`, `status` (default open: queued, delivered, deferred; `all` for everything) |
| `GET /questions/:id` | viewed as the recipient |
| `POST /questions/:id/answer` | recipient only (403). Same answer again is idempotent; a different one needs undo first (409). Receipt carries `pointsAwarded` when points are on |
| `POST /questions/:id/defer`, `/dismiss`, `/undo` | recipient only |
| `POST /questions/:id/cancel` | only the requester that started the investigation (human or agent) |
| `POST /preferences` | preference between two questions; own person only; never evidence |
| `POST /observations` | starter only; resolves matching gaps, cancels obsolete questions |
| `POST /outcomes` | starter only; stored as its own `OutcomeReport` + evidence, never written into the historical case; identical report is idempotent |
| `GET /people` | `investigationId`, `principalId` (starter) |
| `POST /contact-draft` | reviewable message: current symptoms, checks performed, unresolved question. Person must be in the requester's people list. Never sent |
| `GET /settings`, `PUT /settings` | settings record `user` in the store; unknown keys are 400; extension `selectorId` (default `rules`) |
| `GET /participation/:personEntityId` | balance and events; points only awarded while `settings.points` is on |
| `POST /demo/reset` | `{seed?}`: clear (settings kept), import Elisa example if present under `private/`, the `demo` split families (sources + people.json only) and `data/fixtures/dev-family-01`; `empty` only clears |
| `GET /events` | trace events by `traceId` / `since` |

Errors are `{error: message}` with 400 (validation), 403 (not allowed / not recipient / not starter), 404, 405, 409 (lifecycle), 413, 415 (bodies must be `application/json`). Requests whose Host is not loopback are refused (DNS rebinding guard). No CORS headers (the desktop shim handles its origin).

## MCP tools (`MCP_TOOLS`)
| Tool | Calls | Meaning for the agent |
|---|---|---|
| `kt_investigate` (text, principal?, observations?, allowQuestions?) | `POST /investigate` | qualified recommendation, matches, people, ids; no human is asked unless `allowQuestions` (default false for agents) |
| `kt_get_context` (investigationId) | `GET /investigations/:id` | current state, gaps with what an answer would change |
| `kt_request_clarification` (investigationId) | coordinator loop | `question-open` + questionId, or `deferred` / `exhausted` / `not-needed` with reason (limits, cooldown, access) |
| `kt_clarification_status` (questionId) | `GET /questions/:id` | status; answer value when answered; unknown = no update, deferred/dismissed != no |
| `kt_cancel_clarification` (questionId, reason?) | `POST /questions/:id/cancel` | cancel what you started |
| `kt_record_observation` (investigationId, condition, caseId?) | `POST /observations` | attributed observation; rebuilds the recommendation |
| `kt_record_outcome` (investigationId, result, ...) | `POST /outcomes` | separate attributed report; does not verify a cause |
| `kt_find_people` (investigationId) | `GET /people` | experience reasons, askable flag; ask through the loop, do not contact directly |

Every tool takes `principal: {id, displayName, groups}` (always treated as type `agent`); omitted means a group-less default agent. Investigations belong to the principal that started them.

## Behavior worth knowing
- Access: investigations run with the starter's principal; retrieval, case views, people and question timelines are filtered by it. A caller known to the directory (with groups) can never exceed the directory's groups; for unknown principals the claimed groups are trusted (the prototype does not authenticate).
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
- Directory persons are capped at their directory groups exactly, including an empty list.
- Undoing a cancellation is owner-only. Answering or dismissing a deferred question undoes the deferral first.
- Malformed percent-encoded path parameters return 400.
