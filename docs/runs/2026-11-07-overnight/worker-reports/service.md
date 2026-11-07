# Service worker report

## Built
- `src/apps/service/`: `engine.ts` (composition: store, import, investigate, coordinator, selector from settings, case views, people, contact drafts, participation, trace), `http.ts` + `main.ts` (all 24 `ApiRoutes`, zod validation, JSON errors, stderr log, graceful shutdown, loopback Host guard, JSON-only bodies), `mcp-tools.ts` + `mcp.ts` (8 tools, stdio), `views.ts`, `schemas.ts`, `directory.ts`, `demo.ts`, `errors.ts`, `paths.ts`, README with launch commands and tables.
- `src/libs/utils/participation/`: point awarding deduplicated by contribution id, equal credit for useful No, neutral unknown/defer/dismiss, revoke on undo, README.
- `scripts/demo-reset.ts`: runs the demo reset on the default (or `--db`) database and prints per-import counts (verified: Elisa teams/email from `private/`, two demo families, dev-family-01: 6 cases, 104 claims, 21 people).
- `tests/`: `e2e.test.ts`, `mcp.test.ts`, `permissions.test.ts`, `service-main.test.ts`, `support.ts`.

## Checks run
- `pnpm typecheck`: passes for the whole repo.
- `pnpm test`: 173 tests, 173 pass (whole repo). Mine: participation 4, tests/ 22 (e2e 10, mcp 5, permissions 5, main 2).
- e2e covers: import dev-family-01, GET /cases, investigate lookalike (recommendation + people + routes, not `reuse`), question to recipient, wrong principal 403, yes -> receipt -> undo -> no flips recommendation to `retain-uncertainty`, observation resolves gap, outcome idempotent, consistent ids, contact draft, trace events, points off by default / on, retry does not double, demo reset (settings kept, directory applied).
- MCP test spawns `mcp.ts` as a real stdio child on a shared on-disk db and compares ids/views with HTTP.

## Decisions and deviations
- Contract GET routes carry no principal. Added optional `?principalId=`; without it: `GET /cases` uses the settings' current person, else anonymous (org-wide cases only); `GET /investigations/:id` is a trusted-local read.
- Investigation ids are stable: problem id = hash of (org, principal id, text, entityIds, observations, attachments), so repeats are idempotent.
- `POST /outcomes` never writes an `Outcome` into the historical case (a different incident trying a past response must not rewrite the past); it stores an `OutcomeReport` + evidence, `createdOutcomeId` is omitted.
- MCP agents: `allowQuestions` defaults to false (explicit `kt_request_clarification` to ask); principal arg optional, defaults to a group-less agent; always type `agent`.
- Directory persons cannot exceed their directory groups even if the request claims more; unknown principals' claimed groups are trusted (no authentication in the prototype).
- Settings extension `selectorId` (not in `UserSettings`); GET /settings returns it in addition.
- The user's message about the "snowbally" animation / ChatGPT panel design concerns the desktop app; not touched here.

## Limitations
See the service README (no authentication, local path import, trusted-local GETs, directory re-apply only for directories loaded in the running process).

## Blockers
None.

## Contract requests
None filed. Suggestion: add an optional `principalId` query to `GET /cases` and `GET /investigations/:id`, and an optional `selectorId` to `UserSettings`.

## Fix pass
- POST/PUT now always require `Content-Type: application/json`, even with an empty body (bodyless `/demo/reset` from a cross-origin simple request gets 415). Desktop already sends JSON.
- `Engine.undo`: cancelled questions can only be undone by the investigation owner; other undos require the recipient.
- `/outcomes` idempotency id now includes the observations, so new observations are recorded.
- `effective()` caps any directory person to the directory groups exactly (empty list included).
- Malformed percent-encoding in a path returns 400.
- Deferred questions: answer and dismiss auto-undo the deferral first (service-side), so the recipient can act on a saved question directly.
- Tests: tests/fixpass.test.ts added; full suite 175 tests, 0 failures; `pnpm typecheck` passes. The cancel/undo assertion only runs if the investigation produced a question.
