import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './support.ts';

test('main.ts prints its URL, serves /health and shuts down cleanly on SIGTERM', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'src/apps/service/main.ts'), '--port', '0', '--db', ':memory:', '--seed', 'empty'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
  const url = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no URL printed')), 10000);
    child.stdout.on('data', () => {
      const m = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) { clearTimeout(t); resolve(m[1]!); }
    });
    child.once('exit', (c) => reject(new Error(`exited early with ${c}`)));
  });
  const health = await (await fetch(`${url}/health`)).json();
  assert.equal(health.ok, true);
  const exited = new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
});

test('main.ts rejects a bad --seed', async () => {
  const child = spawn(process.execPath, [join(ROOT, 'src/apps/service/main.ts'), '--seed', 'bogus'], { stdio: 'ignore' });
  assert.equal(await new Promise((r) => child.once('exit', (c) => r(c))), 2);
});

test('the judge demo starts the service with quiet hours off; the agent demo runs the 03:00 sequence with them on (D-B7-11)', async () => {
  const { readFileSync } = await import('node:fs');
  const judge = readFileSync(join(ROOT, 'scripts/demo-judge.mjs'), 'utf8');
  assert.match(judge, /'quiet-hours': \{ type: 'string', default: 'off' \}/);
  assert.match(judge, /'--quiet-hours', values\['quiet-hours'\]/);
  const agent = readFileSync(join(ROOT, 'scripts/mcp-demo.ts'), 'utf8');
  assert.match(agent, /'--quiet-hours', values\.day \? 'off' : 'on'/);
  assert.match(agent, /night: \{ type: 'string', default: '2026-11-08T01:00:00Z' \}/);
  assert.match(agent, /'--clock', clock/);
});
