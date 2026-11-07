/** createDispatcher: the HTTP route table in-process (no socket), JSON in and out, the same errors as over HTTP. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/apps/service/engine.ts';
import { createDispatcher } from '../src/apps/service/http.ts';
import { DEV_FIXTURE } from './support.ts';

test('the dispatcher serves the route table without a socket', async () => {
  const engine = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T12:00:00.000Z') });
  try {
    const call = createDispatcher(engine);
    const health = await call('GET', '/health');
    assert.equal(health.status, 200);
    assert.equal((health.body as { ok: boolean }).ok, true);
    assert.equal((await call('GET', '/nope')).status, 404);
    assert.equal((await call('DELETE', '/health')).status, 405);
    assert.equal((await call('POST', '/import', { format: 'bogus' })).status, 400);
    const imp = await call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
    assert.equal(imp.status, 200, JSON.stringify(imp.body));
    const cases = await call('GET', '/cases');
    assert.ok(Array.isArray(cases.body) && (cases.body as unknown[]).length > 0);
  } finally {
    engine.close();
  }
});
