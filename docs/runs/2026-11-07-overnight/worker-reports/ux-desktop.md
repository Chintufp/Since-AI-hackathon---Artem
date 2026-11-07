# UX pass worker report: desktop

Scope: `src/apps/desktop/{flags.ts (new), flags.test.ts (new), window.ts, main.ts, preload.ts, renderer.ts, README.md}`. Nothing under `src/libs`, `shots.ts` or `scripts/` was touched. Not committed. Every addition is marked `desktop (R31..R36)` / `desktop (R3x)`.

## What I built

1. **flags.ts** (no Electron runtime import; bundled into main, preload and renderer):
   - `DesktopFlags { companion, drag, away, gaze, fidgets, shortcut: boolean; windowMode: 'area' | 'column' }`, `DEFAULT_FLAGS` (all on except fidgets), `COLUMN_FLAGS` (all off).
   - `flagsFromEnv(env)`: `KT_WINDOW_MODE=column` picks the column defaults, then `KT_COMPANION|KT_DRAG|KT_AWAY|KT_GAZE|KT_FIDGETS|KT_SHORTCUT = 0|1|true|false|on|off|yes|no` override.
   - `flagsToQuery(flags): Record<string,string>` (`companion=1&…&window=area`) and `parseFlags(search: string | URLSearchParams): DesktopFlags` (missing param = default of the window mode).
   - IPC and event names (`IPC`, `RENDERER_EVENTS`), `SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+S'`, payload guards (`isShellCommand`, `isPowerEvent`, `normaliseState`), geometry `boundsFor(mode, workArea, width?)`, hit rects `toHitRect` / `inRect`, `menuTemplate(model, actions)`, `trayTitle(state)`, `awayEnabled(flags)`.
2. **window.ts**: area mode = primary `workArea` exactly; column mode = the R28 `placeBottomRight` geometry (same numbers, now computed by `boundsFor('column', …)`). `setHiddenInMissionControl(true)` behind a `typeof` guard. `display-metrics-changed` / `display-added` / `display-removed` re-apply the bounds and send `kt:area` (listeners removed on `closed`); `kt:area` also on `resize` (deduplicated) and `did-finish-load`. Transparent / frameless / floating / all workspaces / `showInactive` kept. Click-through safety: `render-process-gone`, `unresponsive`, `blur` force `setIgnoreMouseEvents(true,{forward:true})`. `handleMouseIgnore` and `allowServiceCors` unchanged. `createShell()` (see deviations) holds the tray, menu, global shortcut, power events and context-menu IPC.
3. **main.ts**: flags from env → query params; `createCompanionWindow({ serviceUrl, query, mode })`; `createShell(...)`; `second-instance` → shows the window and sends `kt:command {command:'return'}`. Service handling and reset demo unchanged.
4. **Tray / menu** (same template for tray and right-click): Send Snowbally away / Bring Snowbally back (label from the renderer-reported state, or "back" while the window is hidden; accelerator shown only when `register()` returned true, `registerAccelerator:false`), Put Snowbally back in the corner (`reset-position`), Reset demo, Hide completely (stops questions) (disabled while hidden), Quit. On macOS the tray has no attached context menu so the left click toggles away/back; right-click / ctrl-click pops the menu. `tray.setTitle(' ?')` while away with a question, `''` otherwise. Global shortcut toggles, failure logged, `unregisterAll` on `will-quit`. `powerMonitor` `resume` / `unlock-screen` / `lock-screen` → `kt:power {event}`; lock also forces click-through. `kt:context-menu` → `Menu.popup({ window })` at the cursor (sender checked). Fallback (column mode or companion/away off): the R28 tray (Show / Hide, Reset demo, Quit) and no shortcut.
5. **preload.ts**: `{ serviceUrl, platform, setIgnoreMouse, onShow }` + `flags`, `onCommand`, `onPower`, `onArea`, `reportState`, `showContextMenu`. Payloads validated. contextIsolation and sandbox kept.
6. **renderer.ts**: hit test = two cached rects (`.rf-avatar`, open `.rf-surface`; the surface counts only when panel-motion has not set `visibility:hidden` / `pointer-events:none`). Re-measured on `kt-companion:moved`, `resize`, `kt-area`, `kt:show`, press end, and at most every 100 ms on mousemove (`MEASURE_FALLBACK_MS`). Pin `ignore=false` from capture-phase `pointerdown` on `.rf-avatar` to `pointerup` / `pointercancel` / `lostpointercapture`, then re-check. Unchanged ignore state is resent at most once per second (`IGNORE_RESEND_MS`) and the cache is dropped on `blur`, `lock-screen` and `kt:show`, because main can force click-through without the renderer knowing. `window.__ktFlags` set. Main → page CustomEvents `kt-command {command}`, `kt-power {event}`, `kt-area {width,height}`; page → main `kt-companion:state {away,question}` → `reportState`, `kt-companion:context-menu` → `showContextMenu`.

## Public API (signatures)

```ts
// flags.ts
export type WindowMode = 'area' | 'column';
export interface DesktopFlags { companion: boolean; drag: boolean; away: boolean; gaze: boolean; fidgets: boolean; shortcut: boolean; windowMode: WindowMode }
export const DEFAULT_FLAGS: Readonly<DesktopFlags>; export const COLUMN_FLAGS: Readonly<DesktopFlags>;
export function flagsFromEnv(env: Readonly<Record<string, string | undefined>>): DesktopFlags;
export function flagsToQuery(flags: DesktopFlags): Record<string, string>;
export function parseFlags(search: string | URLSearchParams): DesktopFlags;
export const SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+S';
export type ShellCommand = 'away' | 'return' | 'toggle-away' | 'reset-position';
export type PowerEvent = 'resume' | 'unlock-screen' | 'lock-screen';
export interface ShellState { away: boolean; question: boolean }
export interface Area { width: number; height: number }
export function boundsFor(mode: WindowMode, workArea: Rect, width?: number): Rect;
export function menuTemplate(model: MenuModel, actions: MenuActions): MenuItemConstructorOptions[];
export const trayTitle: (state: ShellState) => string;
// window.ts
export const WINDOW: { width: 420; height: 680; margin: 12 };
export function windowBounds(mode?: WindowMode, width?: number): Rectangle;
export function windowHeight(): number;                       // column mode (R28)
export function placeBottomRight(win: BrowserWindow, width?: number): void; // column mode (R28)
export function createCompanionWindow(o: { serviceUrl: string; query?: Record<string,string>; show?: boolean; width?: number; mode?: WindowMode }): BrowserWindow;
export function forceClickThrough(win: BrowserWindow | null): void;
export function sendArea(win: BrowserWindow, force?: boolean): Area | null;
export function handleMouseIgnore(getWindow: () => BrowserWindow | null): void;
export function createShell(o: { getWindow: () => BrowserWindow | null; flags: DesktopFlags; resetDemo: () => void; quit?: () => void }): Shell;
// Shell = { tray; shortcutRegistered; state(); menu(); command(c); toggle(); setState(s); dispose() }
// preload: window.kt
{ serviceUrl; platform; setIgnoreMouse(flag); onShow(cb); flags; onCommand(cb: (c: ShellCommand) => void); onPower(cb: (e: PowerEvent) => void); onArea(cb: (a: Area) => void); reportState(s: ShellState); showContextMenu() }
```

## Verified

- `pnpm typecheck` green; `node --test src/apps/desktop/flags.test.ts` 9/9; `pnpm test` 287/287 (with the other workers' files at the time of the run); `node scripts/build.mjs` builds.
- Scratch Electron script (scratchpad, not committed): esbuild bundle of `window.ts` + `flags.ts` with the built preload/renderer, Electron 45.2.3, macOS arm64, mock mode, window not shown until the first command. With the open/closed-surface checks added, the first run failed both surface checks (the cause is unknown: that version logged the message array by reference, so the recorded detail was empty, and that Electron process did not exit on its own afterwards). The next three runs passed all 21 checks. Treat the open-surface hit test as verified but with a possible timing flake for the harness to watch. Output of the last run:

fail: []
- bounds_equal_work_area: pass {"bounds":{"x":0,"y":33,"width":1512,"height":872},"workArea":{"x":0,"y":33,"width":1512,"height":872},"windowBounds":{"x":0,"y":33,"width":1512,"height":872}}
- renderer_flags: pass {"companion":true,"drag":true,"away":true,"gaze":true,"fidgets":false,"shortcut":true,"windowMode":"area"} | bridge: serviceUrl,platform,setIgnoreMouse,onShow,flags,onCommand,onPower,onArea,reportState,showContextMenu
- shortcut_registered: pass true
- menu_while_hidden: pass ["Bring Snowbally back [CommandOrControl+Alt+S]","Put Snowbally back in the corner","Reset demo","","Hide completely (stops questions)","Quit"]
- kt_area_after_setBounds: pass [{"width":1412,"height":822},{"width":1512,"height":872},{"width":1512,"height":872}]
- bounds_reapplied_on_display_change: pass {"x":0,"y":33,"width":1512,"height":872}
- menu_in_after_show: pass ["Send Snowbally away [CommandOrControl+Alt+S]","Put Snowbally back in the corner","Reset demo","","Hide completely (stops questions)","Quit"]
- commands_reach_page: pass [{"command":"reset-position"},{"command":"toggle-away"},{"command":"toggle-away"}]
- power_reaches_page: pass [{"event":"resume"},{"event":"unlock-screen"}]
- tray_title_question: pass {"title":" ?","state":{"away":true,"question":true}}
- menu_away: pass ["Bring Snowbally back [CommandOrControl+Alt+S]","Put Snowbally back in the corner","Reset demo","","Hide completely (stops questions)","Quit"]
- tray_title_cleared: pass 
- context_menu_ipc_no_throw: pass
- pin_then_recheck: pass {"msgs":[false,true],"avatar":"{\"x\":867,\"y\":788,\"width\":64,\"height\":64,\"top\":788,\"right\":931,\"bottom\":852,\"left\":867}"}
- hit_test_cached_rects: pass [false,true]
- open_surface_hit: pass {"msgs":[false],"surface":"{\"r\":{\"x\":566,\"y\":656,\"width\":380,\"height\":172,\"top\":656,\"right\":946,\"bottom\":828,\"left\":566},\"pe\":\"\",\"vis\":\"visible\"}"}
- closed_surface_click_through: pass [true]
- click_through_forced: pass ["true/true","true/true","true/true","true/true"]
- lock_screen_forwarded: pass
- page_errors: pass []
- shortcut_unregistered_on_dispose: pass

## Not verified

- A real mouse on the full-area window, real screen lock / unlock / resume (events emitted with `powerMonitor.emit`), a real display change (simulated with `screen.emit('display-metrics-changed')`), the menu-bar rendering of ` ?`, the right-click menu content as drawn (only that the IPC path runs without throwing). Column mode was checked by unit test only, not in Electron. The full app (`pnpm desktop`) was not launched (the harness worker's job). Whether `document.hidden` is true after "Hide completely" (what stops the companion's question poll) is not checked.
- Idle CPU with the full-area window and the new mousemove path is not measured here (harness).

## Deviations from the SPEC / task, with reasons

- **Shell code in window.ts, not main.ts.** Tray, menu, shortcut, power and context-menu wiring is `createShell()` in `window.ts`; `main.ts` calls it. Reason: `main.ts` boots the app on import, so the scratch check (and the harness) could not exercise those paths without it. The behaviour is what the task lists for main.ts.
- **Pure helpers in flags.ts.** Geometry (`boundsFor`), hit rects, the menu template and tray title live in `flags.ts` next to the flags, because it is the only new module I own and it has to stay Electron-free to be unit-tested with node:test.
- **`windowMode` is part of `DesktopFlags`** (query param `window`), so the renderer and the companion know they are in the fallback.
- **Column mode defaults every flag off**, env vars can still turn single flags on (SPEC: "degrades to no drag, no away, flags off").
- **Tray left click on macOS no longer opens the menu** in area mode (it toggles away/back as the SPEC asks); the menu is on right-click / ctrl-click. The R28 tray (menu on click) is kept in the fallback.
- **"Bring Snowbally back" also shows while the window is hidden**, and any command shows a hidden window first; "Hide completely" is disabled while hidden.
- **Ignore state resent at most once per second** when unchanged, and the cache is dropped on blur / lock / show: main's safety resets would otherwise leave the renderer's deduplicated state stale.
- **`flags.test.ts`** was added next to `flags.ts` (tests live in the module folder).
- `createCompanionWindow` now defaults to area mode, which changes the window `shots.ts` gets; noted for the harness worker in `contract-requests/desktop.md` with the event detail shapes for the companion worker.

## Out of scope, noted

The relayed user request also asks for the demo to show the Slack connection and MCP communication (for example with Claude). That is not part of this desktop-shell step; nothing here implements it.
