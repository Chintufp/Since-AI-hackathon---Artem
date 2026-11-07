import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Condition } from '../contracts/index.ts';
import { buildSyntheticStore, cond, CASE_REF, E, outsiderPrincipal, requesterPrincipal, SYMPTOM_TEXT } from '../models/testing/fixtures.ts';
import {
  Bm25Index, Bm25Retriever, canSee, compareConditions, cosine, embedTrigrams, ExactIdRetriever, HybridRetriever, reciprocalRankFusion, tokenize,
  TrigramVectorRetriever, VECTOR_DIMS,
} from './index.ts';

const q = (text: string, extra: Partial<Parameters<Bm25Retriever['search']>[0]> = {}) => ({ text, conditions: [] as Condition[], entityIds: [], requesterPrincipal: { id: requesterPrincipal().id, groups: requesterPrincipal().groups }, k: 5, ...extra });

test('tokenize keeps identifiers and stems plurals', () => {
  assert.deepEqual(tokenize('Alarms on SW-17 cleared'), ['alarm', 'on', 'sw-17', 'sw', '17', 'cleared']);
});

test('bm25 ranks the lexically matching case first', () => {
  const idx = new Bm25Index([{ key: 'a', text: 'interface counters zero traffic absent' }, { key: 'b', text: 'power supply fan' }]);
  assert.equal(idx.search('counters zero')[0]?.key, 'a');
  assert.equal(idx.search('unrelated words').length, 0);
});

test('trigram vectors: 512 dims, unit norm, similar text scores higher', () => {
  const a = embedTrigrams('counters stay zero after interface stall');
  assert.equal(a.length, VECTOR_DIMS);
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-9);
  assert.ok(cosine(a, embedTrigrams('counters stayed zero after an interface stall')) > cosine(a, embedTrigrams('barrier key at the front desk')));
});

test('exact-identifier retriever boosts cases on the named asset', async () => {
  const store = buildSyntheticStore();
  const r = await new ExactIdRetriever(store).search(q('Something odd on Asset-D4 today'));
  assert.equal(r[0]?.caseId, 'case_power');
  assert.match(r[0]!.reasons[0]!, /same asset: Asset-D4/);
});

test('retrievers: bm25, vector and hybrid all return the reference case first for the symptom text; routes are labelled', async () => {
  const store = buildSyntheticStore();
  const text = `Asset-E5: ${SYMPTOM_TEXT}`;
  const bm = new Bm25Retriever(store);
  const vec = new TrigramVectorRetriever(store);
  const hy = new HybridRetriever(store);
  assert.equal(bm.route.route, 'rules');
  assert.equal(vec.route.route, 'local');
  assert.match(vec.route.version, /not learned|trigram/);
  for (const r of [bm, vec, hy]) assert.equal((await r.search(q(text)))[0]?.caseId, CASE_REF);
  assert.equal(new HybridRetriever(store, { vector: false }).route.route, 'rules');
});

test('hybrid applies access scope at retrieval', async () => {
  const store = buildSyntheticStore();
  const out = await new HybridRetriever(store).search(q(`Asset-A1 ${SYMPTOM_TEXT}`, { requesterPrincipal: { id: outsiderPrincipal().id, groups: outsiderPrincipal().groups } }));
  assert.ok(!out.some((c) => c.caseId === CASE_REF || c.caseId === 'case_restricted'));
  assert.ok(canSee({ visibility: 'org' }, { id: 'x', groups: [] }));
  assert.ok(!canSee({ visibility: 'group', groups: ['g'] }, { id: 'x', groups: ['h'] }));
  assert.ok(canSee({ visibility: 'private', principals: ['x'] }, { id: 'x', groups: [] }));
});

test('reciprocal rank fusion rewards agreement across lists', () => {
  const f = reciprocalRankFusion([
    { name: 'a', weight: 1, hits: [{ key: 'x', score: 3 }, { key: 'y', score: 2 }] },
    { name: 'b', weight: 1, hits: [{ key: 'y', score: 3 }, { key: 'z', score: 1 }] },
  ]);
  assert.equal(f[0]?.key, 'y');
  assert.deepEqual(f[0]?.sources, ['a', 'b']);
});

test('condition comparison: equal -> matching, different -> conflicting, absent -> missing + unchecked trait', () => {
  const caseC = [cond('unit.age', 'older'), cond('interface.status', 'up'), cond('optical.level', 'normal'), cond('site.id', 'S9'), cond('action.performed', 'interface.reset')];
  const prob = [cond('unit.age', 'newer'), cond('interface.status', 'up'), cond('action.performed', 'device.reboot')];
  const r = compareConditions(prob, caseC, { ignoredKeys: ['site.id'], historyKeys: ['action.performed'] });
  assert.deepEqual(r.matching.map((c) => c.key), ['interface.status']);
  assert.deepEqual(r.conflicting.map((c) => c.key), ['unit.age']);
  assert.match(r.conflicting[0]!.label!, /this problem: unit\.age=newer/);
  assert.deepEqual(r.missing.map((m) => m.key), ['optical.level']);
  assert.deepEqual(r.expectedTraits.map((t) => [t.condition.key, t.status]), [['optical.level', 'unchecked']]);
});

test('negative answers: neq conflicts with eq of the same value, stays unresolved otherwise', () => {
  const caseC = [cond('unit.age', 'older')];
  assert.equal(compareConditions([cond('unit.age', 'older', '', 'reported', [], 'neq')], caseC).conflicting.length, 1);
  assert.equal(compareConditions([cond('unit.age', 'newer', '', 'reported', [], 'neq')], caseC).missing.length, 1);
  assert.ok(E.a1);
});
