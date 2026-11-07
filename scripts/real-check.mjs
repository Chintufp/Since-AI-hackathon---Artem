// Real-service check: start the service on a spare port (in-memory db, Elisa seed), build the desktop app, run the
// Electron screenshot harness against it (KT_SHOTS_REAL) and tear the service down.
// Output: docs/runs/2026-11-07-overnight/screenshots/real/*.png, checks-real.json and compare-real.json (the states
// against the committed PNGs; python3 + Pillow, skipped when missing).
// Env: KT_REAL_PORT (default 47951), KT_SHOTS_HIDDEN=1.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { post } from './screenshot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.KT_REAL_PORT) || 47951;
const url = `http://127.0.0.1:${port}`;

await import('./build.mjs');

const service = spawn(process.execPath, [join(root, 'src/apps/service/main.ts'), '--port', String(port), '--db', ':memory:', '--seed', 'elisa'], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
const stop = () => { if (!service.killed) service.kill(); };
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(1); });

const deadline = Date.now() + 60000;
let ready = false;
while (Date.now() < deadline && service.exitCode === null) {
  try { ready = (await fetch(url + '/health', { signal: AbortSignal.timeout(800) })).ok; } catch { /* not yet */ }
  if (ready) break;
  await new Promise((r) => setTimeout(r, 300));
}
if (!ready) { console.error('service did not become healthy on ' + url); stop(); process.exit(1); }

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env, KT_SHOTS_REAL: url };
delete env.ELECTRON_RUN_AS_NODE;
delete env.KT_MOCK;
const child = spawn(electron, [join(root, 'dist/desktop/shots.cjs')], { stdio: 'inherit', env });
child.on('exit', (code) => {
  stop();
  if (code === 0) post(process.env.KT_SHOTS_OUT ?? join(root, 'docs/runs/2026-11-07-overnight/screenshots/real'), 'real');
  process.exit(code ?? 0);
});
