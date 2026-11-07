// Build, then run the Electron screenshot harness (dist/desktop/shots.cjs) with the dev mock.
// Output: docs/runs/2026-11-07-overnight/screenshots/*.png and checks.json.
// Env: KT_SHOTS_OUT (output dir), KT_SHOTS_HIDDEN=1 (never show the window; uses capturePage only).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('./build.mjs');
const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env, KT_MOCK: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(root, 'dist/desktop/shots.cjs')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
