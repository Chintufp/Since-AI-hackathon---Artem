# Contract notes from the desktop worker (UX pass)

Not requests for code changes on my side; facts the other workers code against.

## For harness (`src/apps/desktop/shots.ts`)

- `createCompanionWindow(options)` now takes `mode?: 'area' | 'column'` and defaults to `KT_WINDOW_MODE` (so `area`: the window is the primary work area exactly). Pass `mode: 'column'` where the old 420 px crops are wanted; `placeBottomRight(win, width)`, `windowHeight()` and `WINDOW` are unchanged for column mode.
- `windowBounds(mode?, width?)` returns the bounds the window must have now (for the "bounds equal work area" assertion).
- Flags reach the page as query params: spread `flagsToQuery(flags)` from `flags.ts` into the `query` option. Missing params = defaults (companion, drag, away, gaze, shortcut on; fidgets off), so the current `{ mock, shots }` query runs with the companion on.
- `createShell({ getWindow, flags, resetDemo, quit? })` returns `{ tray, shortcutRegistered, state(), menu(), command(c), toggle(), setState(s), dispose() }`; call `dispose()` to unregister the global shortcut in capture runs, or do not create it.
- Click-through checks: the renderer sends `kt:ignore-mouse` (spy on `ipcMain`); `forceClickThrough(win)` is exported.

## For companion (`src/libs/utils/ui/companion.ts`)

- Read flags from `window.__ktFlags` (`{ companion, drag, away, gaze, fidgets, shortcut, windowMode }`); may be undefined outside the desktop renderer.
- Listen on `window` for `kt-command` (`detail.command`: `away | return | toggle-away | reset-position`), `kt-power` (`detail.event`: `resume | unlock-screen | lock-screen`), `kt-area` (`detail.width`, `detail.height`).
- Dispatch on `window`: `kt-companion:moved` (no detail) after moving the carrier and when the panel spring settles, so the cached hit rects are re-measured; `kt-companion:state` with `{ away, question }` whenever either changes (drives the tray label and the ` ?` title); `kt-companion:context-menu` on right-click on Snowbally.
