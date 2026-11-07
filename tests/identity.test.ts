import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { DirectoryEntry, QuestionView } from '../src/libs/utils/contracts/index.ts';
import { pickDefaultPerson } from '../src/apps/service/demo.ts';
import { human, startService, type Running } from './support.ts';

let svc: Running;
let directory: DirectoryEntry[] = [];
const GUEST = { id: 'person:desktop:guest', displayName: 'Guest', groups: [] as string[], type: 'human' as const };
const TEXT = 'BGP sessions flapping on RTR-203 after the firmware update';

before(async () => {
  svc = await startService();
});
after(async () => {
  await svc.close();
});

const dir = (name: string, role: string | undefined, available = true): DirectoryEntry => ({ personEntityId: 'p:' + name, name, ...(role ? { role } : {}), groups: [], available });

test('pickDefaultPerson: named person, else first available field role, else first entry', () => {
  const d = [dir('Ada', 'Planner'), dir('Bo', 'Field Engineer', false), dir('Cy', 'Senior FIELD tech'), dir('Di', 'Field Engineer')];
  assert.equal(pickDefaultPerson(d, 'Di')?.name, 'Di');
  assert.equal(pickDefaultPerson(d, 'p:ada')?.name, 'Ada', 'ids match case-insensitively');
  assert.equal(pickDefaultPerson(d)?.name, 'Cy', 'unavailable field people are skipped');
  assert.equal(pickDefaultPerson(d, 'Nobody')?.name, 'Cy', 'an unknown wanted name falls back to the rule');
  assert.equal(pickDefaultPerson([dir('Ada', 'Planner'), dir('Bo', undefined)])?.name, 'Ada');
  assert.equal(pickDefaultPerson([]), undefined);
});

test('GET /directory lists the visible directory, nothing else', async () => {
  assert.deepEqual(await svc.call('GET', '/directory'), [], 'an empty store has an empty directory');
  const r = await svc.call('POST', '/demo/reset', { seed: 'synthetic' });
  assert.ok(r.imported.length > 0);
  directory = await svc.call('GET', '/directory');
  assert.ok(directory.length > 3);
  for (const e of directory) {
    assert.deepEqual(Object.keys(e).filter((k) => !['personEntityId', 'name', 'role', 'groups', 'available'].includes(k)), [], 'only the documented fields');
    assert.ok(Array.isArray(e.groups) && typeof e.available === 'boolean');
  }
});

test('demo reset sets the current person: requested, else field role, else first; the chosen id is returned', async () => {
  const wanted = directory[directory.length - 1]!;
  const named = await svc.call('POST', '/demo/reset', { seed: 'synthetic', defaultPerson: wanted.name });
  assert.equal(named.defaultPersonEntityId, wanted.personEntityId);
  assert.equal((await svc.call('GET', '/settings')).currentPersonEntityId, wanted.personEntityId);

  const dflt = await svc.call('POST', '/demo/reset', { seed: 'synthetic' });
  const expected = pickDefaultPerson(directory)!;
  assert.equal(dflt.defaultPersonEntityId, expected.personEntityId);
  assert.equal((await svc.call('GET', '/settings')).currentPersonEntityId, expected.personEntityId);
  assert.ok(directory.some((e) => e.personEntityId === dflt.defaultPersonEntityId));

  const empty = await svc.call('POST', '/demo/reset', { seed: 'empty' });
  assert.equal(empty.defaultPersonEntityId, undefined, 'no directory, no invented person');
  assert.equal((await svc.call('GET', '/settings')).currentPersonEntityId, '', 'a stale current person is cleared');
  await svc.call('POST', '/demo/reset', { seed: 'synthetic', defaultPerson: '' }, 400);
  await svc.call('POST', '/demo/reset', { seed: 'synthetic' });
});

test('a guest can investigate but never answers: only the question recipient does', async () => {
  const r = await svc.call('POST', '/investigate', { text: TEXT, principal: GUEST });
  assert.match(r.investigationId, /^inv_/);
  const q = r.question as QuestionView | undefined;
  assert.ok(q, 'the lookalike has a consequential gap, so a question is opened for someone else');
  const qid = encodeURIComponent(q.questionId);
  const rec = svc.engine.store.get('question', q.questionId)!;
  assert.notEqual(rec.personEntityId, GUEST.id, 'the guest is never the recipient');
  for (const action of ['answer', 'defer', 'dismiss', 'undo']) {
    await svc.call('POST', `/questions/${qid}/${action}`, { principal: GUEST, ...(action === 'answer' ? { value: 'yes' } : {}) }, 403);
  }
  const other = directory.find((d) => d.personEntityId !== rec.personEntityId)!;
  await svc.call('POST', `/questions/${qid}/answer`, { principal: human(other.personEntityId, other.name, other.groups), value: 'yes' }, 403);
  const person = svc.engine.store.get('entity', rec.personEntityId)!;
  const ok = await svc.call('POST', `/questions/${qid}/answer`, { principal: human(person.id, person.name), value: 'no' });
  assert.equal(ok.question.status, 'answered');
  // The guest sees no one's queue: a listing for the guest id is empty.
  assert.deepEqual(await svc.call('GET', `/questions?personEntityId=${encodeURIComponent(GUEST.id)}`), []);
});

test('result view carries loopReason; the answer receipt never prints a raw recommendation kind', async () => {
  const r = await svc.call('POST', '/investigate', { text: TEXT, principal: GUEST });
  if (!r.question) assert.equal(typeof r.loopReason, 'string', 'no question means a reason is shown');
  else assert.equal(r.loopReason, undefined);
  const q = r.question as QuestionView | undefined;
  if (!q) return;
  const rec = svc.engine.store.get('question', q.questionId)!;
  const person = svc.engine.store.get('entity', rec.personEntityId)!;
  const ans = await svc.call('POST', `/questions/${encodeURIComponent(q.questionId)}/answer`, { principal: human(person.id, person.name), value: 'yes' });
  assert.doesNotMatch(ans.receipt.detail, /retain-uncertainty|check-first|"qualified"/);
});
