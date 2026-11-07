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

test('r_embedding: float32 round trip, skip on unchanged textHash, list by (kind, model), deleteRef, clear() wipes it', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'kt-emb-'));
  try {
    const file = join(dir, 'kt.sqlite');
    let s = openStore(file);
    const e = s.embeddings;
    const v = Float32Array.from([0.25, -1.5, 3.125]);
    assert.equal(e.upsert({ kind: 'case', refId: 'case:1', model: 'bge-m3', textHash: 'h1', vector: v }), 'written');
    assert.equal(e.upsert({ kind: 'case', refId: 'case:1', model: 'bge-m3', textHash: 'h1', vector: Float32Array.from([9, 9, 9]) }), 'unchanged');
    assert.equal(e.upsert({ kind: 'claim', refId: 'cl:1', model: 'bge-m3', textHash: 'h2', vector: Float32Array.from([1, 0]) }), 'written');
    assert.equal(e.upsert({ kind: 'case', refId: 'case:1', model: 'nomic-embed-text', textHash: 'h1', vector: Float32Array.from([1]) }), 'written');
    s.close();
    s = openStore(file);
    const row = s.embeddings.get('case', 'case:1', 'bge-m3')!;
    assert.deepEqual([...row.vector], [0.25, -1.5, 3.125]);
    assert.equal(row.dims, 3);
    assert.equal(row.textHash, 'h1');
    assert.deepEqual(s.embeddings.list('case', 'bge-m3').map((r) => r.refId), ['case:1']);
    assert.equal(s.embeddings.upsert({ kind: 'case', refId: 'case:1', model: 'bge-m3', textHash: 'h3', vector: Float32Array.from([1, 2]) }), 'written');
    assert.equal(s.embeddings.get('case', 'case:1', 'bge-m3')!.createdSeq, row.createdSeq, 'rewrite keeps its seq');
    assert.deepEqual([...s.embeddings.get('case', 'case:1', 'bge-m3')!.vector], [1, 2]);
    assert.throws(() => s.embeddings.upsert({ kind: 'person' as 'case', refId: 'x', model: 'm', textHash: 'h', vector: Float32Array.from([1]) }));
    assert.equal(s.embeddings.deleteRef('case', 'case:1'), 2, 'every model of that record');
    assert.equal(s.embeddings.count(), 1);
    s.put('settings', { id: 'user' } as never);
    s.clear();
    assert.equal(s.embeddings.count(), 0, 'demo:reset clears vectors too');
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
