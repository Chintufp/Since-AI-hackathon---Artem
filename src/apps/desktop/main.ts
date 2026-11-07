/**
 * Electron main process. Launch behaviour (R05): a small transparent always-on-top window with
 * only Snowbally visible at the bottom-right; he falls in from the top of the screen once (R28) and idles; the panel
 * opens when he is clicked. Flip OPEN_ON_LAUNCH to start with the panel open instead.
 */
import { app, BrowserWindow, Menu, session, Tray } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SERVICE_PORT } from '../../libs/utils/contracts/service.ts';
import { allowServiceCors, createCompanionWindow, handleMouseIgnore } from './window.ts';
import { createTrayIcon } from './tray-icon.ts';

const OPEN_ON_LAUNCH = false;
const HEALTH_TIMEOUT_MS = 10000;
const mock = process.env.KT_MOCK === '1';
const port = Number(process.env.KT_PORT) || DEFAULT_SERVICE_PORT;
const serviceUrl = `http://127.0.0.1:${port}`;

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let service: ChildProcess | null = null;

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch(serviceUrl + '/health', { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the service as a child process if it is not already answering; wait up to 10 s for /health. */
async function ensureService(): Promise<boolean> {
  if (await healthy()) return true;
  if (process.env.KT_NO_SERVICE === '1') return false;
  const entry = process.env.KT_SERVICE_ENTRY ?? resolve(__dirname, '../../src/apps/service/main.ts');
  if (!existsSync(entry)) {
    console.error(`[desktop] service entry not found: ${entry}`);
    return false;
  }
  const start = (command: string, env: NodeJS.ProcessEnv): ChildProcess => {
    const child = spawn(command, [entry, '--port', String(port)], { stdio: ['ignore', 'inherit', 'inherit'], env });
    return child;
  };
  service = start(process.env.KT_NODE ?? 'node', process.env);
  service.on('error', () => {
    // No `node` on PATH (GUI launch): fall back to Electron's own Node runtime.
    service = start(process.execPath, { ...process.env, ELECTRON_RUN_AS_NODE: '1' });
  });
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthy()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error('[desktop] service did not become healthy within 10 s; the panel will show the error state');
  return false;
}

function showWindow(): void {
  if (!win) return;
  win.showInactive();
  win.webContents.send('kt:show');
}

function toggleWindow(): void {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

async function resetDemo(): Promise<void> {
  if (mock) return;
  try {
    await fetch(serviceUrl + '/demo/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    win?.webContents.send('kt:show');
  } catch (e) {
    console.error('[desktop] reset failed', e);
  }
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Snowbally');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide Snowbally', click: toggleWindow },
      { label: 'Reset demo', click: () => void resetDemo() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', toggleWindow);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  handleMouseIgnore(() => win);
  void app.whenReady().then(() => {
    if (!mock) {
      allowServiceCors(session.defaultSession, serviceUrl);
      void ensureService();
    }
    const query: Record<string, string> = {};
    if (mock) query.mock = '1';
    if (OPEN_ON_LAUNCH) query.open = '1';
    win = createCompanionWindow({ serviceUrl, query });
    createTray();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    service?.kill();
  });
  process.on('exit', () => service?.kill());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit());
}
