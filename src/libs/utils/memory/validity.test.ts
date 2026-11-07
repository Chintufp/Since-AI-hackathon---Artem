import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Claim } from '../contracts/index.ts';
import { instantOf, isNewer, parseAt, shortDate, timePosition, validAt } from './validity.ts';

const at = (iso: string) => Date.parse(iso);
const claim = (validity: Claim['validity'], status: Claim['status'] = 'provisional', createdAt = '2026-11-07T00:00:00.000Z', id = 'c'): Claim => ({
  id, orgId: 'o', type: 'access-fact', statement: 's', subjectEntityIds: [], origin: 'reported', supporting: [], contradicting: [], validity, status,
  extraction: { route: 'rules', version: 'x' }, revision: 1, createdAt, updatedAt: createdAt, accessScope: { visibility: 'org' },
});

test('instantOf: only fully known times have an instant', () => {
  assert.equal(instantOf({ known: true, iso: '2026-10-14T07:05:00.000Z' }), at('2026-10-14T07:05:00Z'));
  assert.equal(instantOf({ known: false, partial: 'time-only', raw: '09:22' }), undefined);
  assert.equal(instantOf({ known: false, partial: 'date-only', raw: '2026-10-14' }), undefined);
  assert.equal(instantOf(undefined), undefined);
});

test('validAt: unknown from is valid before any dated moment; unknown to is still believed true; superseded closes', () => {
  assert.equal(validAt(claim({ from: { known: false, partial: 'time-only', raw: '09:22' } }), at('1990-01-01T00:00:00Z')), true);
  const dated = claim({ from: { known: true, iso: '2026-08-20T06:12:00.000Z' } });
  assert.equal(validAt(dated, at('2026-08-01T00:00:00Z')), false);
  assert.equal(validAt(dated, at('2026-09-01T00:00:00Z')), true);
  const closed = claim({ from: { known: true, iso: '2026-08-20T06:12:00.000Z' }, to: { known: true, iso: '2026-10-06T05:40:00.000Z' } }, 'superseded');
  assert.equal(validAt(closed, at('2026-09-01T00:00:00Z')), true, 'a superseded claim is valid inside its window');
  assert.equal(validAt(closed, at('2026-10-06T05:40:00Z')), false, 'to is exclusive');
  assert.equal(validAt(claim({}, 'superseded'), at('2026-09-01T00:00:00Z')), false, 'superseded with an unknown end is closed');
});

test('isNewer: known times first, otherwise import order with the basis labelled', () => {
  const a = claim({ from: { known: true, iso: '2026-10-06T05:40:00.000Z' } }, 'provisional', '2026-11-07T00:00:00.000Z', 'a');
  const b = claim({ from: { known: true, iso: '2026-08-20T06:12:00.000Z' } }, 'provisional', '2026-11-08T00:00:00.000Z', 'b');
  assert.deepEqual(isNewer(a, b), { newer: true, basis: 'known-time' });
  assert.deepEqual(isNewer(b, a), { newer: false, basis: 'known-time' });
  const u = claim({ from: { known: false, raw: '09:22', partial: 'time-only' } }, 'provisional', '2026-11-07T00:00:00.000Z', 'u');
  assert.deepEqual(isNewer(a, u, (id) => (id === 'a' ? 5 : 1)), { newer: true, basis: 'import-order' });
  assert.deepEqual(isNewer(u, a, (id) => (id === 'a' ? 5 : 1)), { newer: false, basis: 'import-order' });
});

test('timePosition never synthesises an iso; shortDate only for known times; parseAt needs a zone', () => {
  assert.deepEqual(timePosition({ known: false, partial: 'time-only', raw: '09:22', sequence: 8 }), { kind: 'time-only', raw: '09:22', sequence: 8 });
  assert.deepEqual(timePosition(undefined), { kind: 'unknown' });
  assert.equal(timePosition({ known: true, iso: '2026-10-14T07:05:00.000Z' }).iso, '2026-10-14T07:05:00.000Z');
  assert.equal(shortDate({ known: true, iso: '2026-10-14T07:05:00.000Z' }), '14 Oct');
  assert.equal(shortDate({ known: false, raw: '09:22' }), undefined);
  assert.equal(parseAt('2026-10-01T00:00:00Z'), at('2026-10-01T00:00:00Z'));
  assert.equal(parseAt('2026-10-01'), at('2026-10-01T00:00:00Z'));
  assert.equal(parseAt('2026-10-01T10:00'), undefined);
  assert.equal(parseAt('yesterday'), undefined);
});
