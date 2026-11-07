/**
 * R46: the end-to-end points system over HTTP. Opt-in gating (per person, default off), awards per contribution kind,
 * revoke on undo, neutral summaries, the rating's order and privacy, and the 403s on another person's data.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { QuestionView } from '../src/libs/utils/contracts/index.ts';
import { POINT_TABLE } from '../src/libs/utils/participation/index.ts';
import { DEV_FIXTURE, human, SCENARIOS, startService, type Running } from './support.ts';

let svc: Running;
const requester = human('person:test:req', 'Rune Requester', ['noc']);
const scenario = join(SCENARIOS, 'optic-forwarding-a');

before(async () => {
  svc = await startService();
  await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
});
after(async () => svc.close());

const bal = (id: string, principalId = id, expect = 200) => svc.call('GET', `/participation/${encodeURIComponent(id)}?principalId=${encodeURIComponent(principalId)}`, undefined, expect);

/** Open a question through an investigation and return it with the recipient's principal. */
async function openQuestion(text: string) {
  const r = await svc.call('POST', '/investigate', { text, principal: requester });
  const q = r.question as QuestionView | undefined;
  assert.ok(q, `a question opens for "${text}"`);
  const stored = svc.engine.store.get('question', q.questionId)!;
  const person = svc.engine.store.get('entity', stored.personEntityId)!;
  return { q, person, p: human(person.id, person.name), investigationId: r.investigationId as string };
}

test('routes: 42 (32 + GET /context + the seven B2 model routes + B3 GET /context.html and GET /costs), including the three points routes', async () => {
  const h = await svc.call('GET', '/health');
  assert.equal(h.routes.length, 42);
  for (const r of ['GET /participation/rating', 'GET /participation/:personEntityId/optin', 'PUT /participation/:personEntityId/optin']) assert.ok(h.routes.includes(r), r);
});

test('opt-in is per person and off by default; only the person can change it', async () => {
  const { person, p } = await openQuestion('BGP flaps after firmware upgrade on edge router RTR-300 unit');
  const o0 = await svc.call('GET', `/participation/${encodeURIComponent(person.id)}/optin`);
  assert.equal(o0.participates, false);
  await svc.call('PUT', `/participation/${encodeURIComponent(person.id)}/optin`, { principal: requester, participates: true }, 403);
  await svc.call('PUT', `/participation/${encodeURIComponent(person.id)}/optin`, { principal: p, nonsense: true }, 400);
  const on = await svc.call('PUT', `/participation/${encodeURIComponent(person.id)}/optin`, { principal: p, participates: true });
  assert.equal(on.participates, true);
  assert.ok(on.since);
  assert.equal((await svc.call('GET', `/participation/${encodeURIComponent(person.id)}/optin`)).participates, true);
  // the device display switch is not the opt-in
  assert.equal((await svc.call('GET', '/settings')).points, false);
});

test('no points for a person who does not take part, even with the display switch on; points once they do; undo revokes', async () => {
  await svc.call('PUT', '/settings', { points: true });
  const a = await openQuestion('BGP flaps after firmware upgrade on edge router RTR-301 unit');
  assert.equal((await svc.call('GET', `/participation/${encodeURIComponent(a.person.id)}/optin`)).participates, false, 'a fresh recipient');
  const r0 = await svc.call('POST', `/questions/${encodeURIComponent(a.q.questionId)}/answer`, { principal: a.p, value: 'yes' });
  assert.equal(r0.receipt.pointsAwarded, undefined, 'not taking part: no points');
  const b0 = await bal(a.person.id);
  assert.deepEqual(b0, { personEntityId: a.person.id, participates: false, points: 0, events: [] });
  assert.equal(svc.engine.store.list('participation', { where: { personEntityId: a.person.id } }).length, 0, 'nothing recorded either');

  await svc.call('PUT', `/participation/${encodeURIComponent(a.person.id)}/optin`, { principal: a.p, participates: true });
  await svc.call('POST', `/questions/${encodeURIComponent(a.q.questionId)}/undo`, { principal: a.p });
  const r1 = await svc.call('POST', `/questions/${encodeURIComponent(a.q.questionId)}/answer`, { principal: a.p, value: 'no' });
  assert.equal(r1.receipt.pointsAwarded, POINT_TABLE['answer-no']);
  const b1 = await bal(a.person.id);
  assert.equal(b1.points, 2);
  assert.equal(b1.events.length, 1);
  assert.equal(b1.events[0].summary, 'Answered a question (no)');
  assert.equal(b1.events[0].refId, a.q.questionId);
  assert.ok(!b1.events[0].summary.includes(a.q.text.slice(0, 12)), 'the summary never copies the question');
  // a retry of the same answer is idempotent
  const r2 = await svc.call('POST', `/questions/${encodeURIComponent(a.q.questionId)}/answer`, { principal: a.p, value: 'no' });
  assert.equal(r2.receipt.pointsAwarded, undefined);
  assert.equal((await bal(a.person.id)).points, 2);
  // undo revokes; not sure is neutral
  await svc.call('POST', `/questions/${encodeURIComponent(a.q.questionId)}/undo`, { principal: a.p });
  assert.equal((await bal(a.person.id)).points, 0);
  const r3 = await svc.call('POST', `/questions/${encodeURIComponent(a.q.questionId)}/answer`, { principal: a.p, value: 'unknown' });
  assert.equal(r3.receipt.pointsAwarded, undefined);
  const b3 = await bal(a.person.id);
  assert.equal(b3.points, 0);
  assert.equal(b3.events.length, 1, 'the neutral answer is recorded with 0 points');
  assert.equal(b3.events[0].summary, 'Answered a question (not sure)');
});

test('outcome reports and observations earn for a requester who takes part; summaries stay neutral', async () => {
  const dirPerson = svc.engine.directory()[0]!;
  const me = human(dirPerson.personEntityId, dirPerson.name, dirPerson.groups);
  await svc.call('PUT', `/participation/${encodeURIComponent(me.id)}/optin`, { principal: me, participates: true });
  const r = await svc.call('POST', '/investigate', { text: 'TRN-777 link up after SFP swap but no traffic, counters zero, older unit from 2017', principal: me, allowQuestions: false });
  const investigationId = r.investigationId as string;
  const rep = await svc.call('POST', '/outcomes', { principal: me, investigationId, result: 'recovered', attemptedAction: 'interface.reset', text: 'SECRET-NOTE traffic came back' });
  assert.ok(rep.id);
  await svc.call('POST', '/outcomes', { principal: me, investigationId, result: 'recovered', attemptedAction: 'interface.reset', text: 'SECRET-NOTE traffic came back' });
  await svc.call('POST', '/observations', { principal: me, investigationId, condition: { key: 'software.version', operator: 'eq', value: '4.2.1', label: 'Software 4.2.1 SECRET-LABEL' } });
  await svc.call('POST', '/observations', { principal: me, investigationId, condition: { key: 'software.version', operator: 'eq', value: '4.2.1', label: 'Software 4.2.1 SECRET-LABEL' } });
  const b = await bal(me.id);
  const kinds = b.events.map((e: { kind: string; points: number }) => `${e.kind}:${e.points}`);
  assert.ok(kinds.includes('outcome-report:3'), kinds.join());
  assert.ok(kinds.includes('correction:3'), kinds.join());
  assert.equal(kinds.filter((k: string) => k === 'outcome-report:3').length, 1, 'an identical report awards once');
  assert.equal(kinds.filter((k: string) => k === 'correction:3').length, 1, 'the same observation awards once');
  const text = JSON.stringify(b);
  assert.ok(!text.includes('SECRET'), 'no report or observation text in the balance');
  assert.ok(b.events.every((e: { refId?: string }) => e.refId === investigationId));
});

test('evidence a person authored that became a claim earns once, at import, only when they take part then', async () => {
  const people = JSON.parse(readFileSync(join(scenario, 'people.json'), 'utf8'));
  // the directory first (an import with no evidence), so the author can opt in before their evidence arrives
  await svc.call('POST', '/import', { format: 'teams-json', payload: { messages: [] }, directory: people });
  const byName = (name: string) => (svc.engine.directory().find((d) => d.name === name) ?? assert.fail(`${name} in the directory`));
  const aarne = human(byName('Aarne Koskela').personEntityId, 'Aarne Koskela', ['field']);
  const helmiId = byName('Helmi Virtanen').personEntityId;
  await svc.call('PUT', `/participation/${encodeURIComponent(aarne.id)}/optin`, { principal: aarne, participates: true });
  const imp = await svc.call('POST', '/import', { format: 'scenario-dir', path: scenario });
  assert.ok(Array.isArray(imp.points) && imp.points.length > 0, 'the import names who earned');
  const mine = imp.points.find((p: { personEntityId: string }) => p.personEntityId === aarne.id);
  assert.ok(mine && mine.points > 0, `Aarne authored Teams messages that became claims: ${JSON.stringify(imp.points)}`);
  assert.ok(!imp.points.some((p: { personEntityId: string }) => p.personEntityId === helmiId), 'Helmi did not opt in: nothing for her');
  const b = await bal(aarne.id);
  assert.equal(b.points, mine.points);
  assert.ok(b.events.every((e: { kind: string; summary: string; refId?: string }) => e.kind === 'evidence' && e.summary === 'Shared evidence that became knowledge' && e.refId?.startsWith('ev')));
  // the same import again: nothing new (same evidence ids)
  const again = await svc.call('POST', '/import', { format: 'scenario-dir', path: scenario });
  assert.equal(again.points, undefined);
  assert.equal((await bal(aarne.id)).points, mine.points);
});

test('privacy: another person\'s balance is 403; the rating lists only people who take part; me only for the caller', async () => {
  const byName = (name: string) => (svc.engine.directory().find((d) => d.name === name) ?? assert.fail(`${name} in the directory`)).personEntityId;
  const aarne = byName('Aarne Koskela');
  const helmi = byName('Helmi Virtanen');
  await bal(aarne, helmi, 403);
  await bal(helmi, aarne, 403);
  // no principal: the settings' current person (none set here) is anonymous
  await svc.call('PUT', '/settings', { currentPersonEntityId: '' });
  await svc.call('GET', `/participation/${encodeURIComponent(aarne)}`, undefined, 403);
  await svc.call('PUT', '/settings', { currentPersonEntityId: aarne });
  assert.equal((await svc.call('GET', `/participation/${encodeURIComponent(aarne)}`)).participates, true);

  const r = await svc.call('GET', `/participation/rating?personEntityId=${encodeURIComponent(aarne)}&principalId=${encodeURIComponent(aarne)}`);
  assert.ok(r.participants.length >= 2);
  const ranks = r.participants.map((p: { rank: number }) => p.rank);
  const balances = r.participants.map((p: { balance: number }) => p.balance);
  assert.deepEqual(balances, [...balances].sort((a, b) => b - a), 'sorted by balance');
  assert.equal(ranks[0], 1);
  assert.ok(!JSON.stringify(r).includes(helmi), 'a person who never opted in appears nowhere');
  assert.equal(r.me.personEntityId, aarne);
  assert.ok(r.me.events.length <= 10 && r.me.events.length > 0);
  assert.equal(r.totals.participants, r.participants.length);
  assert.equal(r.period.recentDays, 7);
  await svc.call('GET', `/participation/rating?personEntityId=${encodeURIComponent(aarne)}&principalId=${encodeURIComponent(helmi)}`, undefined, 403);
  const anon = await svc.call('GET', '/participation/rating');
  assert.equal(anon.me, null);
  assert.ok(!JSON.stringify(anon).includes('"events"'), 'no events without a person');

  // opting out hides the person from the rating and the balance, keeps the rows
  const rows = svc.engine.store.list('participation', { where: { personEntityId: aarne } }).length;
  await svc.call('PUT', `/participation/${encodeURIComponent(aarne)}/optin`, { principal: human(aarne, 'Aarne Koskela'), participates: false });
  assert.ok(!JSON.stringify(await svc.call('GET', '/participation/rating')).includes(aarne));
  assert.deepEqual(await bal(aarne), { personEntityId: aarne, participates: false, points: 0, events: [] });
  assert.equal(svc.engine.store.list('participation', { where: { personEntityId: aarne } }).length, rows);
  await svc.call('PUT', `/participation/${encodeURIComponent(aarne)}/optin`, { principal: human(aarne, 'Aarne Koskela'), participates: true });
  assert.equal((await bal(aarne)).events.length, rows);
});
