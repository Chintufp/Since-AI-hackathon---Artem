# desktop

Electron companion: a frameless, transparent, always-on-top window (`floating`, visible on all workspaces, no shadow, not resizable) at the bottom-right of the primary display with a 12 px margin, 420x680, showing only Snowbally. On launch he plays the drop entrance once, then idles (R05); the panel opens when he is clicked. `OPEN_ON_LAUNCH` in `main.ts` flips that.

## Files

- `main.ts`: lifecycle, service child process, tray (16 pt template icon drawn from the avatar silhouette, menu Show/Hide, Reset demo, Quit), single-instance lock.
- `window.ts`: window construction, bottom-right placement, click-through IPC, CORS shim for the service origin.
- `preload.ts`: context isolation on, sandboxed; exposes only `{ serviceUrl, platform, setIgnoreMouse(flag), onShow(cb) }`.
- `renderer.ts` + `index.html`: composes `ui` and `motion`; click-through hit test (mousemove over transparent areas calls `setIgnoreMouse(true)` with `forward: true`; over Snowbally or the open panel it turns it off).
- `tray-icon.ts`: generated tray icon (no brand image).
- `shots.ts`: screenshot/measurement harness entry (not used by the app).

## Service

If `GET /health` fails the main process runs `node src/apps/service/main.ts --port <port>` (port `KT_PORT` or the contract default 47831; `KT_NODE`, `KT_SERVICE_ENTRY`, `KT_NO_SERVICE=1` override; falls back to Electron's own Node if `node` is not on PATH), waits up to 10 s, and kills the child on quit. The renderer retries the connection for 12 s, then plays the error act and shows "Couldn't reach the service" with Retry when opened. `KT_MOCK=1` skips the service and uses the in-renderer dev mock.

## Run

`pnpm desktop` (build + launch), `pnpm dev`, `node scripts/screenshot.mjs` (dev mock), `node scripts/real-check.mjs` (starts its own service on KT_REAL_PORT, default 47951, `--db :memory: --seed elisa`; Electron runs `shots.cjs` with `KT_SHOTS_REAL=<url>`; writes `screenshots/real/*.png` and `checks-real.json`). Build output: `dist/desktop/{main.cjs,preload.cjs,renderer.js,index.html,styles.css,shots.cjs}`.

## Checks run

See `docs/runs/2026-11-07-overnight/screenshots/checks.json` (Electron 45.2.3, macOS arm64, Retina): 0 console errors; avatar hitbox identical (64x64 at the same position) across every state at 420 and 320 px; idle CPU 0.15 % total (collapsed, 3 s window); open/close frame times max 10.4 ms (120 Hz display), none over 20 ms; reduced motion settles with no animation. Real client path verified against a scratch HTTP server that served the mock handlers: service started as a child, CORS/preflight shim worked, badge showed 2 open questions, child killed on SIGTERM.

## Known limitations

- Not verified: Windows/Linux, multiple displays/DPR changes while running, the actual macOS menu-bar rendering of the tray icon, hit-test behaviour with a real mouse (clicks were synthesized in-page), launch against the real service (not yet built when this was written).
- Click-through relies on forwarded mousemove events; macOS only delivers them while the cursor is over the window.
- The window is a fixed 420x680 (320x680 in the narrow check); very small displays may need a smaller height.
