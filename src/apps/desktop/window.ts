/**
 * Shared window and shell construction for the app entry (main.ts) and the screenshot harness (shots.ts).
 *
 * desktop (R31..R36): the window covers the primary display's work area exactly (KT_WINDOW_MODE=column keeps
 * the R28 420 px column); the shell (tray, global shortcut, power events, context menu) lives here too so it
 * can be exercised without booting main.ts.
 */
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, powerMonitor, screen, shell, Tray } from 'electron';
import type { IpcMainEvent, Rectangle, Session } from 'electron';
import { join } from 'node:path';
import { createTrayIcon } from './tray-icon.ts';
import { awayEnabled, boundsFor, COLUMN, contextPageUrl, createReloadGate, flagsFromEnv, IPC, isAllowedExternal, isShellCommand, menuTemplate, normaliseState, sameRect, SHORTCUT_ACCELERATOR, trayTitle } from './flags.ts';
import type { Area, DesktopFlags, PowerEvent, ShellCommand, ShellState, WindowMode } from './flags.ts';

/**
 * Column mode (R28): `height` is the panel area (the open question view with its context expanded, avatar
 * below it) and the minimum window height; the column spans the whole work-area height so the launch fall can
 * start at the top of the screen. In area mode (R31) the window is the work area itself.
 */
export const WINDOW = COLUMN;

export interface CompanionWindowOptions {
  serviceUrl: string;
  query?: Record<string, string>;
  /** false keeps the window hidden (used for capture runs). */
  show?: boolean;
  /** Column width (column mode only). */
  width?: number;
  /** Default: KT_WINDOW_MODE from the environment (`area` unless `column`). */
  mode?: WindowMode;
}

/** desktop (R31): `area` unless KT_WINDOW_MODE=column. */
export const windowModeFromEnv = (): WindowMode => flagsFromEnv(process.env).windowMode;

/** desktop (R31): the bounds the companion window must have right now for this mode (harness + display listeners). */
export function windowBounds(mode: WindowMode = windowModeFromEnv(), width: number = WINDOW.width): Rectangle {
  return boundsFor(mode, screen.getPrimaryDisplay().workArea, width);
}

/** Column mode height (R28). */
export function windowHeight(): number {
  return boundsFor('column', screen.getPrimaryDisplay().workArea).height;
}

/** Column mode placement (R28), unchanged. */
export function placeBottomRight(win: BrowserWindow, width: number = WINDOW.width): void {
  win.setBounds(boundsFor('column', screen.getPrimaryDisplay().workArea, width));
}

/**
 * The renderer loads from file:// and talks to the local service over http, so the service's
 * responses get permissive CORS headers here (only for the service origin) and the preflight is
 * answered locally. Nothing leaves the machine.
 */
export function allowServiceCors(session: Session, serviceUrl: string): void {
  session.webRequest.onHeadersReceived({ urls: [serviceUrl.replace(/\/+$/, '') + '/*'] }, (details, callback) => {
    const headers: Record<string, string[]> = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('access-control-')) delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    headers['Access-Control-Allow-Headers'] = ['content-type'];
    headers['Access-Control-Allow-Methods'] = ['GET,POST,PUT,OPTIONS'];
    if (details.method === 'OPTIONS') callback({ responseHeaders: headers, statusLine: 'HTTP/1.1 204 No Content' });
    else callback({ responseHeaders: headers });
  });
}

/** desktop (R31): click-through safety net. The renderer turns it off again on the next hit. */
export function forceClickThrough(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(true, { forward: true });
}

const lastArea = new WeakMap<BrowserWindow, string>();

/** desktop (R31): tell the renderer the window's content size (`kt:area`); deduplicated unless forced. */
export function sendArea(win: BrowserWindow, force = false): Area | null {
  if (win.isDestroyed()) return null;
  const { width, height } = win.getContentBounds();
  const key = `${width}x${height}`;
  if (!force && lastArea.get(win) === key) return null;
  lastArea.set(win, key);
  const area: Area = { width, height };
  win.webContents.send(IPC.area, area);
  return area;
}

export function createCompanionWindow(options: CompanionWindowOptions): BrowserWindow {
  const mode = options.mode ?? windowModeFromEnv();
  const bounds = windowBounds(mode, options.width ?? WINDOW.width);
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // Windows / Linux: the full-work-area overlay must not appear as a taskbar button or in Alt-Tab; the tray icon
    // is the handle there. macOS keeps its Dock icon.
    skipTaskbar: process.platform !== 'darwin',
    alwaysOnTop: true,
    // desktop (shell-09): the first click on him while another app is active reaches the page (macOS default:
    // that click only activates the window). Not yet verified with a real mouse.
    acceptFirstMouse: true,
    show: false,
    title: 'Lumi',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--kt-service-url=${options.serviceUrl}`],
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // desktop (R31): a full-work-area overlay must not show up as a window in Mission Control (macOS only).
  if (typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);
  win.setBounds(bounds);
  // Start click-through; the renderer turns it off while the pointer is over Lumi or the panel.
  win.setIgnoreMouseEvents(true, { forward: true });

  // desktop (R31): follow the work area (resolution / Dock / menu bar changes) and tell the renderer.
  // desktop (shell-04): only when the bounds really change (events for other displays, or repeats, used to force a
  // kt:area that snapped an in-flight leave / arrive / return); the area message is deduplicated by size.
  const reapply = (): void => {
    if (win.isDestroyed()) return;
    const next = windowBounds(mode, mode === 'column' ? win.getBounds().width : WINDOW.width);
    if (sameRect(next, win.getBounds())) return;
    win.setBounds(next);
    sendArea(win);
  };
  screen.on('display-metrics-changed', reapply);
  screen.on('display-added', reapply);
  screen.on('display-removed', reapply);
  win.on('resize', () => sendArea(win));
  win.webContents.on('did-finish-load', () => sendArea(win, true));

  // desktop (R31): click-through safety: never leave a transparent full-screen window catching the mouse.
  // desktop (shell-07): and reload it, so the tray / shortcut / second-instance commands reach a live page again
  // (at most 3 reloads a minute; then it stays click-through and Quit is the way out).
  const reloadGate = createReloadGate();
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[desktop] renderer gone (${details.reason}); click-through forced on`);
    forceClickThrough(win);
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    if (reloadGate(Date.now())) {
      console.error('[desktop] reloading the renderer');
      win.webContents.reload();
    } else console.error('[desktop] renderer crashed 3 times within a minute; not reloading again');
  });
  // desktop (shell-13): the preload bridge must never reach another page (a file dropped outside the card would
  // otherwise navigate the window to it); no new windows either.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Nothing opens inside the app; the key pages and the Ollama download page (allowlist) open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('unresponsive', () => forceClickThrough(win));
  win.on('blur', () => forceClickThrough(win));
  win.on('closed', () => {
    screen.off('display-metrics-changed', reapply);
    screen.off('display-added', reapply);
    screen.off('display-removed', reapply);
  });

  void win.loadFile(join(__dirname, 'index.html'), { query: options.query ?? {} });
  if (options.show !== false) win.once('ready-to-show', () => win.showInactive());
  return win;
}

/** Wire the renderer's hit-test reports to the window (standard transparent-window pattern). */
export function handleMouseIgnore(getWindow: () => BrowserWindow | null): void {
  ipcMain.on(IPC.ignoreMouse, (event: IpcMainEvent, flag: unknown) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    // desktop (shell-15): only our page, only a boolean (a malformed falsy payload must not un-ignore the window).
    if (event.sender !== win.webContents || typeof flag !== 'boolean') return;
    if (flag) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  });
}

/**
 * B3: "Open the context layer" from the case view: the main process opens `<serviceUrl>/context.html?entity=<name>` in
 * the system browser. Only from our page, only a valid entity name, only that path on the configured loopback service.
 */
export function handleOpenContext(getWindow: () => BrowserWindow | null, serviceUrl: string): void {
  ipcMain.on(IPC.openContext, (event: IpcMainEvent, name: unknown) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || event.sender !== win.webContents) return;
    const url = contextPageUrl(serviceUrl, name);
    if (url) void shell.openExternal(url);
  });
}

// ---- desktop (R36): shell: tray, menu, global shortcut, power events, context menu ----

export interface ShellOptions {
  getWindow: () => BrowserWindow | null;
  flags: DesktopFlags;
  resetDemo: () => void;
  quit?: () => void;
}

export interface Shell {
  readonly tray: Tray;
  /** The global shortcut registered (false when the flag is off or register() returned false). */
  readonly shortcutRegistered: boolean;
  state(): ShellState;
  /** The tray / context menu as it would show now. */
  menu(): Menu;
  /** Send a command to the renderer; shows the window first when it was hidden ("Hide completely"). */
  command(command: ShellCommand): void;
  /** Tray click and global shortcut: away / back (or show / hide in the fallback). */
  toggle(): void;
  /** What the renderer reported (also reachable through the `kt:state` IPC). */
  setState(state: ShellState): void;
  dispose(): void;
}

export function createShell(options: ShellOptions): Shell {
  const { getWindow, flags } = options;
  const mac = process.platform === 'darwin';
  const away = awayEnabled(flags);
  let state: ShellState = { away: false, question: false };
  const live = (): BrowserWindow | null => {
    const w = getWindow();
    return w && !w.isDestroyed() ? w : null;
  };

  const show = (): void => {
    const win = live();
    if (!win) return;
    win.showInactive(); // never steals focus
    win.webContents.send(IPC.show);
    refresh();
  };
  const hide = (): void => {
    const win = live();
    if (!win) return;
    forceClickThrough(win);
    win.hide();
    refresh();
  };
  const command = (c: ShellCommand): void => {
    const win = live();
    if (!win) return;
    let cmd = c;
    if (!win.isVisible()) {
      show();
      if (cmd === 'toggle-away') cmd = 'return';
    }
    win.webContents.send(IPC.command, { command: cmd });
  };
  const toggle = (): void => {
    if (away) return command('toggle-away');
    const win = live();
    if (win?.isVisible()) hide();
    else show();
  };
  const menu = (): Menu =>
    Menu.buildFromTemplate(
      menuTemplate(
        { flags, state, shortcutRegistered, visible: live()?.isVisible() ?? false },
        { command, hide, show, resetDemo: options.resetDemo, quit: options.quit ?? (() => app.quit()) },
      ),
    );

  const tray = new Tray(createTrayIcon(process.platform));
  tray.setToolTip('Lumi');
  // desktop (R36): on macOS a set context menu would swallow the left click; the click toggles away / back and
  // right-click (or ctrl-click) opens the menu. Fallback mode keeps the R28 tray (menu on click).
  const clickToggles = away && mac;
  function refresh(): void {
    if (tray.isDestroyed()) return;
    if (!clickToggles) tray.setContextMenu(menu());
    if (mac) tray.setTitle(trayTitle(state));
  }
  const onTrayClick = (): void => toggle();
  const onTrayRightClick = (): void => tray.popUpContextMenu(menu());
  if (clickToggles) {
    tray.on('click', onTrayClick);
    tray.on('right-click', onTrayRightClick);
  } else tray.on('click', onTrayClick); // R28 behaviour, unchanged

  // desktop (R36): global shortcut, logged and omitted from the menu when the OS refuses it.
  let shortcutRegistered = false;
  if (flags.shortcut && away) {
    try {
      shortcutRegistered = globalShortcut.register(SHORTCUT_ACCELERATOR, toggle);
    } catch (e) {
      console.error('[desktop] global shortcut threw', e);
    }
    if (!shortcutRegistered) console.error(`[desktop] global shortcut ${SHORTCUT_ACCELERATOR} not registered (taken by another app?); tray only`);
  }
  const unregister = (): void => {
    if (shortcutRegistered) globalShortcut.unregisterAll();
  };
  app.on('will-quit', unregister);

  // desktop (R34): power events for the attention rules; lock also forces click-through.
  const power = (event: PowerEvent) => (): void => {
    const win = live();
    if (event === 'lock-screen') forceClickThrough(win);
    win?.webContents.send(IPC.power, { event });
  };
  const powerHandlers = { resume: power('resume'), 'unlock-screen': power('unlock-screen'), 'lock-screen': power('lock-screen') };
  powerMonitor.on('resume', powerHandlers.resume);
  powerMonitor.on('unlock-screen', powerHandlers['unlock-screen']);
  powerMonitor.on('lock-screen', powerHandlers['lock-screen']);

  const fromOurWindow = (e: IpcMainEvent): boolean => e.sender === live()?.webContents;
  const onState = (e: IpcMainEvent, s: unknown): void => {
    if (fromOurWindow(e)) setState(normaliseState(s));
  };
  const onContextMenu = (e: IpcMainEvent): void => {
    const win = live();
    if (win && fromOurWindow(e)) menu().popup({ window: win });
  };
  ipcMain.on(IPC.state, onState);
  ipcMain.on(IPC.contextMenu, onContextMenu);

  function setState(s: ShellState): void {
    if (s.away === state.away && s.question === state.question) return;
    state = { ...s };
    refresh();
  }

  refresh();

  return {
    tray,
    get shortcutRegistered() {
      return shortcutRegistered;
    },
    state: () => ({ ...state }),
    menu,
    command,
    toggle,
    setState,
    dispose(): void {
      unregister();
      shortcutRegistered = false;
      app.off('will-quit', unregister);
      powerMonitor.off('resume', powerHandlers.resume);
      powerMonitor.off('unlock-screen', powerHandlers['unlock-screen']);
      powerMonitor.off('lock-screen', powerHandlers['lock-screen']);
      ipcMain.off(IPC.state, onState);
      ipcMain.off(IPC.contextMenu, onContextMenu);
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
