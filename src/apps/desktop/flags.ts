/**
 * desktop (R31..R36): flags, IPC names and the pure helpers of the desktop shell.
 *
 * No Electron or Node runtime import here: this module is bundled into main (node), preload (sandboxed)
 * and the renderer (browser), and is unit-tested with node:test. Every behaviour of the UX pass is behind
 * one of the flags below; `KT_WINDOW_MODE=column` restores the R28 window with every flag off.
 */
import type { MenuItemConstructorOptions } from 'electron';

// ---- flags ----

/** `area`: the window covers the primary work area (R31). `column`: today's 420 px column (R28 fallback). */
export type WindowMode = 'area' | 'column';

export interface DesktopFlags {
  /** desktop (R31): the companion module (carrier, away, peek, perch) runs at all. */
  companion: boolean;
  /** desktop (R32): Snowbally can be picked up and dropped. */
  drag: boolean;
  /** desktop (R33): away is his home state (leave after launch / close, peek on proximity). */
  away: boolean;
  /** desktop (R33): cursor awareness (gaze / quarter view) while in. */
  gaze: boolean;
  /** desktop (R35): rare idle fidgets. Off by default. */
  fidgets: boolean;
  /** desktop (R36): global shortcut CommandOrControl+Alt+S toggles away / back. */
  shortcut: boolean;
  windowMode: WindowMode;
}

export const FLAG_NAMES = ['companion', 'drag', 'away', 'gaze', 'fidgets', 'shortcut'] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

export const DEFAULT_FLAGS: Readonly<DesktopFlags> = Object.freeze({
  companion: true,
  drag: true,
  away: true,
  gaze: true,
  fidgets: false,
  shortcut: true,
  windowMode: 'area',
});

/**
 * desktop (R31): column mode degrades to "no drag, no away": every flag off unless an env var turns it on,
 * except drag / away / shortcut, which stay off in the column whatever the env says (COLUMN_FORCED_OFF, shell-16).
 */
export const COLUMN_FLAGS: Readonly<DesktopFlags> = Object.freeze({
  companion: false,
  drag: false,
  away: false,
  gaze: false,
  fidgets: false,
  shortcut: false,
  windowMode: 'column',
});

/** Env var per flag: KT_COMPANION, KT_DRAG, KT_AWAY, KT_GAZE, KT_FIDGETS, KT_SHORTCUT. */
export const flagEnvName = (name: FlagName): string => 'KT_' + name.toUpperCase();

const parseBool = (value: string | null | undefined): boolean | undefined => {
  if (value == null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return undefined;
};

/**
 * desktop (shell-16): flags that make no sense against a 420 px column (away / peek would tuck him at the column's
 * left edge in the middle of the screen). Forced off in column mode even when an env var or query param asks.
 */
export const COLUMN_FORCED_OFF = ['drag', 'away', 'shortcut'] as const satisfies readonly FlagName[];

const applyColumnLimits = (flags: DesktopFlags): DesktopFlags => {
  if (flags.windowMode === 'column') for (const name of COLUMN_FORCED_OFF) flags[name] = false;
  return flags;
};

/** desktop (shell-16): the KT_<FLAG> env vars the column fallback ignores (main logs them). */
export function columnIgnoredEnv(env: Readonly<Record<string, string | undefined>>): string[] {
  if (env.KT_WINDOW_MODE?.trim().toLowerCase() !== 'column') return [];
  return COLUMN_FORCED_OFF.map(flagEnvName).filter((k) => parseBool(env[k]) === true);
}

/** Flags for the main process: `KT_WINDOW_MODE=column` picks the fallback defaults, then `KT_<FLAG>=0|1` overrides. */
export function flagsFromEnv(env: Readonly<Record<string, string | undefined>>): DesktopFlags {
  const windowMode: WindowMode = env.KT_WINDOW_MODE?.trim().toLowerCase() === 'column' ? 'column' : 'area';
  const flags: DesktopFlags = { ...(windowMode === 'column' ? COLUMN_FLAGS : DEFAULT_FLAGS) };
  for (const name of FLAG_NAMES) {
    const v = parseBool(env[flagEnvName(name)]);
    if (v !== undefined) flags[name] = v;
  }
  return applyColumnLimits(flags);
}

/** Query params for the renderer (like `mock`): `companion=1&drag=1&…&window=area`. */
export function flagsToQuery(flags: DesktopFlags): Record<string, string> {
  const query: Record<string, string> = {};
  for (const name of FLAG_NAMES) query[name] = flags[name] ? '1' : '0';
  query.window = flags.windowMode;
  return query;
}

/** Renderer / preload side: parse the query back. A missing param falls back to the defaults of its window mode. */
export function parseFlags(search: string | URLSearchParams): DesktopFlags {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const windowMode: WindowMode = params.get('window') === 'column' ? 'column' : 'area';
  const flags: DesktopFlags = { ...(windowMode === 'column' ? COLUMN_FLAGS : DEFAULT_FLAGS) };
  for (const name of FLAG_NAMES) {
    const v = parseBool(params.get(name));
    if (v !== undefined) flags[name] = v;
  }
  return applyColumnLimits(flags);
}

// ---- shell constants and IPC surface ----

/** desktop (R36): global shortcut (spike: registers on this Mac; failure is logged and the accelerator omitted). */
export const SHORTCUT_ACCELERATOR = 'CommandOrControl+Alt+S';

export const SHELL_COMMANDS = ['away', 'return', 'toggle-away', 'reset-position'] as const;
export type ShellCommand = (typeof SHELL_COMMANDS)[number];
export const isShellCommand = (v: unknown): v is ShellCommand => typeof v === 'string' && (SHELL_COMMANDS as readonly string[]).includes(v);

export const POWER_EVENTS = ['resume', 'unlock-screen', 'lock-screen'] as const;
export type PowerEvent = (typeof POWER_EVENTS)[number];
export const isPowerEvent = (v: unknown): v is PowerEvent => typeof v === 'string' && (POWER_EVENTS as readonly string[]).includes(v);

/** What the renderer reports to main: drives the tray label and the tray title. */
export interface ShellState {
  away: boolean;
  question: boolean;
}
export const normaliseState = (v: unknown): ShellState => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { away: o.away === true, question: o.question === true };
};

export interface Area {
  width: number;
  height: number;
}

/** IPC channels between main and preload. */
export const IPC = {
  ignoreMouse: 'kt:ignore-mouse',
  show: 'kt:show',
  command: 'kt:command', // main → renderer { command: ShellCommand }
  power: 'kt:power', // main → renderer { event: PowerEvent }
  area: 'kt:area', // main → renderer { width, height }
  state: 'kt:state', // renderer → main ShellState
  contextMenu: 'kt:context-menu', // renderer → main (no payload)
} as const;

/**
 * desktop (R31..R36): CustomEvents on `window` so the companion module (src/libs) never imports Electron.
 * Incoming (renderer.ts dispatches): command {command}, power {event}, area {width,height}.
 * Outgoing (the companion dispatches, renderer.ts forwards to main): moved (no detail), state {away,question},
 * context-menu (no detail).
 */
export const RENDERER_EVENTS = {
  command: 'kt-command',
  power: 'kt-power',
  area: 'kt-area',
  moved: 'kt-companion:moved',
  state: 'kt-companion:state',
  contextMenu: 'kt-companion:context-menu',
} as const;

// ---- geometry ----

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Column mode geometry (R28): kept identical to the original `placeBottomRight`. */
export const COLUMN = { width: 420, height: 680, margin: 12 } as const;

/**
 * desktop (R31): window bounds for a work area. `area` = the work area exactly (no margin);
 * `column` = today's 420 px column at the bottom-right with a 12 px margin, as tall as the work area minus the margin.
 */
export function boundsFor(mode: WindowMode, workArea: Rect, width: number = COLUMN.width): Rect {
  if (mode === 'area') return { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
  const height = Math.max(COLUMN.height, workArea.height - COLUMN.margin);
  return {
    x: workArea.x + workArea.width - width - COLUMN.margin,
    y: workArea.y + workArea.height - height - COLUMN.margin,
    width,
    height,
  };
}

/** Cached hit rect (client CSS px), edges precomputed so the test is four comparisons. */
export interface HitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const toHitRect = (r: { left: number; top: number; width: number; height: number }): HitRect | null =>
  r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height } : null;
export const inRect = (r: HitRect | null, x: number, y: number): boolean => !!r && x >= r.left && x < r.right && y >= r.top && y < r.bottom;

/**
 * desktop (shell-12): the mousemove re-measure fallback only runs near what can take the mouse. The window covers
 * the whole work area, so every mousemove on screen reaches the page; far from him nothing can appear without a
 * `kt-companion:moved` first, so those moves skip the layout read. True when nothing is measured yet.
 */
export const MEASURE_NEAR_PX = 480;
export function nearRects(rects: readonly (HitRect | null)[], x: number, y: number, margin: number = MEASURE_NEAR_PX): boolean {
  let any = false;
  for (const r of rects) {
    if (!r) continue;
    any = true;
    if (x >= r.left - margin && x < r.right + margin && y >= r.top - margin && y < r.bottom + margin) return true;
  }
  return !any;
}

/**
 * desktop (shell-03): only a plain primary press pins click-through off. A right-click or a macOS ctrl-click opens
 * the context menu, whose tracking loop eats the release, so no pointerup would ever unpin.
 */
export const pinsPress = (e: { button: number; ctrlKey: boolean }): boolean => e.button === 0 && !e.ctrlKey;

/** desktop (shell-04): same rectangle (display events often re-send the bounds the window already has). */
export const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

// ---- process health (desktop UX fixes) ----

/**
 * desktop (shell-07): crash-loop guard for reloading a gone renderer: at most `limit` reloads per `windowMs`.
 * Returns a gate; call it with the current time, true = reload now.
 */
export function createReloadGate(limit = 3, windowMs = 60_000): (now: number) => boolean {
  const times: number[] = [];
  return (now) => {
    while (times.length && now - times[0]! >= windowMs) times.shift();
    if (times.length >= limit) return false;
    times.push(now);
    return true;
  };
}

export interface PriorityOps {
  /** Current nice value of the main process (os.getPriority()). */
  get(): number;
  /** os.setPriority(value); may throw (EACCES: an unprivileged process cannot lower its nice value on macOS/Linux). */
  set(value: number): void;
  log(message: string): void;
  error(message: string): void;
}

/**
 * desktop (M4): undo a niced launch (`nice … &` from a background shell). A positive nice value starves the
 * renderer's requestAnimationFrame, which once froze him mid-roll. Children spawned afterwards (the renderer)
 * inherit the main process's value. Never throws; returns what happened.
 */
export function restoreDefaultPriority(ops: PriorityOps): 'normal' | 'restored' | 'failed' {
  let before: number;
  try {
    before = ops.get();
  } catch (e) {
    ops.error(`priority: could not read the nice value (${String(e)})`);
    return 'failed';
  }
  if (!(before > 0)) return 'normal';
  try {
    ops.set(0);
    let after: number | string = '?';
    try {
      after = ops.get();
    } catch {
      /* keep '?' */
    }
    ops.log(`priority: launched with nice ${before}; set to ${after} (renderer inherits it)`);
    return 'restored';
  } catch (e) {
    ops.error(`priority: launched with nice ${before}; could not reset to 0 (${String(e)}); animation may stall, relaunch without nice`);
    return 'failed';
  }
}

/**
 * desktop (shell-08): the application menu. Electron's default menu has Close (Cmd+W, closes the only window and
 * quits), Reload (Cmd+R) and Toggle DevTools; this keeps the app menu (macOS) and Edit (copy / paste in the panel).
 */
export const appMenuTemplate = (mac: boolean): MenuItemConstructorOptions[] => (mac ? [{ role: 'appMenu' }, { role: 'editMenu' }] : [{ role: 'editMenu' }]);

// ---- tray / context menu model ----

export interface MenuModel {
  flags: DesktopFlags;
  state: ShellState;
  /** The global shortcut actually registered (accelerator shown only then). */
  shortcutRegistered: boolean;
  /** The window is shown (false after "Hide completely"). */
  visible: boolean;
}

export interface MenuActions {
  command(command: ShellCommand): void;
  hide(): void;
  show(): void;
  resetDemo(): void;
  quit(): void;
}

/** True when the away / back items replace the old Show / Hide toggle. */
export const awayEnabled = (flags: DesktopFlags): boolean => flags.companion && flags.away;

/** desktop (R36): the tray and right-click menu. Same template for both. */
export function menuTemplate(model: MenuModel, actions: MenuActions): MenuItemConstructorOptions[] {
  if (!awayEnabled(model.flags)) {
    // Fallback (column mode / companion off): the R28 menu.
    return [
      { label: 'Show / Hide Snowbally', click: () => (model.visible ? actions.hide() : actions.show()) },
      { label: 'Reset demo', click: () => actions.resetDemo() },
      { type: 'separator' },
      { label: 'Quit', click: () => actions.quit() },
    ];
  }
  const away = model.state.away || !model.visible;
  const toggle: MenuItemConstructorOptions = {
    label: away ? 'Bring Snowbally back' : 'Send Snowbally away',
    click: () => actions.command(away ? 'return' : 'away'),
  };
  if (model.shortcutRegistered) {
    toggle.accelerator = SHORTCUT_ACCELERATOR;
    toggle.registerAccelerator = false; // shown only; the global shortcut does the work
  }
  return [
    toggle,
    { label: 'Put Snowbally back in the corner', click: () => actions.command('reset-position') },
    { label: 'Reset demo', click: () => actions.resetDemo() },
    { type: 'separator' },
    { label: 'Hide completely (stops questions)', enabled: model.visible, click: () => actions.hide() },
    { label: 'Quit', click: () => actions.quit() },
  ];
}

/** desktop (R34): menu-bar title next to the tray icon: " ?" while he is away with a question waiting. */
export const trayTitle = (state: ShellState): string => (state.away && state.question ? ' ?' : '');
