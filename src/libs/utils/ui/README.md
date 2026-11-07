# ui

The v008 panel (ChatGPT design) as a framework-free TypeScript factory, connected to the local service through the typed API contract. Browser-safe.

## Public interface (`index.ts`)

- `createPanel({ root, api, avatar, groups?, storage?, entrance?, companion? })` returns `Panel`: `open/close/toggle`, `status()`, `attachFiles()`, `refresh()`, `connect()`, `companion`, `destroy()`. `avatar` is a factory `(canvas, host, { drop, shadow }) => CompanionAvatar` so the panel can own the canvases (see `motion`). `companion` defaults to `window.__ktFlags` (desktop renderer); null / `companion:false` / `windowMode:'column'` gives the R28 panel. `open()` / `toggle()` are programmatic: quiet and they never move focus.
- desktop (R31..R36): `createCompanion(deps)` (the DOM-less state machine) and `attachCompanion(companion, { root, avatarButton, win })` (gesture recogniser, pointer tracking, shell events), `COMPANION` / `GEOMETRY` constants and the pure geometry helpers; `createAttention({ now?, storage? })` (`attention.ts`); `createQuestionWatch({...})` and `COLLAPSED_POLL_MS` (`question-watch.ts`).
- `createApiClient({ baseUrl, fetch?, timeoutMs? })`: `call(route, { params, query, body })` is typed from `contracts/service.ts` `ApiRoutes`; named helpers (`investigate`, `questions`, `answer`, `defer`, `dismiss`, `undo`, `contactDraft`, `caseView`, `putSettings`, `resetDemo`, ...). Errors are `ApiError` with `code` `unreachable | timeout | http | bad-response`.
- `createMockApi()` / `createMockFetch()`: dev mock with a synthetic incident (an invented label-printer case, not private data). Same `ApiClient`, served through a fake `fetch`; each handler is typed against `ApiRoutes`. Results are labelled `ui-dev-mock` in `routes`.
- `createPanelMotion(...)`: 1:1 port of motion.js springs.
- `styles.css`: v008 CSS under `#kt-panel`.

## Views

input, question (with "Why this question?" context), queue, settings, receipt (v008) plus result, people, case and contact. Result: recommendation sentence (15 px), applicability/caveat line (12 px grey), the matched case's timeline (red Problem, yellow steps, green Reported outcome; titles expand with the v008 spring), rows for People with relevant experience and for the open question. People rows show name, role, reason, whether the person is firsthand or mentioned only, "View case" and "Prepare message". Prepare message shows the draft with a Copy button; nothing is sent. Send posts `/investigate` (draft, principal, attachment names only), plays `processing` while waiting, then `result`; failures play `error` and show "Couldn't reach the service" with Retry. Settings: Server, Provider (Local only), Model (read-only), MCP, Reduced motion, Points & rewards, Sound (disabled, "No sounds yet") and a two-click Reset demo. With points on, the receipt shows "+N" with a pixel burst; with points off nothing.

Kept from v008 (and v009): avatar click toggles with the Springy tap (`click` act; programmatic opens are quiet) and restores view/draft/attachments/expanded context/selected node; Back-to-questions arrow; Dismiss in the secondary row with Undo; Escape closes; Cmd/Ctrl+Enter sends; paste/drop attachments as chips; reduced motion settles instantly; stationary 64 px avatar hitbox.

## Companion (desktop R31..R36)

One state machine in `companion.ts`: `launching → in → pressed → (click | carried) → airborne → landing → in`, `in → leaving → away → peeking → (returning → in | away)`, `away → arriving(question) → perched → (returning → in | leaving → away)`.

- **Carrier**: with the companion on, the panel root gets `data-kt-companion="on"`, a desktop CSS rule anchors `.rf-window` at `left:0; bottom:0; transform:none`, and only the companion writes its `transform: translate3d(x, -y, 0)` (whole device pixels). bodyX = his body centre; card left = bodyX − 333; card bottom = 30 + lift (his contact row 12 px above the window bottom).
- **Spots**: home = `W − homeFromRight` (default 79, clamped to [14, W−14]); sliver = 12 px of his body inside (`W + 28 − 12` / `−28 + 12`); perch = the whole 88 px canvas inside (`W − 44` / `44`); make-room = `345 ≤ bodyX ≤ W − 59` (the card is never mirrored). Persisted as `kt-companion.v1` `{ version: 1, homeFromRight, awaySide, fidgets? }` through `storage` (null in shots mode).
- **Gestures on `.rf-avatar`**: pointerdown draws the press pose synchronously; release within 4 px (or a quick tap within 8 px / 180 ms) = click: toggle + `run('click', 2)`; beyond = carried (carried pose on `.rf-drop`, shadow strip `.rf-shadow` kept on the floor), 1:1 follow; release = `fallFrom(lift)` with the carrier following the fall (so he can be caught mid-air); the spot persists. Pushing past a side edge (his centre beyond it, or the pointer pinned to the screen edge) = leave to that edge. A capture-phase click guard drops the native click after a handled release; keyboard clicks keep the v009 path (toggle + Springy tap).
- **Away is home**: he leaves 4 s after the launch hello and after 20 s without interaction (pointer out of his zone, no drag, panel closed; closing the panel starts the same timer) by rolling (tuck + turn per 22 px) to the perch and tucking to the sliver; away = `hold()` still, zero timers, zero rAF. Pointer within 160 px of the sliver → peek to the perch looking at it; 400 ms dwell or within 60 px → he hops in to his spot and says hello. He peeks only after the pointer has been outside the zone once since he left.
- **Questions**: a new unseen question while away → he hops to the perch, plays `question`, holds with the glyph for 90 s or until the pointer comes near; ignored → back to the sliver (tray `?`). A click on him with an unseen question waiting opens the question view.
- **Cursor awareness when in**: `look()` with hysteresis (24 / 12 px), at most one redraw per 250 ms, quarter view only to the right. Fidgets (`flags.fidgets`, Settings "Fidgets") are off by default.
- **Events**: dispatches `kt-companion:moved` (every carrier move, panel spring settled), `kt-companion:state {away, question}`, `kt-companion:context-menu`; listens to `kt-command`, `kt-power`, `kt-area` and `resize`.
- **Harness surface**: `panel.status().companion` = `{ state, bodyX, lift, away, side, pointerNear, homeFromRight, homeX, rafActive, timers, anim, fidgets, question }` and `panel.companion` = `{ command, status, pointer, power, arrive, poll, engagement, setFidgets }`.
- **Reactions** (`REACTIONS` in `panel.ts`): Yes / No → `hello`, Not sure / Later → `peek`, Dismiss → crouch, low settle, Undo → `peek`, points reward → `hop` (opt-in).

### Question polling (changed by the UX pass)

Before: `/questions` polled every 20 s only while the panel was open; **no timer while collapsed**. Now, with the companion on, `question-watch.ts` also polls every `COLLAPSED_POLL_MS` = 90 s while the panel is collapsed and `document.hidden` is false, and refreshes at once on window show, unlock, resume and when he comes back. After each refresh `attention.ts` decides: one arrival per question id, one reminder per id (unlock / resume after ≥ 20 min away), `Later` snoozes for 30 min. Local counters under `kt-engagement.v1` (time to first open, answered / deferred / dismissed, arrivals, reminders, arrivals ignored). Without the companion (column mode) nothing changed.

## Dependencies

`contracts` (types, `demoPrincipal`, `defaultUserSettings`) and `motion`. No other libraries; no network access beyond the injected `ApiClient`.

## Configuration

`groups` for the principal (default: the contract's demo principal). `storage` for the per-viewer draft/last-view convenience (default `localStorage`, optional). The desktop app picks the mock with `?mock=1`; the real client is the default.

## Desktop adaptations of v008 (all in `styles.css`/`panel.ts`, marked)

Fixed-size window instead of a per-view reserved stage height (the window cannot jump); compact breakpoint 419 px so the 420 px window uses the wide layout; long contexts/lists scroll inside their card (max-height) instead of growing past the window; once the context is fully revealed all node titles are visible (needed for the scrolling history); question view also renders `why` and `caveat`.

## Checks run

UX pass (R31..R36): `node --test src/libs/utils/ui/companion.test.ts src/libs/utils/ui/attention.test.ts` (31 + 9 tests): geometry, gesture classification, gaze hysteresis, persistence, launch → in → leave by roll and tuck, peek / dwell / retreat, click, drag with floor shadow, catch mid-air, push past an edge, make-room slide and roll back, idle timer, panel settle event, question arrival / perch wait / ignored, commands, reduced motion, flags, fidgets, power, area; attention rules and counters, question-watch polling, arrivals and reminders. A scratch Electron run (mock, work-area window) walked launch → away → peek → return → click → drag → plop → make-room → away left → reset → perch with zero console errors and 0 rAF while away and perched.


`node --test 'src/libs/utils/ui/**/*.test.ts'` (22 tests, all pass): spring settle/reversal/no-overshoot/reduced/context/node/view/press (fake DOM); request shaping (paths, encoding, GET without content-type, bodies, error mapping, timeout, bad body); mock parity (settings/investigate/questions/receipts/points gating/contact draft/404/reset/isolation, no `local` route claimed, reported outcome never `verified`). The panel itself was exercised end to end in Electron by `scripts/screenshot.mjs` (see `src/apps/desktop/README.md`).

## Known limitations

- No DOM-level unit test of `panel.ts` (no jsdom dependency); coverage is the Electron walk-through.
- The queue refreshes on open, after actions, on window show, every 20 s while open and (companion) every 90 s while collapsed; there is no push channel.
- desktop (R31..R36): on the right edge the authored question glyph sits right of the body, outside the window when he is at the sliver; there the tray `?` carries the signal (on the left edge it is visible).
- Evaluative questions render their compared options as text in the context; the API only accepts yes/no/unknown.
- Principal groups come from configuration; real access control must stay server-side.

## Fix pass notes

- The result view shows the investigation's question read-only; only the recipient answers, from the Queue.
- Without `settings.currentPersonEntityId` the panel lists/answers nothing and never invents a principal.
- `askable: false` people show "Not available to ask right now" (no Prepare message).
- api-client timeout covers the response body read.
