import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../../../apps/service/engine.ts';

/** B1 review: GET /context never reveals a superseding claim the principal may not see (status, close time). */
test('an older code closed by a hidden newer code is shown as it was before: no superseded status, no close time', () => {
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T10:00:00Z') });
  e.importData({ format: 'teams-json', payload: { channel: 'site-access', messages: [{ seq: 1, time: '2026-08-20T09:00:00+03:00', author: 'Eino Salo', text: 'Road barrier code at RBS-310: 5802.' }] } });
  e.importData({ format: 'teams-json', payload: { channel: 'secret-access', messages: [{ seq: 1, time: '2026-10-06T08:40:00+03:00', author: 'Eino Salo', text: 'Barrier code at RBS-310 is now 7731, the landlord changed the lock.' }] }, accessGroups: ['access'] } as any);
  const old = e.store.list('claim').find((c) => c.condition?.value === '5802')!;
  assert.equal(old.status, 'superseded', 'stored superseded');
  const outside = e.contextAssertions('RBS-310', undefined, 'nobody-outside');
  const row = outside.assertions.find((a) => a.claimId === old.id)!;
  assert.equal(row.status, 'provisional');
  assert.equal(row.validTo, undefined);
  assert.equal(row.supersededBy, undefined);
  assert.equal(row.orderBasis, undefined);
  assert.equal(row.validAt, true);
  assert.ok(!JSON.stringify(outside).includes('2026-10-06'), 'the hidden message time appears nowhere');
  assert.ok(!outside.assertions.some((a) => a.statement.includes('7731')));
});
