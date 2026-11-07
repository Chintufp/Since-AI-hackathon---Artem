import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from './sqlite-store.ts';
import type { Claim } from '../contracts/index.ts';

const claim = (i: number, text = `statement number ${i}`, caseId = `c${i % 10}`): Claim => ({
  id: `cl${i}`, orgId: 'o', type: 'observation', statement: text, subjectEntityIds: [], caseId, origin: 'reported',
  supporting: [], contradicting: [], validity: {}, status: 'provisional', extraction: { route: 'rules', version: 't' },
  revision: 1, createdAt: 'x', updatedAt: 'x', accessScope: { visibility: 'org' },
});

for (const disableFts of [false, true]) {
  test(`store basics and search (fts disabled=${disableFts})`, () => {
    const s = openStore(':memory:', { disableFts });
    assert.equal(s.searchMode, disableFts ? 'term-overlap' : 'fts5');
    s.put('claim', claim(1, 'traffic counters stay at zero', 'a'));
    s.put('claim', claim(2, 'disable and enable the interface', 'b'));
    s.put('claim', claim(3, 'barrier key is at the gate', 'b'));
    assert.equal(s.get('claim', 'cl2')?.caseId, 'b');
    assert.equal(s.count('claim'), 3);
    assert.equal(s.count('claim', { caseId: 'b' }), 2);
    assert.deepEqual(s.list('claim', { where: { caseId: 'b' } }).map((c) => c.id), ['cl2', 'cl3']);
    assert.deepEqual(s.list('claim', { orderBy: { field: 'id', direction: 'desc' }, limit: 1 }).map((c) => c.id), ['cl3']);
    const hits = s.searchText(['claim'], 'counters zero');
    assert.equal(hits[0]?.id, 'cl1');
    assert.ok(hits[0]!.score > 0);
    // update replaces search body and keeps order
    s.put('claim', claim(1, 'something else entirely', 'a'));
    assert.equal(s.searchText(['claim'], 'counters').length, 0);
    assert.equal(s.list('claim')[0]!.id, 'cl1');
    assert.equal(s.delete('claim', 'cl3'), true);
    assert.equal(s.searchText(['claim'], 'barrier').length, 0);
    assert.equal(s.delete('claim', 'cl3'), false);
    s.clear();
    assert.equal(s.count('claim'), 0);
    s.close();
  });
}

test('transaction rolls back on throw and nests', () => {
  const s = openStore(':memory:');
  assert.throws(() => s.transaction(() => { s.put('claim', claim(1)); throw new Error('boom'); }));
  assert.equal(s.count('claim'), 0);
  s.transaction(() => { s.transaction(() => s.put('claim', claim(2))); s.put('claim', claim(3)); });
  assert.equal(s.count('claim'), 2);
});

test('rejects unsafe where fields', () => {
  const s = openStore(':memory:');
  assert.throws(() => s.list('claim', { where: { "a') OR 1=1 --": 1 } }));
});

test('benchmark: 5k puts under 2s', () => {
  const s = openStore(':memory:');
  const t0 = performance.now();
  s.putMany('claim', Array.from({ length: 5000 }, (_, i) => claim(i)));
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `5k puts took ${ms.toFixed(0)}ms`);
  assert.equal(s.count('claim', { caseId: 'c3' }), 500);
});
