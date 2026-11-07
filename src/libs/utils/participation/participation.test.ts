import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { awardPoints, balanceOf, getOptIn, POINT_TABLE, rating, revokeContribution, setOptIn } from './index.ts';

const base = { orgId: 'o', personEntityId: 'p1', summary: 's', at: '2026-11-07T10:00:00Z' };
const NOW = new Date('2026-11-07T12:00:00Z');

test('nothing is recorded for a person who does not take part', () => {
  const s = new InMemoryStore();
  const r = awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', participates: false });
  assert.equal(r.awarded, 0);
  assert.equal(balanceOf(s, 'p1').events.length, 0);
  assert.equal(balanceOf(s, 'p1').participates, false);
});

test('a retry with the same contribution id does not award twice', () => {
  const s = new InMemoryStore();
  setOptIn(s, { orgId: 'o', personEntityId: 'p1', participates: true, at: base.at });
  const first = awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', participates: true });
  const retry = awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', participates: true });
  assert.equal(first.awarded, POINT_TABLE['answer-yes']);
  assert.equal(retry.awarded, 0);
  assert.equal(retry.duplicate, true);
  assert.equal(balanceOf(s, 'p1').points, POINT_TABLE['answer-yes']);
});

test('a useful No earns the same as Yes; unknown, defer and dismiss are neutral', () => {
  assert.equal(POINT_TABLE['answer-no'], POINT_TABLE['answer-yes']);
  for (const k of ['answer-unknown', 'defer', 'dismiss'] as const) assert.equal(POINT_TABLE[k], 0);
});

test('revoking withdraws the points so a re-answer can earn again', () => {
  const s = new InMemoryStore();
  setOptIn(s, { orgId: 'o', personEntityId: 'p1', participates: true, at: base.at });
  awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', participates: true });
  assert.equal(revokeContribution(s, 'a1'), true);
  assert.equal(balanceOf(s, 'p1').points, 0);
  assert.equal(awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-no', participates: true }).awarded, 2);
});

test('opting out keeps the rows but serves nothing; opting back in shows them again; since tracks the change', () => {
  const s = new InMemoryStore();
  setOptIn(s, { orgId: 'o', personEntityId: 'p1', participates: true, at: '2026-11-01T00:00:00Z' });
  awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', participates: true });
  setOptIn(s, { orgId: 'o', personEntityId: 'p1', participates: false, at: '2026-11-02T00:00:00Z' });
  assert.deepEqual(balanceOf(s, 'p1'), { personEntityId: 'p1', participates: false, points: 0, events: [] });
  assert.equal(s.list('participation').length, 1, 'the row is kept');
  assert.equal(getOptIn(s, 'p1')?.since, '2026-11-02T00:00:00Z');
  setOptIn(s, { orgId: 'o', personEntityId: 'p1', participates: true, at: '2026-11-03T00:00:00Z' });
  assert.equal(balanceOf(s, 'p1').points, 2);
  setOptIn(s, { orgId: 'o', personEntityId: 'p1', participates: true, at: '2026-11-04T00:00:00Z' });
  assert.equal(getOptIn(s, 'p1')?.since, '2026-11-03T00:00:00Z', 'an unchanged choice keeps its date');
});

test('rating: only people who take part, sorted by balance with shared ranks, recent = last 7 days', () => {
  const s = new InMemoryStore();
  for (const p of ['a', 'b', 'c']) setOptIn(s, { orgId: 'o', personEntityId: p, participates: true, at: base.at });
  const award = (p: string, id: string, kind: 'answer-yes' | 'outcome-report' | 'answer-unknown', at = base.at) => awardPoints(s, { ...base, personEntityId: p, contributionEventId: id, kind, at, participates: true });
  award('a', 'a1', 'answer-yes');
  award('a', 'a2', 'answer-yes', '2026-10-01T00:00:00Z');
  award('b', 'b1', 'outcome-report');
  award('b', 'b2', 'answer-unknown');
  award('c', 'c1', 'answer-yes');
  award('d', 'd1', 'answer-yes'); // d never opted in: awardPoints is told so by the caller
  awardPoints(s, { ...base, personEntityId: 'd', contributionEventId: 'd2', kind: 'answer-yes', participates: false });
  const r = rating(s, { displayName: (id) => ({ a: 'Anna', b: 'Bo', c: 'Cy' })[id], personEntityId: 'c', now: NOW });
  assert.deepEqual(r.participants.map((p) => [p.personEntityId, p.balance, p.recent, p.rank, p.answered, p.outcomes]), [
    ['a', 4, 2, 1, 2, 0], ['b', 3, 3, 2, 1, 1], ['c', 2, 2, 3, 1, 0],
  ]);
  assert.ok(!JSON.stringify(r).includes('"d"'), 'a person who does not take part appears nowhere');
  assert.deepEqual(r.totals, { participants: 3, points: 9, recent: 7 });
  assert.equal(r.me?.rank, 3);
  assert.equal(r.me?.events.length, 1);
  assert.equal(rating(s, { displayName: () => undefined, personEntityId: 'd', now: NOW }).me, null);
  assert.equal(rating(s, { displayName: () => undefined, now: NOW }).participants[0]!.displayName, 'a', 'unknown names fall back to the id');
});
