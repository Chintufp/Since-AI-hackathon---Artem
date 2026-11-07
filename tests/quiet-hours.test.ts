/**
 * B1: quiet hours end to end over HTTP on the movable demo clock: a question raised at 03:00 Helsinki time is queued and
 * hidden from the recipient's inbox (the panel polls GET /questions), and appears when the clock reaches 07:30.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultObservabilityPolicy, defaultQuietHours } from '../src/apps/service/org-config.ts';
import { DEV_FIXTURE, human, startService, type Running } from './support.ts';

let svc: Running;
const requester = human('person:test:requester', 'Rita Requester', ['noc']);
const TEXT = 'BGP sessions flapping on RTR-203 after the firmware update';

before(async () => {
  svc = await startService({ clock: undefined, coordinator: { quietHours: defaultQuietHours }, investigation: { observability: defaultObservabilityPolicy } });
  await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
});
after(async () => {
  await svc.close();
});

test('03:00 -> queued for 07:00 and not in the inbox; the clock moved to 07:30 -> delivered in the panel poll', async () => {
  await svc.call('POST', '/demo/clock', { now: '2026-11-07T01:00:00.000Z' });
  const r = await svc.call('POST', '/investigate', { text: TEXT, principal: requester });
  assert.ok(r.question, 'the investigation opens a question');
  assert.equal(r.question.status, 'queued');
  assert.equal(r.question.deliverAfter, '2026-11-07T05:00:00.000Z');
  assert.equal(r.loopReason, 'Queued until 07:00: nobody is woken at night');
  const recipient = r.question.personEntityId as string;
  const inbox = (await svc.call('GET', `/questions?personEntityId=${encodeURIComponent(recipient)}`)) as Array<{ questionId: string }>;
  assert.ok(!inbox.some((x) => x.questionId === r.question.questionId), 'held question is not in the inbox at 03:00');

  await svc.call('POST', '/demo/clock', { now: '2026-11-07T05:30:00.000Z' });
  const later = (await svc.call('GET', `/questions?personEntityId=${encodeURIComponent(recipient)}`)) as Array<{ questionId: string; status: string; deliverAfter?: string }>;
  const mine = later.find((x) => x.questionId === r.question.questionId);
  assert.equal(mine?.status, 'delivered');
  assert.equal(mine?.deliverAfter, undefined);
  const stored = svc.engine.store.get('question', r.question.questionId)!;
  assert.ok(stored.deliveredAt && stored.deliveredAt >= '2026-11-07T05:30:00.000Z' && stored.deliveredAt < '2026-11-07T05:31:00.000Z');
  const inv = await svc.call('GET', `/investigations/${r.investigationId}`);
  assert.notEqual(inv.loopReason, 'Queued until 07:00: nobody is woken at night');
  await svc.call('POST', '/demo/clock', {});
});
