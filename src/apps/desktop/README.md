# desktop

Electron companion. Since the UX pass (R31–R36) the window is a frameless, transparent, always-on-top (`floating`) overlay that covers the primary display's **work area exactly** (no margin), is visible on all workspaces, hidden in Mission Control, never resizable, shown with `showInactive()` (never steals focus) and click-through everywhere except Snowbally and the open panel. On launch he falls from the top of the screen and lands with the authored entrance (R05/R28); the companion module (`src/libs/utils/ui/companion.ts`) then moves him along the floor, away to the edge and back. `OPEN_ON_LAUNCH` in `main.ts` opens the panel at launch instead.

**Fallback (R28):** `KT_WINDOW_MODE=column` keeps the old window exactly: 420 px wide at the right edge with a 12 px margin, as tall as the work area minus the margin (minimum 680), and turns every flag below off (no drag, no away; the tray is the old Show / Hide menu).

## Files

- `flags.ts`: flags, IPC channel names, CustomEvent names and the pure shell helpers (window geometry, hit rects, tray menu template, tray title). No Electron runtime import; unit-tested in `flags.test.ts`.
- `main.ts`: lifecycle, service child process, single-instance lock; builds the window and the shell from the flags.
- `window.ts`: window construction (`createCompanionWindow`), geometry (`windowBounds`, column helpers `placeBottomRight` / `windowHeight`), display listeners, click-through IPC and safety, CORS shim for the service origin, and `createShell` (tray, menu, global shortcut, power events, context menu).
- `preload.ts`: context isolation on, sandboxed; see the IPC surface below.
- `renderer.ts` + `index.html`: composes `ui` and `motion`; cached-rect click-through hit test; bridges main ↔ page CustomEvents.
- `tray-icon.ts`: generated tray icon (no brand image).
- `shots.ts`: screenshot/measurement harness entry (not used by the app).

## Flags (desktop R31..R36)

Set in the main process from the environment, passed to the renderer as query params (like `mock`), parsed back by `parseFlags` (renderer: `window.__ktFlags`; preload: `window.kt.flags`). A missing query param means the default of its window mode.

| Flag | Env | Query | Default | What |
| --- | --- | --- | --- | --- |
| companion | `KT_COMPANION` | `companion` | on | the companion module runs at all |
| drag | `KT_DRAG` | `drag` | on | pick up / drop |
| away | `KT_AWAY` | `away` | on | away is home; tray / shortcut away ↔ back |
| gaze | `KT_GAZE` | `gaze` | on | cursor awareness while in |
| fidgets | `KT_FIDGETS` | `fidgets` | **off** | rare idle fidgets |
| shortcut | `KT_SHORTCUT` | `shortcut` | on | global shortcut |
| window mode | `KT_WINDOW_MODE` | `window` | `area` | `column` = R28 fallback, all flags off |

Values: `1/true/on/yes`, `0/false/off/no`. Example: `KT_AWAY=0 pnpm desktop`.

## Tray, menu, shortcut

- Menu (tray and right-click on Snowbally, same items): **Send Snowbally away** / **Bring Snowbally back** (label follows the state the renderer reports; shows `⌥⌘S` when the shortcut registered), **Put Snowbally back in the corner**, **Reset demo**, **Hide completely (stops questions)** (the old `win.hide()`: no window, no polling), **Quit**.
- Tray click toggles away / back (not hide / show); right-click or ctrl-click opens the menu (macOS). Any command while the window is hidden shows it first (`showInactive`).
- Tray title ` ?` next to the icon while he is away with a question waiting, empty otherwise.
- Global shortcut `CommandOrControl+Alt+S` toggles away / back. If `register()` returns false (taken by another app) it is logged and the accelerator is omitted from the menu. `unregisterAll` on `will-quit`.
- Launching the app again (`second-instance`) shows the window and sends `return`.
- With `away` or `companion` off the tray is the R28 menu (Show / Hide, Reset demo, Quit) and no shortcut is registered.

## IPC surface

Preload exposes `window.kt` = `{ serviceUrl, platform, setIgnoreMouse(flag), onShow(cb), flags, onCommand(cb), onPower(cb), onArea(cb), reportState({away, question}), showContextMenu() }`; nothing else. Payloads are validated on both sides.

| Channel | Direction | Payload |
| --- | --- | --- |
| `kt:ignore-mouse` | page → main | `boolean` |
| `kt:show` | main → page | none |
| `kt:command` | main → page | `{ command: 'away' \| 'return' \| 'toggle-away' \| 'reset-position' }` |
| `kt:power` | main → page | `{ event: 'resume' \| 'unlock-screen' \| 'lock-screen' }` |
| `kt:area` | main → page | `{ width, height }` (window content size; on load, resize, display change) |
| `kt:state` | page → main | `{ away, question }` |
| `kt:context-menu` | page → main | none (main pops the menu at the cursor, `Menu.popup({window})`) |

`renderer.ts` turns these into CustomEvents on `window` so the companion module never imports Electron:

- in: `kt-command` `{command}`, `kt-power` `{event}`, `kt-area` `{width, height}`;
- out (the companion dispatches): `kt-companion:moved` (no detail; after moving the carrier or when the panel spring settles: re-measure the hit rects), `kt-companion:state` `{away, question}` (forwarded as `reportState`), `kt-companion:context-menu` (forwarded as `showContextMenu`).

## Click-through

- Renderer hit test is O(1): two cached rects, the `.rf-avatar` button and the open `.rf-surface` (none while panel-motion hides it). Re-measured on `kt-companion:moved`, `resize`, `kt-area`, `kt:show`, after a press ends, and at most every 100 ms on mousemove (fallback). Over a rect → `setIgnoreMouse(false)`, otherwise `true` with `forward: true`; an unchanged state is resent at most once per second (main may have forced it).
- Pinned off (`setIgnoreMouse(false)`) from `pointerdown` on `.rf-avatar` to `pointerup` / `pointercancel` / `lostpointercapture` (capture phase on window), then re-checked.
- Main forces `setIgnoreMouseEvents(true, {forward:true})` on `render-process-gone`, `unresponsive`, `blur`, `lock-screen` and before hiding.

## Display changes

`display-metrics-changed`, `display-added`, `display-removed` re-apply the bounds (work area, or the column in fallback) and send `kt:area`. Primary display only.

## Service

If `GET /health` fails the main process runs `node src/apps/service/main.ts --port <port>` (port `KT_PORT` or the contract default 47831; `KT_NODE`, `KT_SERVICE_ENTRY`, `KT_NO_SERVICE=1` override; falls back to Electron's own Node if `node` is not on PATH), waits up to 10 s, and kills the child on quit. The renderer retries the connection for 12 s, then plays the error act and shows "Couldn't reach the service" with Retry when opened. `KT_MOCK=1` skips the service and uses the in-renderer dev mock.

## Run

`pnpm desktop` (build + launch), `pnpm dev`, `node scripts/screenshot.mjs` (dev mock), `node scripts/real-check.mjs` (starts its own service on KT_REAL_PORT, default 47951, `--db :memory: --seed elisa`; Electron runs `shots.cjs` with `KT_SHOTS_REAL=<url>`). Build output: `dist/desktop/{main.cjs,preload.cjs,renderer.js,index.html,styles.css,shots.cjs}`.

## Checks run

- UX pass shell (scratch Electron script, Electron 45.2.3, macOS arm64): window bounds equal the work area; `kt:area` arrives after `setBounds` and after a simulated `display-metrics-changed` (which restores the bounds); tray click, menu commands, shortcut toggle and power events reach the page; the reported state flips the tray label and the ` ?` title; the right-click menu IPC runs; press pinning and the cached-rect hit test send the expected ignore states (avatar, open surface, closed surface); `blur` / `unresponsive` / `render-process-gone` / `lock-screen` force click-through; zero page errors. Details in `docs/runs/2026-11-07-overnight/worker-reports/ux-desktop.md`.
- Earlier (R28 window): see `docs/runs/2026-11-07-overnight/screenshots/checks.json`.

## Known limitations

- Not verified: Windows/Linux, multiple displays, a real mouse on the full-area window, the menu-bar rendering of the tray title, `lock-screen` / `unlock-screen` from a real lock (events were emitted synthetically).
- Click-through relies on forwarded mousemove events; macOS delivers them while the cursor is over the window, which now means anywhere in the work area.
