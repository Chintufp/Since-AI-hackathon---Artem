import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { awardPoints, balanceOf, POINT_TABLE, revokeContribution } from './index.ts';

const base = { orgId: 'o', personEntityId: 'p1', summary: 's', at: '2026-11-07T10:00:00Z' };

test('nothing is recorded while points are off', () => {
  const s = new InMemoryStore();
  const r = awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', enabled: false });
  assert.equal(r.awarded, 0);
  assert.equal(balanceOf(s, 'p1', false).events.length, 0);
});

test('a retry with the same contribution id does not award twice', () => {
  const s = new InMemoryStore();
  const first = awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', enabled: true });
  const retry = awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', enabled: true });
  assert.equal(first.awarded, POINT_TABLE['answer-yes']);
  assert.equal(retry.awarded, 0);
  assert.equal(retry.duplicate, true);
  assert.equal(balanceOf(s, 'p1', true).points, POINT_TABLE['answer-yes']);
});

test('a useful No earns the same as Yes; unknown, defer and dismiss are neutral', () => {
  assert.equal(POINT_TABLE['answer-no'], POINT_TABLE['answer-yes']);
  for (const k of ['answer-unknown', 'defer', 'dismiss'] as const) assert.equal(POINT_TABLE[k], 0);
});

test('revoking withdraws the points so a re-answer can earn again', () => {
  const s = new InMemoryStore();
  awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-yes', enabled: true });
  assert.equal(revokeContribution(s, 'a1'), true);
  assert.equal(balanceOf(s, 'p1', true).points, 0);
  assert.equal(awardPoints(s, { ...base, contributionEventId: 'a1', kind: 'answer-no', enabled: true }).awarded, 2);
});
