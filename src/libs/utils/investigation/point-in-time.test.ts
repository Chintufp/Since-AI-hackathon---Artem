import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Principal } from '../contracts/index.ts';
import { Engine } from '../../../apps/service/engine.ts';
import { basisCaseId } from './index.ts';

/** Elisa-shaped synthetic thread: clock times only, no date (like the organizer's example), on an asset of its own. */
const THREAD = {
  channel: 'teams-pit',
  participants: [{ name: 'Veikko Field', role: 'Field Engineer' }, { name: 'Erkki Expert', role: 'Network Expert' }],
  messages: [
    { seq: 1, time: '09:14', author: 'Veikko Field', text: "I'm at the site now. Changed the SFP on transmission node TRN-777.\nLink is up and alarms cleared, but traffic is still not coming back." },
    { seq: 2, time: '09:16', author: 'Erkki Expert', text: 'Is this one of the older units?' },
    { seq: 3, time: '09:16', author: 'Veikko Field', text: 'Yes, installed around 2018.' },
    { seq: 4, time: '09:18', author: 'Erkki Expert', text: "Sometimes after changing the SFP the interface comes up normally, but the forwarding state doesn't recover correctly." },
    { seq: 5, time: '09:19', author: 'Erkki Expert', text: 'Check whether the traffic counters are actually increasing.' },
    { seq: 6, time: '09:21', author: 'Veikko Field', text: 'Link UP. RX power looks normal. Counters zero.' },
    { seq: 7, time: '09:22', author: 'Erkki Expert', text: 'Disable the interface, wait a little, then enable it again.' },
    { seq: 8, time: '09:25', author: 'Veikko Field', text: 'Did that. Traffic is back.' },
  ],
};
const NOTE = {
  channel: 'teams-pit-note',
  participants: [{ name: 'Erkki Expert', role: 'Network Expert' }],
  messages: [{ seq: 1, time: '2026-10-14T10:05:00+03:00', author: 'Erkki Expert', text: 'TRN-777 follow-up: the 4.2 firmware fixes the forwarding-state bug. Units already on 4.2 should not see it; if they do, it is something else.' }],
};

const marja: Principal = { id: 'person:test:marja', displayName: 'Marja Niemi', groups: [], type: 'human' };
const ON_42 = 'TRN-901 older unit on firmware 4.2: replaced the SFP, link up, counters zero, no traffic.';
const NO_VERSION = 'TRN-902 older unit: replaced the SFP, link up, counters zero, no traffic.';

function engineAt(start: string): { e: Engine; set(iso: string): void } {
  let now = start;
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date(now) });
  e.importData({ format: 'teams-json', payload: THREAD });
  e.importData({ format: 'teams-json', payload: NOTE });
  return { e, set: (iso) => { now = iso; } };
}

test('the same problem at 1 Oct and at 20 Oct differs: before the note the advice holds, after it the caveat and the cap apply', async () => {
  const { e } = engineAt('2026-11-07T12:00:00.000Z');
  const before = await e.investigate({ text: ON_42, principal: marja, at: '2026-10-01T00:00:00Z' });
  const after = await e.investigate({ text: ON_42, principal: marja, at: '2026-10-20T00:00:00Z' });
  const now = await e.investigate({ text: ON_42, principal: marja, allowQuestions: false });
  assert.equal(before.recommendation.kind, 'check-first');
  assert.ok(!before.recommendation.caveats.some((c) => /Superseded/.test(c)));
  assert.equal(after.recommendation.kind, 'qualified');
  assert.equal(after.recommendation.caveats[0], 'Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2');
  assert.match(after.recommendation.nextStep ?? '', /ask Erkki Expert/);
  assert.deepEqual([now.recommendation.kind, now.recommendation.caveats[0]], [after.recommendation.kind, after.recommendation.caveats[0]], 'now = after the note');
  assert.notEqual(before.investigationId, after.investigationId, 'the moment is part of the investigation id');
  assert.notEqual(now.investigationId, after.investigationId);
  assert.equal(after.state.problem.at, '2026-10-20T00:00:00.000Z');
  assert.equal(after.question, undefined, 'a past view never asks anyone');
});

test('a problem that states no version keeps the advice; undated Elisa-shaped claims are visible at any moment', async () => {
  const { e } = engineAt('2026-11-07T12:00:00.000Z');
  for (const at of [undefined, '1990-01-01T00:00:00Z', '2026-10-20T00:00:00Z']) {
    const r = await e.investigate({ text: NO_VERSION, principal: marja, allowQuestions: false, ...(at ? { at } : {}) });
    assert.match(r.recommendation.text, /^Check the traffic counters/, `at ${at}`);
    assert.ok(!r.recommendation.caveats.some((c) => /Superseded/.test(c)), `at ${at}`);
    assert.ok(basisCaseId(r.state), `at ${at}: the undated case is the basis`);
  }
});

test('answers given after `at` are ignored; before the answer the gap is open, after it the answer counts', async () => {
  const { e, set } = engineAt('2026-11-07T12:00:00.000Z');
  const text = 'TRN-777 again: replaced the SFP, link up, counters zero, no traffic. Not sure which unit generation this is.';
  const first = await e.investigate({ text, principal: marja, allowQuestions: true });
  assert.equal(first.recommendation.kind, 'qualified');
  const q = first.question;
  assert.ok(q, 'a question was asked');
  set('2026-11-07T12:30:00.000Z');
  const rec = e.store.get('question', q.questionId)!;
  await e.answer(q.questionId, { principal: { id: rec.personEntityId, displayName: 'Recipient', groups: [], type: 'human' }, value: 'yes' });
  set('2026-11-07T13:00:00.000Z');
  const earlier = await e.contextAt(first.investigationId, '2026-11-07T12:15:00Z', marja.id);
  const later = await e.contextAt(first.investigationId, '2026-11-07T12:45:00Z', marja.id);
  assert.equal(earlier.recommendation.kind, 'qualified', 'the yes came at 12:30');
  assert.notEqual(later.recommendation.kind, 'qualified', 'after 12:30 the answer counts');
  assert.match(later.recommendation.text, /^Check the traffic counters/);
  assert.equal(earlier.question, undefined);
  assert.equal(e.store.list('question').length, 1, 'no new question was created by a past view');
});

test('an invalid `at` is a 400, never a guess', async () => {
  const { e } = engineAt('2026-11-07T12:00:00.000Z');
  await assert.rejects(e.investigate({ text: ON_42, principal: marja, at: 'last tuesday' }), /Invalid at/);
  await assert.rejects(e.investigate({ text: ON_42, principal: marja, at: '2026-10-20T10:00' }), /Invalid at/);
});
