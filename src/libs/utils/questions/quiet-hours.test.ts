import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultCoordinatorSettings, type QuietHours } from '../contracts/index.ts';
import { buildSyntheticStore, P, SYMPTOM_TEXT } from '../models/testing/fixtures.ts';
import { computeBudget } from '../investigation/index.ts';
import { inQuiet, nextWindow } from './quiet-hours.ts';
import { makeHarness } from './testing/harness.ts';

/** B1: quiet hours 22:00-07:00 Helsinki time (the org-config default, passed explicitly here). */
const QH: QuietHours = { start: '22:00', end: '07:00', timeZone: 'Europe/Helsinki' };
const B2 = `Asset-B2: ${SYMPTOM_TEXT}`;

test('inQuiet / nextWindow follow Helsinki local time, across midnight and across the March clock change', () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(inQuiet(at('2026-11-07T01:00:00Z'), QH), true); // 03:00 EET
  assert.equal(nextWindow(at('2026-11-07T01:00:00Z'), QH).toISOString(), '2026-11-07T05:00:00.000Z');
  assert.equal(inQuiet(at('2026-11-07T10:00:00Z'), QH), false); // 12:00 EET
  assert.equal(nextWindow(at('2026-11-07T10:00:00Z'), QH).toISOString(), '2026-11-07T10:00:00.000Z');
  assert.equal(inQuiet(at('2026-11-07T20:30:00Z'), QH), true); // 22:30 EET, before midnight: tomorrow 07:00
  assert.equal(nextWindow(at('2026-11-07T20:30:00Z'), QH).toISOString(), '2026-11-08T05:00:00.000Z');
  assert.equal(inQuiet(at('2026-11-07T19:59:00Z'), QH), false); // 21:59 EET
  assert.equal(inQuiet(at('2026-11-07T05:00:00Z'), QH), false); // 07:00 EET is the window
  // 29 March 2026: 03:00 EET becomes 04:00 EEST, so 07:00 local is 04:00Z.
  assert.equal(nextWindow(at('2026-03-28T23:00:00Z'), QH).toISOString(), '2026-03-29T04:00:00.000Z');
  assert.equal(inQuiet(at('2026-11-07T01:00:00Z'), { ...QH, start: '07:00', end: '07:00' }), false);
});

test('a question created at 03:00 EET stays queued until 07:00; deliverDue delivers it at 07:30 and budgets count from delivery', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { coordinator: { ...defaultCoordinatorSettings, quietHours: QH } } });
  h.time.iso = '2026-11-07T01:00:00.000Z';
  const st = await h.start('pq', B2);
  const r = await h.coordinator.request(st);
  const q = r.question!;
  assert.equal(q.status, 'queued');
  assert.equal(q.deliverAfter, '2026-11-07T05:00:00.000Z');
  assert.equal(q.deliveredAt, undefined);
  assert.equal(r.state.loop, 'question-open');
  assert.equal(r.state.loopReason, 'Queued until 07:00: nobody is woken at night');
  assert.ok(r.state.events.some((e) => e.type === 'question.held' && e.data?.deliverAfter === '2026-11-07T05:00:00.000Z'));
  // Nothing due yet; a second request for the same investigation returns the held question, still queued.
  assert.deepEqual(h.coordinator.deliverDue(), []);
  assert.equal((await h.coordinator.request(st)).question?.status, 'queued');
  assert.equal(computeBudget(h.store, P.site.entity, h.settings, h.clock()).askedToday, 0);

  h.time.iso = '2026-11-07T05:30:00.000Z';
  const done = h.coordinator.deliverDue();
  assert.deepEqual(done.map((x) => [x.id, x.status, x.deliveredAt]), [[q.id, 'delivered', '2026-11-07T05:30:00.000Z']]);
  const b = computeBudget(h.store, P.site.entity, h.settings, h.clock());
  assert.equal(b.askedToday, 1);
  assert.equal(b.lastAskedAt, '2026-11-07T05:30:00.000Z', 'cooldown counts from the window, not from 03:00');
  const inv = h.store.get('investigation', st.id)!;
  assert.match(inv.loopReason ?? '', /Asked|Waiting/);
  assert.ok(inv.events.some((e) => e.type === 'question.delivered'));
});

test('a question created at 12:00 EET is delivered at once (no deliverAfter)', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { coordinator: { ...defaultCoordinatorSettings, quietHours: QH } } });
  h.time.iso = '2026-11-07T10:00:00.000Z';
  const r = await h.coordinator.request(await h.start('pd', B2));
  assert.equal(r.question?.status, 'delivered');
  assert.equal(r.question?.deliverAfter, undefined);
  assert.equal(r.question?.deliveredAt, '2026-11-07T10:00:00.000Z');
});

test('without quietHours (the library default) a question at 03:00 is delivered as before', async () => {
  assert.equal(defaultCoordinatorSettings.quietHours, undefined);
  const h = makeHarness(buildSyntheticStore());
  h.time.iso = '2026-11-07T01:00:00.000Z';
  const r = await h.coordinator.request(await h.start('pn', B2));
  assert.equal(r.question?.status, 'delivered');
});

test('a held question whose gap is resolved before the window is cancelled at delivery, not delivered', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { coordinator: { ...defaultCoordinatorSettings, quietHours: QH } } });
  h.time.iso = '2026-11-07T01:00:00.000Z';
  const st = await h.start('pr', B2);
  const r = await h.coordinator.request(st);
  const gap = r.state.gaps.find((g) => g.id === r.question!.candidate.gapId)!;
  h.store.put('investigation', { ...h.store.get('investigation', st.id)!, gaps: r.state.gaps.map((g) => (g.id === gap.id ? { ...g, status: 'resolved' as const } : g)) });
  h.time.iso = '2026-11-07T05:01:00.000Z';
  const [x] = h.coordinator.deliverDue();
  assert.equal(x?.status, 'cancelled');
  assert.equal(x?.cancelReason, 'gap-resolved');
});

test('a held question whose window passed unpolled is not delivered inside the next night: 03:00 to 03:00 holds it again', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { coordinator: { ...defaultCoordinatorSettings, quietHours: QH } } });
  h.time.iso = '2026-11-08T01:00:00.000Z'; // 03:00 EET
  const q = (await h.coordinator.request(await h.start('pnn', B2))).question!;
  assert.equal(q.deliverAfter, '2026-11-08T05:00:00.000Z');
  h.time.iso = '2026-11-09T01:00:00.000Z'; // 03:00 EET the next night, nobody polled in between
  assert.deepEqual(h.coordinator.deliverDue(), []);
  const held = h.coordinator.deliverNow(q.id);
  assert.equal(held.status, 'queued');
  assert.equal(held.deliverAfter, '2026-11-09T05:00:00.000Z');
  assert.equal(held.deliveredAt, undefined);
  h.time.iso = '2026-11-09T05:10:00.000Z';
  assert.deepEqual(h.coordinator.deliverDue().map((x) => [x.id, x.status]), [[q.id, 'delivered']]);
});
