# ui

The v008 panel (ChatGPT design) as a framework-free TypeScript factory, connected to the local service through the typed API contract. Browser-safe.

## Public interface (`index.ts`)

- `createPanel({ root, api, avatar, groups?, storage?, entrance? })` returns `Panel`: `open/close/toggle`, `status()`, `attachFiles()`, `refresh()`, `connect()`, `destroy()`. `avatar` is a factory `(canvas, host) => Avatar` so the panel can own the canvas (see `motion`).
- `createApiClient({ baseUrl, fetch?, timeoutMs? })`: `call(route, { params, query, body })` is typed from `contracts/service.ts` `ApiRoutes`; named helpers (`investigate`, `questions`, `answer`, `defer`, `dismiss`, `undo`, `contactDraft`, `caseView`, `putSettings`, `resetDemo`, ...). Errors are `ApiError` with `code` `unreachable | timeout | http | bad-response`.
- `createMockApi()` / `createMockFetch()`: dev mock with a synthetic incident (an invented label-printer case, not private data). Same `ApiClient`, served through a fake `fetch`; each handler is typed against `ApiRoutes`. Results are labelled `ui-dev-mock` in `routes`.
- `createPanelMotion(...)`: 1:1 port of motion.js springs.
- `styles.css`: v008 CSS under `#kt-panel`.

## Views

input, question (with "Why this question?" context), queue, settings, receipt (v008) plus result, people, case and contact. Result: recommendation sentence (15 px), applicability/caveat line (12 px grey), the matched case's timeline (red Problem, yellow steps, green Reported outcome; titles expand with the v008 spring), rows for People with relevant experience and for the open question. People rows show name, role, reason, whether the person is firsthand or mentioned only, "View case" and "Prepare message". Prepare message shows the draft with a Copy button; nothing is sent. Send posts `/investigate` (draft, principal, attachment names only), plays `processing` while waiting, then `result`; failures play `error` and show "Couldn't reach the service" with Retry. Settings: Server, Provider (Local only), Model (read-only), MCP, Reduced motion, Points & rewards, Sound (disabled, "No sounds yet") and a two-click Reset demo. With points on, the receipt shows "+N" with a pixel burst; with points off nothing.

Kept from v008: avatar click toggles and restores view/draft/attachments/expanded context/selected node; Back-to-questions arrow; Dismiss in the secondary row with Undo; Escape closes; Cmd/Ctrl+Enter sends; paste/drop attachments as chips; reduced motion settles instantly; stationary 64 px avatar hitbox.

## Dependencies

`contracts` (types, `demoPrincipal`, `defaultUserSettings`) and `motion`. No other libraries; no network access beyond the injected `ApiClient`.

## Configuration

`groups` for the principal (default: the contract's demo principal). `storage` for the per-viewer draft/last-view convenience (default `localStorage`, optional). The desktop app picks the mock with `?mock=1`; the real client is the default.

## Desktop adaptations of v008 (all in `styles.css`/`panel.ts`, marked)

Fixed-size window instead of a per-view reserved stage height (the window cannot jump); compact breakpoint 419 px so the 420 px window uses the wide layout; long contexts/lists scroll inside their card (max-height) instead of growing past the window; once the context is fully revealed all node titles are visible (needed for the scrolling history); question view also renders `why` and `caveat`.

## Checks run

`node --test 'src/libs/utils/ui/**/*.test.ts'` (22 tests, all pass): spring settle/reversal/no-overshoot/reduced/context/node/view/press (fake DOM); request shaping (paths, encoding, GET without content-type, bodies, error mapping, timeout, bad body); mock parity (settings/investigate/questions/receipts/points gating/contact draft/404/reset/isolation, no `local` route claimed, reported outcome never `verified`). The panel itself was exercised end to end in Electron by `scripts/screenshot.mjs` (see `src/apps/desktop/README.md`).

## Known limitations

- No DOM-level unit test of `panel.ts` (no jsdom dependency); coverage is the Electron walk-through.
- The queue refreshes on open, after actions, on window show and every 30 s while visible; there is no push channel.
- Evaluative questions render their compared options as text in the context; the API only accepts yes/no/unknown.
- Principal groups come from configuration; real access control must stay server-side.

## Fix pass notes

- The result view shows the investigation's question read-only; only the recipient answers, from the Queue.
- Without `settings.currentPersonEntityId` the panel lists/answers nothing and never invents a principal.
- `askable: false` people show "Not available to ask right now" (no Prepare message).
- api-client timeout covers the response body read.
