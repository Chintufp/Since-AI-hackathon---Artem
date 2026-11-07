import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DEFAULT_MODEL_SLOTS } from '../src/libs/utils/contracts/index.ts';
import { assertRouteInfo, routeInfo, ROUTE_REGISTRY } from '../src/libs/utils/models/routes.ts';
import { startService, type Running } from './support.ts';

let svc: Running;
before(async () => { svc = await startService(); });
after(async () => { await svc.close(); });

test('model slots default to rules for every slot and the new routes are registered, not learned', async () => {
  const s0 = await svc.call('GET', '/settings');
  assert.deepEqual(s0.models, DEFAULT_MODEL_SLOTS);
  for (const k of ['ollama-embed', 'ollama-extract', 'ollama-phrase', 'api-extract', 'api-phrase']) {
    assert.equal(ROUTE_REGISTRY[k]!.learned, false, k);
    assertRouteInfo(routeInfo(k));
  }
  assert.equal(routeInfo('api-phrase').route, 'api');
  assert.equal(routeInfo('ollama-embed').route, 'local');
});

test('PUT /settings accepts a partial models object, merges per slot, and still rejects unknown keys', async () => {
  const a = await svc.call('PUT', '/settings', { models: { embed: { provider: 'local', model: 'bge-m3' } } });
  assert.deepEqual(a.models, { ...DEFAULT_MODEL_SLOTS, embed: { provider: 'local', model: 'bge-m3' } });
  const b = await svc.call('PUT', '/settings', { models: { phrase: { provider: 'api', model: 'claude-sonnet-5-5' } } });
  assert.deepEqual(b.models.embed, { provider: 'local', model: 'bge-m3' }, 'earlier slot choice kept');
  assert.equal(b.models.phrase.provider, 'api');
  assert.deepEqual((await svc.call('GET', '/settings')).models, b.models);
  await svc.call('PUT', '/settings', { nonsense: 1 }, 400);
  await svc.call('PUT', '/settings', { models: { rerank: { provider: 'local' } } }, 400);
  await svc.call('PUT', '/settings', { models: { embed: { provider: 'cloud' } } }, 400);
  await svc.call('PUT', '/settings', { models: { embed: { provider: 'api', key: 'sk-x' } } }, 400);
  const back = await svc.call('PUT', '/settings', { models: DEFAULT_MODEL_SLOTS });
  assert.deepEqual(back.models, DEFAULT_MODEL_SLOTS);
});

test('EngineOptions.models is the default when nothing is stored', async () => {
  const other = await startService({ models: { embed: { provider: 'local', model: 'nomic-embed-text' } } });
  try {
    const s = await other.call('GET', '/settings');
    assert.deepEqual(s.models.embed, { provider: 'local', model: 'nomic-embed-text' });
    assert.deepEqual(s.models.extract, { provider: 'rules' });
  } finally {
    await other.close();
  }
});
