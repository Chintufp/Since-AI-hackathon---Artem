/**
 * B3: GET /costs ("Erkki's cost") from store records over HTTP, with an explicit clock: questions by status, answer
 * seconds on the engine clock, reuse of a person's knowledge by people and by agents (distinct investigations: a repeated
 * identical request is one reuse, a preview or a point-in-time view is none), and the store line.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpertCostView, QuestionView } from '../src/libs/utils/contracts/index.ts';
import { storeDirectory } from '../src/libs/utils/investigation/index.ts';
import { agent, DEV_FIXTURE, human, startService, type Running } from './support.ts';

let svc: Running;
let now = Date.parse('2026-11-09T09:00:00.000Z');
const requester = human('person:test:req', 'Rune Requester', ['noc']);

before(async () => {
  svc = await startService({ clock: () => new Date(now) });
  await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
});
after(async () => svc.close());

const costs = (personEntityId: string): Promise<ExpertCostView> => svc.call('GET', `/costs?personEntityId=${encodeURIComponent(personEntityId)}`);

test('asked, answered and the seconds between delivery and the answer, on the engine clock', async () => {
  const r = await svc.call('POST', '/investigate', { text: 'BGP flaps after firmware upgrade on edge router RTR-300 unit', principal: requester });
  const q = r.question as QuestionView | undefined;
  assert.ok(q, 'a question opens');
  const person = svc.engine.store.get('entity', svc.engine.store.get('question', q.questionId)!.personEntityId)!;
  const before0 = await costs(person.id);
  assert.equal(before0.asked, 1);
  assert.equal(before0.answered, 0);
  assert.equal(before0.open, 1);
  now += 42_000;
  await svc.call('POST', `/questions/${encodeURIComponent(q.questionId)}/answer`, { principal: human(person.id, person.name), value: 'yes' });
  const c = await costs(person.id);
  assert.equal(c.name, person.name);
  assert.equal(c.asked, 1);
  assert.equal(c.answered, 1);
  assert.equal(c.open, 0);
  assert.equal(c.seconds.total, 42);
  assert.equal(c.seconds.median, 42);
  assert.equal(c.seconds.clock, 'real', 'a host-fixed clock is not the simulated demo clock');
  assert.match(c.line, new RegExp(`^${person.name}: asked 1 · answered 1 · 42 s · reused \\d+`));
  // The default person is the most-asked one.
  assert.equal((await svc.call('GET', '/costs')).personEntityId, person.id);
  // The store line, with its denominators.
  assert.ok(c.storeHealth);
  assert.match(c.storeHealth.line, /^Store: \d+ cases? · completeness \d\.\d\d.* · correctness (\d\.\d\d|unknown) · \d+ singletons? left$/);
  assert.equal(c.storeHealth.denominators.cases, c.storeHealth.cases);
  await svc.call('GET', '/costs?personEntityId=person:nobody', undefined, 404);
});

test('reuse: by people and by agents, a repeated request once, previews and past views never', async () => {
  const text = 'BGP flaps after firmware upgrade on edge router';
  // A preview tells whose knowledge the answer rests on, and stores nothing.
  const peek = await svc.call('POST', '/investigate', { text, principal: requester, allowQuestions: false, preview: true });
  assert.ok(['reuse', 'check-first', 'qualified'].includes(peek.recommendation.kind), peek.recommendation.kind);
  const store = svc.engine.store;
  const dir = storeDirectory(store);
  const authorId = (peek.state.recommendation.basis as Array<{ evidenceId: string }>)
    .map((b) => dir.resolve(store.get('evidence', b.evidenceId)!.author.id)).find((x): x is string => !!x);
  assert.ok(authorId, 'the basis was written by a directory person');
  const base = (await costs(authorId)).reuse;
  await svc.call('POST', '/investigate', { text, principal: requester, allowQuestions: false });
  assert.deepEqual((await costs(authorId)).reuse, { people: base.people + 1, agents: base.agents, total: base.total + 1 });
  // The same request again: the same stable investigation, not a second reuse.
  await svc.call('POST', '/investigate', { text, principal: requester, allowQuestions: false });
  assert.equal((await costs(authorId)).reuse.people, base.people + 1);
  // An agent asks: counted as an agent's reuse.
  await svc.call('POST', '/investigate', { text, principal: agent('agent:test:bot', 'Bot', ['noc']), allowQuestions: false });
  const withAgent = await costs(authorId);
  assert.equal(withAgent.reuse.agents, base.agents + 1);
  assert.equal(withAgent.reuse.total, base.total + 2);
  // Previews (the Context Layer slider) and point-in-time views are not reuse.
  await svc.call('POST', '/investigate', { text, principal: human('person:test:other', 'Olga Other', ['noc']), allowQuestions: false, preview: true });
  await svc.call('POST', '/investigate', { text, principal: human('person:test:other', 'Olga Other', ['noc']), at: '2026-11-08T00:00:00Z' });
  assert.deepEqual((await costs(authorId)).reuse, withAgent.reuse);
});

test('the activity page shows the cost card from GET /costs in the same tick', async () => {
  const res = await fetch(svc.http.url + '/demo/activity.html');
  const html = await res.text();
  assert.match(html, /fetch\('\/costs'/);
  assert.match(html, /id="cost"/);
  assert.doesNotThrow(() => new Function(/<script>([\s\S]*)<\/script>/.exec(html)![1]!));
});
