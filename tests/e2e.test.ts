import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import type { Principal, QuestionView } from '../src/libs/utils/contracts/index.ts';
import { DEV_FIXTURE, human, startService, type Running } from './support.ts';

let svc: Running;
const requester = human('person:test:requester', 'Rita Requester', ['noc']);
const TEXT = 'BGP sessions flapping on RTR-203 after the firmware update';
let investigationId = '';
let question: QuestionView | undefined;
let recipient: Principal;
let firstRecommendation = '';

before(async () => {
  svc = await startService();
});
after(async () => {
  await svc.close();
});

test('health lists every contract route', async () => {
  const h = await svc.call('GET', '/health');
  assert.equal(h.ok, true);
  assert.ok(h.routes.includes('POST /investigate') && h.routes.includes('GET /events'));
  assert.equal(h.routes.length, 32);
});

test('import dev-family-01, then GET /cases has the cases', async () => {
  const imp = await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
  assert.ok(imp.cases >= 2 && imp.claims > 0);
  const cases = await svc.call('GET', '/cases');
  assert.ok(cases.length >= 2);
  assert.ok(cases.some((c: { title: string }) => /RTR-117/.test(c.title)));
  const one = await svc.call('GET', `/cases/${encodeURIComponent(cases[0].caseId)}`);
  assert.equal(one.caseId, cases[0].caseId);
  await svc.call('GET', '/cases/nope', undefined, 404);
  const conns = await svc.call('GET', '/connections');
  assert.ok(conns.some((c: { id: string }) => c.id === 'import:teams:file'));
});

test('POST /investigate with lookalike text returns recommendation, people and routes', async () => {
  const r = await svc.call('POST', '/investigate', { text: TEXT, principal: requester });
  investigationId = r.investigationId;
  firstRecommendation = r.recommendation.kind;
  assert.match(investigationId, /^inv_/);
  assert.ok(r.recommendation.text.length > 0);
  assert.notEqual(r.recommendation.kind, 'reuse', 'a lookalike must not be offered as a plain reuse');
  assert.ok(r.people.length > 0);
  assert.ok(r.routes.length > 0 && r.routes.every((x: { route: string }) => ['rules', 'local', 'replay', 'claude-agent-arm'].includes(x.route)));
  assert.equal(r.state.id, investigationId);
  question = r.question;
  assert.ok(question, 'the lookalike has a consequential gap, so a question is opened');
  // Re-asking the same thing is idempotent: same investigation id, same open question.
  const again = await svc.call('POST', '/investigate', { text: TEXT, principal: requester });
  assert.equal(again.investigationId, investigationId);
  assert.equal(again.question?.questionId, question!.questionId);
});

test('the question is visible to its recipient; only the recipient can answer', async () => {
  const qid = question!.questionId;
  const stored = await svc.call('GET', `/questions/${encodeURIComponent(qid)}`);
  assert.equal(stored.investigationId, investigationId);
  const state = svc.engine.store.get('question', qid)!;
  const person = svc.engine.store.get('entity', state.personEntityId)!;
  recipient = human(person.id, person.name, []);
  const list = await svc.call('GET', `/questions?personEntityId=${encodeURIComponent(person.id)}`);
  assert.ok(list.some((x: QuestionView) => x.questionId === qid));
  const other = await svc.call('GET', '/questions?personEntityId=person:nobody');
  assert.deepEqual(other, []);
  await svc.call('POST', `/questions/${encodeURIComponent(qid)}/answer`, { principal: requester, value: 'yes' }, 403);
});

test('answer yes -> receipt -> undo -> answer no changes the recommendation (useful No)', async () => {
  const qid = encodeURIComponent(question!.questionId);
  const yes = await svc.call('POST', `/questions/${qid}/answer`, { principal: recipient, value: 'yes' });
  assert.equal(yes.question.status, 'answered');
  assert.equal(yes.receipt.canUndo, true);
  assert.match(yes.receipt.title, /Yes/);
  const afterYes = await svc.call('GET', `/investigations/${investigationId}`);
  const undo = await svc.call('POST', `/questions/${qid}/undo`, { principal: recipient });
  assert.notEqual(undo.question.status, 'answered');
  const no = await svc.call('POST', `/questions/${qid}/answer`, { principal: recipient, value: 'no' });
  assert.equal(no.answer.value, 'no');
  const afterNo = await svc.call('GET', `/investigations/${investigationId}`);
  assert.notEqual(afterNo.recommendation.kind, afterYes.recommendation.kind);
  assert.equal(afterNo.recommendation.kind, 'retain-uncertainty');
  assert.notEqual(afterNo.recommendation.kind, firstRecommendation);
  assert.equal(afterNo.investigationId, investigationId);
});

test('POST /observations resolves a requester-observable gap and /outcomes records', async () => {
  const obs = await svc.call('POST', '/observations', {
    principal: requester, investigationId,
    condition: { key: 'software.version', operator: 'eq', value: '4.2.1', origin: 'reported', evidence: [], label: 'Software 4.2.1' },
  });
  assert.equal(obs.investigation.investigationId, investigationId);
  const gaps = obs.investigation.state.gaps.filter((g: { id: string }) => g.id.includes('software.version'));
  assert.ok(gaps.every((g: { status: string }) => g.status !== 'open'));
  const body = { principal: requester, investigationId, attemptedAction: 'logs.check', result: 'partial', text: 'Logs show hold-timer expiry' };
  const rep = await svc.call('POST', '/outcomes', body);
  assert.equal(rep.investigationId, investigationId);
  assert.equal(rep.result, 'partial');
  const retry = await svc.call('POST', '/outcomes', body);
  assert.equal(retry.id, rep.id, 'a retried report is the same record');
  await svc.call('POST', '/outcomes', { ...body, principal: human('person:test:other', 'Other', ['noc']) }, 403);
  await svc.call('POST', '/outcomes', { ...body, investigationId: 'inv_missing' }, 404);
});

test('GET /investigations/:id and /people use consistent ids; contact draft is review-only', async () => {
  const inv = await svc.call('GET', `/investigations/${investigationId}?principalId=${encodeURIComponent(requester.id)}`);
  assert.equal(inv.investigationId, investigationId);
  assert.equal(inv.state.id, investigationId);
  assert.deepEqual(inv.state.questionIds.length > 0, true);
  const people = await svc.call('GET', `/people?investigationId=${investigationId}&principalId=${encodeURIComponent(requester.id)}`);
  assert.deepEqual(people.map((p: { personEntityId: string }) => p.personEntityId), inv.people.map((p: { personEntityId: string }) => p.personEntityId));
  assert.ok(people.length > 0);
  const draft = await svc.call('POST', '/contact-draft', { principal: requester, investigationId, personEntityId: people[0].personEntityId });
  assert.equal(draft.requiresReview, true);
  assert.equal(draft.investigationId, investigationId);
  assert.match(draft.body, /Checks already performed/);
  assert.match(draft.body, /Still unresolved/);
  assert.match(draft.body, new RegExp(TEXT.slice(0, 20)));
  await svc.call('POST', '/contact-draft', { principal: requester, investigationId, personEntityId: 'person:nobody' }, 403);
  const events = await svc.call('GET', `/events?traceId=${investigationId}`);
  const types = events.map((e: { type: string }) => e.type);
  for (const t of ['investigation.started', 'question.answered', 'observation.recorded', 'outcome.reported', 'contact-draft.created']) assert.ok(types.includes(t), `missing trace ${t}`);
});

test('settings: the points display switch is off by default and is not the opt-in (R46: tests/points.test.ts covers awards)', async () => {
  const s0 = await svc.call('GET', '/settings');
  assert.equal(s0.points, false);
  const on = await svc.call('PUT', '/settings', { points: true });
  assert.equal(on.points, true);
  await svc.call('PUT', '/settings', { nonsense: 1 }, 400);
  const r = await svc.call('POST', '/investigate', { text: 'BGP flaps after firmware upgrade on edge router RTR-300 unit', principal: human('person:test:req2', 'Rune Requester', ['noc']) });
  const q = r.question as QuestionView | undefined;
  assert.ok(q, 'second investigation opens a question');
  const stored = svc.engine.store.get('question', q.questionId)!;
  const person = svc.engine.store.get('entity', stored.personEntityId)!;
  const p = human(person.id, person.name);
  const a1 = await svc.call('POST', `/questions/${encodeURIComponent(q.questionId)}/answer`, { principal: p, value: 'no' });
  assert.equal(a1.receipt.pointsAwarded, undefined, 'the display switch alone awards nothing');
  const bal = await svc.call('GET', `/participation/${encodeURIComponent(person.id)}?principalId=${encodeURIComponent(person.id)}`);
  assert.deepEqual(bal, { personEntityId: person.id, participates: false, points: 0, events: [] });
  await svc.call('GET', `/participation/${encodeURIComponent(person.id)}?principalId=person:test:req2`, undefined, 403);
  await svc.call('POST', `/questions/${encodeURIComponent(q.questionId)}/answer`, { principal: p, value: 'yes' }, 409);
});

test('error shapes: 404 route, 400 body, 405 method', async () => {
  await svc.call('GET', '/nope', undefined, 404);
  const bad = await svc.call('POST', '/investigate', { text: '', principal: requester }, 400);
  assert.match(bad.error, /Invalid request/);
  await svc.call('DELETE', '/settings', undefined, 405);
  const res = await fetch(svc.http.url + '/investigate', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
  const rebind = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: svc.http.port, path: '/health', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(rebind, 403, 'a rebinding host name is refused');
});

test('demo reset clears and re-imports the demo families and the dev fixture; settings survive', async () => {
  const r = await svc.call('POST', '/demo/reset', { seed: 'synthetic' });
  assert.equal(r.ok, true);
  assert.ok(r.imported.length >= 3, 'two demo families plus the dev fixture');
  const cases = await svc.call('GET', '/cases');
  assert.ok(cases.length > 0);
  assert.equal((await svc.call('GET', '/settings')).points, true);
  // people.json of the demo families is applied: groups come from the directory and cannot be exceeded by a caller's claim.
  const eff = svc.engine.effective(human('person:directory:helmi-virtanen', 'Helmi Virtanen', ['noc', 'admin']));
  assert.deepEqual(eff.groups, ['noc']);
  const empty = await svc.call('POST', '/demo/reset', { seed: 'empty' });
  assert.deepEqual(empty.imported, []);
  assert.deepEqual(await svc.call('GET', '/cases'), []);
  const full = await svc.call('POST', '/demo/reset', {});
  assert.ok(full.imported.length >= 3);
});
