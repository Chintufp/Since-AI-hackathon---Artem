import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cond, makeCase, ORG } from './testing/fixtures.ts';
import { InMemoryStore } from './testing/in-memory-store.ts';
import { createRng } from './rng.ts';
import { assertRouteInfo, blockedProviderCall, installNetworkGuard, NetworkProviderBlockedError, routeInfo, uniqueRoutes } from './routes.ts';
import { hashInput, ReplayMismatchError, ReplayProvider } from './replay.ts';
import { LogisticHashed, type LabeledText } from './logistic-hashed.ts';
import { listArtifacts, loadArtifact, saveArtifact } from './artifacts.ts';

function toyData(seed: number, n: number): LabeledText[] {
  const rng = createRng(seed);
  const pos = ['interface', 'counters', 'zero', 'stall', 'reset', 'traffic'];
  const neg = ['power', 'fan', 'temperature', 'barrier', 'key', 'desk'];
  const shared = ['the', 'unit', 'reported', 'today', 'site', 'asset'];
  const pick = (a: string[]): string => a[Math.floor(rng() * a.length)] as string;
  return Array.from({ length: n }, (_, i) => {
    const label = (i % 2) as 0 | 1;
    const words = [pick(label ? pos : neg), pick(label ? pos : neg), pick(shared), pick(shared), rng() < 0.15 ? pick(label ? neg : pos) : pick(shared)];
    return { text: words.join(' '), label };
  });
}

test('(9) logistic-hashed learns a toy separable task to >0.9 accuracy, deterministically', () => {
  const train = toyData(1, 200), test_ = toyData(99, 100);
  const m = new LogisticHashed(1024);
  m.train(train, { seed: 7, epochs: 20 });
  assert.ok(m.accuracy(test_) > 0.9, `accuracy ${m.accuracy(test_)}`);
  const m2 = new LogisticHashed(1024);
  m2.train(train, { seed: 7, epochs: 20 });
  assert.deepEqual([...m2.weights], [...m.weights]);
  assert.ok(m.predictProba('interface counters zero') > 0.5 && m.predictProba('power fan temperature') < 0.5);
});

test('artifact save/load round-trips a logistic model through a temp dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-models-'));
  try {
    const m = new LogisticHashed(512);
    m.train(toyData(2, 100), { seed: 1, epochs: 10 });
    const path = saveArtifact(m.toArtifact({ id: 'toy-logistic', dataset: { id: 'toy', split: 'train', families: [] }, seeds: [1], trainedAt: '2026-11-07T00:00:00.000Z' }), dir);
    assert.ok(path.endsWith('toy-logistic.json'));
    assert.deepEqual(listArtifacts(dir), ['toy-logistic']);
    const loaded = LogisticHashed.fromArtifact(loadArtifact('toy-logistic', dir));
    const probe = 'interface reset traffic';
    assert.equal(loaded.predictProba(probe), m.predictProba(probe));
    assert.throws(() => saveArtifact({ ...loadArtifact('toy-logistic', dir), id: '../escape' }, dir), /Unsafe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('replay provider serves recordings, returns undefined for missing keys and rejects changed inputs', () => {
  const p = new ReplayProvider<{ v: number }>({ id: 'fx', entries: { k: { inputHash: hashInput({ b: 2, a: 1 }), output: { v: 9 }, recordedBy: 'test' } } });
  assert.equal(p.get('k', { a: 1, b: 2 })?.output.v, 9);
  assert.equal(p.get('nope'), undefined);
  assert.throws(() => p.get('k', { a: 1, b: 3 }), ReplayMismatchError);
  assert.equal(hashInput({ a: 1, b: 2 }), hashInput({ b: 2, a: 1 }));
});

test('route guard: provider calls throw, fetch is blocked while the guard is installed, labels are validated', async () => {
  assert.throws(() => blockedProviderCall('some-llm'), NetworkProviderBlockedError);
  const restore = installNetworkGuard();
  try {
    assert.throws(() => fetch('https://example.invalid'), NetworkProviderBlockedError);
  } finally {
    restore();
  }
  assert.equal(typeof fetch, 'function');
  assert.throws(() => assertRouteInfo({ route: 'replay', version: 'no-prefix' }));
  assert.doesNotThrow(() => assertRouteInfo({ route: 'replay', version: 'replay:fx' }));
  assert.equal(routeInfo('trigram-hash').route, 'local');
  assert.equal(uniqueRoutes([routeInfo('bm25'), routeInfo('bm25'), undefined]).length, 1);
});

test('in-memory store: put/get isolation, where, orderBy, limit, searchText, transaction rollback', () => {
  const s = new InMemoryStore();
  const c1 = makeCase({ id: 'c1', title: 'Interface counters zero', conditions: [cond('a', 1)] });
  s.put('case', c1);
  c1.title = 'mutated';
  assert.equal(s.get('case', 'c1')?.title, 'Interface counters zero');
  s.put('case', makeCase({ id: 'c2', title: 'Fan warning', status: 'open' }));
  assert.equal(s.list('case', { where: { status: 'open' } }).length, 1);
  assert.deepEqual(s.list('case', { orderBy: { field: 'title', direction: 'desc' } }).map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(s.list('case', { orderBy: { field: 'title' } }).map((c) => c.id), ['c2', 'c1']);
  assert.equal(s.list('case', { limit: 1 }).length, 1);
  assert.equal(s.searchText(['case'], 'counters zero')[0]?.id, 'c1');
  assert.throws(() => s.transaction(() => { s.put('case', makeCase({ id: 'c3', title: 't' })); throw new Error('boom'); }), /boom/);
  assert.equal(s.get('case', 'c3'), undefined);
  assert.equal(s.count('case'), 2);
  assert.ok(s.delete('case', 'c2'));
  s.clear();
  assert.equal(s.count('case'), 0);
  assert.throws(() => s.put('case', { ...c1, id: '' }));
  void ORG;
});
