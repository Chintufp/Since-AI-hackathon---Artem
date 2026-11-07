// One command for the judges: reset the demo data, start the service, start the simulated activity stream, open the
// activity page in the browser and launch the desktop companion. Ctrl-C (or quitting Snowbally) stops everything.
//   pnpm demo:judge [-- --seed 1 --hour-seconds 10 --hours 10 --no-browser --no-stream --port 47831]
// Everything runs on this machine; no model API, no real chat, mail or Slack. The stream is simulated and labelled so.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.KT_PORT ?? '47831' },
    seed: { type: 'string', default: '1' },
    'hour-seconds': { type: 'string', default: '10' },
    hours: { type: 'string', default: '10' },
    'judge-every': { type: 'string', default: '120' },
    'no-browser': { type: 'boolean', default: false },
    'no-stream': { type: 'boolean', default: false },
    'no-desktop': { type: 'boolean', default: false },
    'no-reset': { type: 'boolean', default: false },
  },
});
const port = Number(values.port);
const url = `http://127.0.0.1:${port}`;
const children = [];
let closing = false;

const log = (m) => process.stdout.write(`[demo:judge] ${m}\n`);
const run = (label, command, args, extra = {}) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...extra });
  children.push({ label, child });
  child.on('exit', (code, signal) => {
    if (closing) return;
    log(`${label} exited (${signal ?? code})`);
    if (label === 'desktop' || label === 'service') shutdown(label === 'service' ? 1 : 0);
  });
  return child;
};
const shutdown = (code = 0) => {
  if (closing) return;
  closing = true;
  log('stopping…');
  // Stream first (it returns the service clock to real time on SIGINT), then the desktop, then the service.
  for (const label of ['stream', 'desktop', 'service']) for (const c of children.filter((x) => x.label === label)) if (c.child.exitCode === null) c.child.kill('SIGINT');
  setTimeout(() => {
    for (const c of children) if (c.child.exitCode === null) c.child.kill('SIGKILL');
    process.exit(code);
  }, 2500).unref();
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const healthy = async () => {
  try {
    return (await fetch(url + '/health', { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
};

if (await healthy()) {
  log(`a service is already running on ${url}; using it (it will not be stopped at the end)`);
  if (!values['no-reset']) {
    await fetch(url + '/demo/reset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    log('demo data reset');
  }
} else {
  if (!values['no-reset']) {
    log('resetting demo data');
    const r = spawn(process.execPath, [join(root, 'scripts/demo-reset.ts')], { cwd: root, stdio: 'inherit' });
    await new Promise((res) => r.on('exit', res));
  }
  log(`starting the service on ${url}`);
  run('service', process.execPath, [join(root, 'src/apps/service/main.ts'), '--port', String(port)]);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !(await healthy())) await new Promise((r) => setTimeout(r, 250));
  if (!(await healthy())) {
    log('the service did not become healthy within 30 s; see the lines above');
    shutdown(1);
  }
}

if (!values['no-browser']) {
  const page = `${url}/demo/activity.html`;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [page], { stdio: 'ignore', shell: process.platform === 'win32' }).on('error', () => log(`open ${page} in a browser tab to watch the stream`));
  log(`activity page: ${page}`);
}

if (!values['no-stream']) {
  log('starting the simulated activity stream (labelled simulated; Ctrl-C stops it)');
  run('stream', process.execPath, [join(root, 'scripts/demo-play.ts'), '--url', url, '--seed', values.seed, '--hour-seconds', values['hour-seconds'], '--hours', values.hours, '--judge-every', values['judge-every']]);
}

if (!values['no-desktop']) {
  log('building and launching the desktop companion');
  await import('./build.mjs');
  const electron = createRequire(import.meta.url)('electron');
  const env = { ...process.env, KT_PORT: String(port) };
  delete env.ELECTRON_RUN_AS_NODE;
  // A per-checkout user-data directory keeps this companion's single-instance lock and local state apart from any other Electron app.
  run('desktop', electron, [join(root, 'dist/desktop/main.cjs'), `--user-data-dir=${join(root, 'data', 'local', 'electron')}`], { env });
}
log('ready. Click Snowbally (bottom-right); follow docs/DEMO.md. Ctrl-C here stops everything.');
