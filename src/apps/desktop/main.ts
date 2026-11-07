/**
 * Electron main process. Launch behaviour (R05): a transparent always-on-top window with only Lumi
 * visible; he falls in from the top of the screen once (R28) and lands at his home spot; the panel opens when he
 * is clicked. Flip OPEN_ON_LAUNCH to start with the panel open instead.
 *
 * desktop (R31..R36): the window covers the work area (KT_WINDOW_MODE=column keeps the R28 column), the flags in
 * flags.ts reach the renderer as query params, and the shell (tray away/back, global shortcut, power events,
 * right-click menu, click-through resets) is built by createShell() in window.ts.
 */
import { app, BrowserWindow, ipcMain, Menu, safeStorage, session } from 'electron';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { getPriority, setPriority } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_SERVICE_PORT } from '../../libs/utils/contracts/service.ts';
import { allowServiceCors, createCompanionWindow, createShell, handleMouseIgnore } from './window.ts';
import type { Shell } from './window.ts';
import { appMenuTemplate, columnIgnoredEnv, flagsFromEnv, flagsToQuery, IPC, restoreDefaultPriority } from './flags.ts';
import { createKeychain, KEY_FILE, parseKeyPayload, sendKeyToService, type Keychain } from './keychain.ts';

const OPEN_ON_LAUNCH = false;
const HEALTH_TIMEOUT_MS = 10000;
const mock = process.env.KT_MOCK === '1';
const port = Number(process.env.KT_PORT) || DEFAULT_SERVICE_PORT;
const serviceUrl = `http://127.0.0.1:${port}`;
// desktop (R31..R36): KT_WINDOW_MODE, KT_COMPANION, KT_DRAG, KT_AWAY, KT_GAZE, KT_FIDGETS, KT_SHORTCUT.
const flags = flagsFromEnv(process.env);
// desktop (shell-16): drag / away / shortcut stay off in the column fallback.
const ignoredInColumn = columnIgnoredEnv(process.env);
if (ignoredInColumn.length) console.error(`[desktop] KT_WINDOW_MODE=column: ${ignoredInColumn.join(', ')} ignored (no drag, no away in the column)`);

let win: BrowserWindow | null = null;
let shell: Shell | null = null;
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

/**
 * B2: api keys. Encrypted with safeStorage into appData/<app name>/model-keys.json (never the repo or data/, also under demo:judge), handed to the
 * service in memory on save and after the service is up. Only the validated `{vendor, key}` crosses the IPC.
 */
function keychain(): Keychain {
  // appData/<app name> is the default userData; demo:judge's --user-data-dir (under the repo's data/) does not move it.
  const dir = join(app.getPath('appData'), app.getName());
  const file = join(dir, KEY_FILE);
  return createKeychain(safeStorage, {
    read: () => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    write: (text) => { mkdirSync(dir, { recursive: true }); writeFileSync(file, text, { mode: 0o600 }); },
  });
}

function handleKeys(): void {
  ipcMain.handle(IPC.keySave, async (_event, payload: unknown) => {
    const p = parseKeyPayload(payload);
    if (!p) throw new Error('invalid key payload');
    const { stored } = p.key ? keychain().save(p.vendor, p.key) : keychain().forget(p.vendor);
    if (mock) return { present: !!p.key, stored };
    const r = await sendKeyToService(serviceUrl, p.vendor, p.key);
    return { present: r.present, stored };
  });
}

/** A freshly started service holds no key: give it the stored ones (memory only on its side). */
async function restoreKeys(): Promise<void> {
  // demo:judge (KT_NO_API=1): hosted models stay off, so no stored key reaches the service.
  if (process.env.KT_NO_API === '1') return;
  for (const { vendor, key } of keychain().load()) {
    try {
      await sendKeyToService(serviceUrl, vendor, key);
    } catch {
      console.error(`[desktop] could not hand the ${vendor} key to the service`);
    }
  }
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

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // desktop (R36): launching again brings him back (and shows the window if it was hidden).
  app.on('second-instance', () => shell?.command('return'));
  handleMouseIgnore(() => win);
  void app.whenReady().then(() => {
    // desktop (M4): a niced launch (background shell) starves requestAnimationFrame; reset to 0 before the window
    // (and so the renderer, which inherits it) is created. Unprivileged processes may be refused: logged, not fatal.
    if (typeof getPriority === 'function' && typeof setPriority === 'function') {
      restoreDefaultPriority({
        get: () => getPriority(),
        set: (v) => setPriority(v),
        log: (m) => console.log('[desktop] ' + m),
        error: (m) => console.error('[desktop] ' + m),
      });
    }
    // desktop (shell-08): no default menu (Cmd+W would close the only window and quit, Cmd+R reload mid-state).
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform === 'darwin')));
    handleKeys();
    if (!mock) {
      allowServiceCors(session.defaultSession, serviceUrl);
      void ensureService().then((up) => (up ? restoreKeys() : undefined));
    }
    const query: Record<string, string> = flagsToQuery(flags);
    if (mock) query.mock = '1';
    if (OPEN_ON_LAUNCH) query.open = '1';
    win = createCompanionWindow({ serviceUrl, query, mode: flags.windowMode });
    shell = createShell({ getWindow: () => win, flags, resetDemo: () => void resetDemo() });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    service?.kill();
  });
  process.on('exit', () => service?.kill());
  // desktop (shell-14): SIGHUP too (the launch shell closed), so the service child never outlives the app; and a
  // closed inherited stdout / stderr (background launch) must not crash main with EPIPE.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => app.quit());
  for (const stream of [process.stdout, process.stderr]) stream?.on?.('error', () => undefined);
}
