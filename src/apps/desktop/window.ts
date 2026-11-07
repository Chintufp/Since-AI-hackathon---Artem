/** Shared window construction for the app entry (main.ts) and the screenshot harness (shots.ts). */
import { BrowserWindow, ipcMain, screen } from 'electron';
import type { Session } from 'electron';
import { join } from 'node:path';

/**
 * `height` is the panel area (the open question view with its context expanded, avatar below it) and the
 * minimum window height. The window itself spans the whole work area height (R28) so the launch fall can
 * start at the top of the screen; the extra area is transparent and click-through, and the panel stays
 * anchored at the bottom.
 */
export const WINDOW = { width: 420, height: 680, margin: 12 } as const;

export interface CompanionWindowOptions {
  serviceUrl: string;
  query?: Record<string, string>;
  /** false keeps the window hidden (used for capture runs). */
  show?: boolean;
  width?: number;
}

export function windowHeight(): number {
  const area = screen.getPrimaryDisplay().workArea;
  return Math.max(WINDOW.height, area.height - WINDOW.margin);
}

export function placeBottomRight(win: BrowserWindow, width: number = WINDOW.width): void {
  const area = screen.getPrimaryDisplay().workArea;
  const height = windowHeight();
  win.setBounds({
    x: area.x + area.width - width - WINDOW.margin,
    y: area.y + area.height - height - WINDOW.margin,
    width,
    height,
  });
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

export function createCompanionWindow(options: CompanionWindowOptions): BrowserWindow {
  const width = options.width ?? WINDOW.width;
  const win = new BrowserWindow({
    width,
    height: WINDOW.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    show: false,
    title: 'Snowbally',
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
  placeBottomRight(win, width);
  // Start click-through; the renderer turns it off while the pointer is over Snowbally or the panel.
  win.setIgnoreMouseEvents(true, { forward: true });
  void win.loadFile(join(__dirname, 'index.html'), { query: options.query ?? {} });
  if (options.show !== false) win.once('ready-to-show', () => win.showInactive());
  return win;
}

/** Wire the renderer's hit-test reports to the window (standard transparent-window pattern). */
export function handleMouseIgnore(getWindow: () => BrowserWindow | null): void {
  ipcMain.on('kt:ignore-mouse', (_event, flag: boolean) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (flag) win.setIgnoreMouseEvents(true, { forward: true });
    else win.setIgnoreMouseEvents(false);
  });
}
