# UX fixes: desktop

Files: src/apps/desktop/{main.ts, window.ts, renderer.ts, flags.ts, flags.test.ts, README.md}. Not committed. `pnpm typecheck` green, `node --test src/apps/desktop/flags.test.ts` 17/17, `pnpm test` 342/342, `node scripts/build.mjs` builds. Not run in Electron with a real mouse.

- M4: main.ts whenReady calls `restoreDefaultPriority` (new, flags.ts) before the window exists: if `os.getPriority()` > 0 it calls `os.setPriority(0)` in try/catch and logs before/after; README "Process priority" says the renderer and service inherit it. Caveat checked on this Mac: an unprivileged process may not lower its nice value (`nice -n 10 node` → setPriority(0) fails, EACCES), so for a niced launch the fix normally only logs the failure; the real cure is launching without nice. No powerSaveBlocker. Tests: flags.test.ts "priority (M4)" x2.
- shell-03 (renderer part): renderer.ts pins only on `pinsPress(e)` (button 0, no ctrl; flags.ts) and a capture-phase `contextmenu` listener drops any pin and resets `ignoring`. Test: "press pinning (shell-03)". NOT done here (other owners): companion.ts onDown ctrl guard / capture release, panel.ts press dip, the harness scenario in shots.ts.
- shell-04 (window part): window.ts `reapply` returns when `sameRect(next, win.getBounds())`, otherwise setBounds + deduplicated `sendArea(win)` (force only on did-finish-load). Test: "display changes (shell-04)". NOT done here: companion.ts area() idempotence / re-targeting.
- shell-06: renderer.ts sets `last = null` in onShow (before remeasure) and in the blur handler.
- shell-07: window.ts render-process-gone reloads the page unless `clean-exit`, gated by `createReloadGate()` (3 per minute, flags.ts). Test: "renderer reload gate (shell-07)".
- shell-08: main.ts `Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(mac)))` = appMenu + editMenu (no Close/Reload/DevTools). Test: "application menu (shell-08)".
- shell-09: window.ts `acceptFirstMouse: true` (unverified with a real mouse).
- shell-12: renderer.ts mousemove fallback re-measure only when the companion is off or the pointer is within 480 px (`nearRects`, `MEASURE_NEAR_PX`) of the cached avatar/surface rects, or nothing is measured. Kept the near fallback (not dropped) because the open-panel spring only emits `moved` on settle and column/companion-off mode never emits it. Test: "measure fallback (shell-12)". CPU not re-measured.
- shell-13: window.ts `will-navigate` → preventDefault, `setWindowOpenHandler(() => ({ action: 'deny' }))`.
- shell-14 (partial): main.ts adds SIGHUP to the quit signals and swallows stdout/stderr 'error' (EPIPE). Skipped: piping the service's stdio to a log file and passing the parent pid to the service (service code is not mine; stdio kept 'inherit' so terminal logs stay).
- shell-15: window.ts handleMouseIgnore ignores the message unless `event.sender === win.webContents && typeof flag === 'boolean'`.
- shell-16: flags.ts `COLUMN_FORCED_OFF` (drag, away, shortcut) forced false in column mode by both flagsFromEnv and parseFlags; main.ts logs the ignored env vars (`columnIgnoredEnv`). Existing column test updated (it asserted KT_SHORTCUT=1 turned the shortcut on); new test "flags (shell-16)".
- fidelity-09: skipped, shots.ts is not in this area.
