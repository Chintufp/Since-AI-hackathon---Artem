# desktop

Electron companion. Since the UX pass (R31–R36) the window is a frameless, transparent, always-on-top (`floating`) overlay that covers the primary display's **work area exactly** (no margin), is visible on all workspaces, hidden in Mission Control, never resizable, shown with `showInactive()` (never steals focus) and click-through everywhere except Lumi and the open panel. On launch he falls from the top of the screen and lands with the authored entrance (R05/R28); the companion module (`src/libs/utils/ui/companion.ts`) then moves him along the floor, away to the edge and back. `OPEN_ON_LAUNCH` in `main.ts` opens the panel at launch instead.

**Fallback (R28):** `KT_WINDOW_MODE=column` keeps the old window exactly: 420 px wide at the right edge with a 12 px margin, as tall as the work area minus the margin (minimum 680), and turns every flag below off (no drag, no away; the tray is the old Show / Hide menu). `KT_DRAG`, `KT_AWAY` and `KT_SHORTCUT` cannot turn back on in the column (logged and ignored; shell-16).

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
| window mode | `KT_WINDOW_MODE` | `window` | `area` | `column` = R28 fallback, all flags off (drag / away / shortcut forced off) |

Values: `1/true/on/yes`, `0/false/off/no`. Example: `KT_AWAY=0 pnpm desktop`.

## Tray, menu, shortcut

- Menu (tray and right-click on Lumi, same items): **Send Lumi away** / **Bring Lumi back** (label follows the state the renderer reports; shows `⌥⌘S` when the shortcut registered), **Put Lumi back in the corner**, **Reset demo**, **Hide completely (stops questions)** (the old `win.hide()`: no window, no polling), **Quit**.
- Tray click toggles away / back (not hide / show); right-click or ctrl-click opens the menu (macOS). Any command while the window is hidden shows it first (`showInactive`).
- Tray title ` ?` next to the icon while he is away with a question waiting, empty otherwise.
- Global shortcut `CommandOrControl+Alt+S` toggles away / back. If `register()` returns false (taken by another app) it is logged and the accelerator is omitted from the menu. `unregisterAll` on `will-quit`.
- Launching the app again (`second-instance`) shows the window and sends `return`.
- With `away` or `companion` off the tray is the R28 menu (Show / Hide, Reset demo, Quit) and no shortcut is registered.

## IPC surface

Preload exposes `window.kt` = `{ serviceUrl, platform, setIgnoreMouse(flag), onShow(cb), flags, onCommand(cb), onPower(cb), onArea(cb), reportState({away, question}), showContextMenu() }`; nothing else. Payloads are validated on both sides.

| Channel | Direction | Payload |
| --- | --- | --- |
| `kt:ignore-mouse` | page → main | `boolean` (ignored unless it is a boolean from the companion window's own page) |
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

- Renderer hit test is O(1): two cached rects, the `.rf-avatar` button and the open `.rf-surface` (none while panel-motion hides it). Re-measured on `kt-companion:moved`, `resize`, `kt-area`, `kt:show`, after a press ends, and at most every 100 ms on mousemove as a fallback: always when the companion is off, otherwise only within 480 px of his / the panel's rects (a mousemove anywhere on screen reaches the full-area window; far away it costs no layout read). Over a rect → `setIgnoreMouse(false)`, otherwise `true` with `forward: true`; an unchanged state is resent at most once per second (main may have forced it).
- Pinned off (`setIgnoreMouse(false)`) from a plain primary `pointerdown` on `.rf-avatar` (not right-click, not ctrl-click: the menu's tracking loop eats the release) to `pointerup` / `pointercancel` / `lostpointercapture` / `contextmenu` (capture phase on window), then re-checked.
- On `kt:show` and `blur` the last pointer position is forgotten, so the window starts click-through and the next real mousemove decides.
- Main forces `setIgnoreMouseEvents(true, {forward:true})` on `render-process-gone`, `unresponsive`, `blur`, `lock-screen` and before hiding. After `render-process-gone` (not a clean exit) the page is reloaded, at most 3 times a minute.
- `acceptFirstMouse: true`: the first click on him while another app is active reaches the page instead of only activating the window (not yet checked with a real mouse).
- The window never navigates (`will-navigate` is prevented, e.g. a file dropped outside the card) and opens no windows (`setWindowOpenHandler` denies), so the preload bridge stays with our page.

## Application menu

`Menu.setApplicationMenu` keeps only the app menu (macOS) and Edit (copy / paste in the panel input). Electron's default menu would make Cmd+W close the only window and quit the app, and Cmd+R reload him mid-state.

## Display changes

`display-metrics-changed`, `display-added`, `display-removed` re-apply the bounds (work area, or the column in fallback) only when they differ from the window's current bounds, then send `kt:area` deduplicated by size (forced only on `did-finish-load`). Events that leave the primary work area as it is (another display, repeats) no longer reach the page. Primary display only.

## Service

If `GET /health` fails the main process runs `node src/apps/service/main.ts --port <port>` (port `KT_PORT` or the contract default 47831; `KT_NODE`, `KT_SERVICE_ENTRY`, `KT_NO_SERVICE=1` override; falls back to Electron's own Node if `node` is not on PATH), waits up to 10 s, and kills the child on quit. The renderer retries the connection for 12 s, then plays the error act and shows "Couldn't reach the service" with Retry when opened. `KT_MOCK=1` skips the service and uses the in-renderer dev mock.

## Process priority and background launches

- A niced launch (`nice … pnpm desktop &` from a background shell) can starve the renderer's `requestAnimationFrame`; once he froze mid-roll at 0 % CPU. After `app.whenReady` main reads its nice value (`os.getPriority`) and, when it is above 0, calls `os.setPriority(0)` and logs before / after (`[desktop] priority: …`). This runs before the window is created, so the renderer (and the service child) inherit the main process's value.
- macOS and Linux refuse an unprivileged process lowering its own nice value (checked: `nice -n 10 node` → `setPriority(0)` fails with EACCES). Then the log says so and the value stays; relaunch without `nice` from a normal shell. No `powerSaveBlocker` is used.
- `SIGINT`, `SIGTERM` and `SIGHUP` (the launch shell closed) quit the app, which kills the service child; write errors on a closed inherited stdout / stderr are swallowed (no EPIPE crash).

## Run

`pnpm desktop` (build + launch), `pnpm dev`, `node scripts/screenshot.mjs` (dev mock), `node scripts/real-check.mjs` (starts its own service on KT_REAL_PORT, default 47951, `--db :memory: --seed elisa`; Electron runs `shots.cjs` with `KT_SHOTS_REAL=<url>`). Build output: `dist/desktop/{main.cjs,preload.cjs,renderer.js,index.html,styles.css,shots.cjs}`.

## Checks run

- UX pass shell (scratch Electron script, Electron 45.2.3, macOS arm64): window bounds equal the work area; `kt:area` arrives after `setBounds` and after a simulated `display-metrics-changed` (which restores the bounds); tray click, menu commands, shortcut toggle and power events reach the page; the reported state flips the tray label and the ` ?` title; the right-click menu IPC runs; press pinning and the cached-rect hit test send the expected ignore states (avatar, open surface, closed surface); `blur` / `unresponsive` / `render-process-gone` / `lock-screen` force click-through; zero page errors. Details in `docs/runs/2026-11-07-overnight/worker-reports/ux-desktop.md`.
- Earlier (R28 window): see `docs/runs/2026-11-07-overnight/screenshots/checks.json`.

## Known limitations

- Not verified: Windows/Linux, multiple displays, a real mouse on the full-area window, the menu-bar rendering of the tray title, `lock-screen` / `unlock-screen` from a real lock (events were emitted synthetically).
- Click-through relies on forwarded mousemove events; macOS delivers them while the cursor is over the window, which now means anywhere in the work area.
