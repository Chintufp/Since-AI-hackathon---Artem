import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockApi, createMockFetch, MOCK_BASE_URL, mockPrincipal } from './mock-api.ts';
import { createApiClient } from './api-client.ts';
import type { TimelineKind } from '../contracts/views.ts';

const KINDS: TimelineKind[] = ['problem', 'step', 'reported', 'verified', 'unknown'];
const STAGES = ['observation', 'hypothesis', 'check', 'attempt', 'outcome', 'unknown'];

test('the mock answers through the real ApiClient with contract-shaped results', async () => {
  const api = createMockApi();
  const p = mockPrincipal();
  assert.equal(api.kind, 'mock');
  const health = await api.health();
  assert.equal(health.ok, true);
  const settings = await api.getSettings();
  for (const key of ['points', 'sound', 'reducedMotion', 'serverUrl', 'provider', 'model', 'mcp'] as const) assert.ok(key in settings, key);
  assert.equal(settings.provider, 'local');

  const res = await api.investigate({ text: 'anything', principal: p, attachmentNames: ['a.txt'], allowQuestions: true });
  assert.ok(res.investigationId && res.state.id === res.investigationId);
  assert.ok(res.recommendation.text && res.recommendation.applicability && Array.isArray(res.recommendation.caveats));
  assert.ok(res.routes.length > 0 && res.routes.every((r) => r.route && r.version), 'routes are labelled');
  assert.match(res.alternatives?.[0]?.text ?? '', /^Priya Nair advised .+ \(qualified, depends on .+\)$/, 'B5: the mock carries an alternative with its expert');
  assert.ok(!res.routes.some((r) => r.route === 'local'), 'the mock never claims a measured model route');
  for (const node of res.caseView!.timeline) {
    assert.ok(KINDS.includes(node.kind), node.kind);
    assert.ok(STAGES.includes(node.stage), node.stage);
    assert.ok(node.label && node.detail && Array.isArray(node.evidence));
  }
  assert.equal(res.caseView!.timeline[0]!.kind, 'problem');
  assert.equal(res.caseView!.timeline.at(-1)!.kind, 'reported');
  assert.ok(!res.caseView!.timeline.some((n) => n.kind === 'verified'), 'a reported outcome is never presented as verified');
  assert.ok(res.people.some((x) => !x.reasons[0]!.firsthand), 'mentioned-only people are distinguished');
  assert.deepEqual((await api.call('GET /investigations/:id', { params: { id: res.investigationId } })).investigationId, res.investigationId);
  assert.equal((await api.caseView(res.caseView!.caseId)).caseId, res.caseView!.caseId);
});

test('questions: list filters by person, answer/defer/dismiss return receipts, undo restores', async () => {
  const api = createMockApi();
  const p = mockPrincipal();
  const open = await api.questions({ personEntityId: p.id });
  assert.equal(open.length, 2);
  assert.equal((await api.questions({ personEntityId: 'person:someone-else' })).length, 0);
  const q = open[0]!;
  assert.ok(q.text && q.why && q.caseLabel && q.timeline.length > 0 && q.status && typeof q.deferred === 'boolean');

  const answered = await api.answer(q.questionId, { principal: p, value: 'yes' });
  assert.equal(answered.question.status, 'answered');
  assert.equal(answered.answer.value, 'yes');
  assert.equal(answered.receipt.canUndo, true);
  assert.equal(answered.receipt.pointsAwarded, 2, 'R46: the dev user takes part by default; the display switch is the panel\'s business');
  assert.equal((await api.questions({ personEntityId: p.id })).length, 1);

  await api.undo(q.questionId, p);
  assert.equal((await api.questions({ personEntityId: p.id })).length, 2);

  const deferred = await api.defer(q.questionId, p);
  assert.equal(deferred.receipt.title, 'Saved for later');
  assert.equal((await api.question(q.questionId)).deferred, true);
  const dismissed = await api.dismiss(open[1]!.questionId, p);
  assert.equal(dismissed.question.status, 'dismissed');
});

test('R46: points only while the person takes part, never to defer/dismiss; the rating is deterministic and private', async () => {
  const api = createMockApi();
  const p = mockPrincipal();
  const [a, b] = await api.questions({ personEntityId: p.id });
  const r0 = await api.rating(p.id, p.id);
  assert.deepEqual(r0.participants.map((x) => [x.displayName, x.balance, x.rank]), [['Noor Ahmadi', 14, 1], ['Priya Nair', 7, 2], ['Dev User', 5, 3]]);
  assert.equal(r0.me?.rank, 3);
  assert.equal(r0.me?.events.length, 3);
  assert.ok(!JSON.stringify(r0).includes('Tomas'), 'Tomas does not take part');
  await api.setOptIn(p.id, p, false);
  assert.equal((await api.optIn(p.id)).participates, false);
  const none = await api.answer(a!.questionId, { principal: p, value: 'yes' });
  assert.equal(none.receipt.pointsAwarded, undefined, 'not taking part: no points');
  assert.equal((await api.rating(p.id, p.id)).me, null);
  await api.undo(a!.questionId, p);
  await api.setOptIn(p.id, p, true);
  const yes = await api.answer(a!.questionId, { principal: p, value: 'yes' });
  assert.equal(yes.receipt.pointsAwarded, 2);
  assert.equal((await api.rating(p.id, p.id)).me?.balance, 7);
  await api.undo(a!.questionId, p);
  assert.equal((await api.rating(p.id, p.id)).me?.balance, 5, 'undo revokes');
  assert.equal((await api.defer(b!.questionId, p)).receipt.pointsAwarded, undefined);
  await assert.rejects(api.rating('person:mock:noor', 'person:mock:noor'), (e: unknown) => (e as { status?: number }).status === 403);
});

test('contact drafts require review and unknown ids are 404 ApiErrors', async () => {
  const api = createMockApi();
  const p = mockPrincipal();
  const res = await api.investigate({ text: 'x', principal: p });
  const draft = await api.contactDraft({ principal: p, investigationId: res.investigationId, personEntityId: res.people[0]!.personEntityId });
  assert.equal(draft.requiresReview, true);
  assert.ok(draft.body.length > 20 && draft.subject);
  await assert.rejects(api.question('nope'), (e: unknown) => (e as { status?: number }).status === 404);
  await assert.rejects(api.caseView('nope'), (e: unknown) => (e as { status?: number }).status === 404);
});

test('reset restores the seeded questions and settings', async () => {
  const api = createMockApi();
  const p = mockPrincipal();
  const [q] = await api.questions({ personEntityId: p.id });
  await api.putSettings({ points: true });
  await api.dismiss(q!.questionId, p);
  assert.equal((await api.resetDemo()).ok, true);
  assert.equal((await api.questions({ personEntityId: p.id })).length, 2);
  assert.equal((await api.getSettings()).points, false);
});

test('two mock instances do not share state', async () => {
  const a = createMockApi();
  const b = createMockApi();
  await a.putSettings({ points: true });
  assert.equal((await b.getSettings()).points, false);
});

test('mock rejects answers from a non-recipient like the engine', async () => {
  const api = createMockApi();
  const [q] = await api.questions({ personEntityId: mockPrincipal().id });
  await assert.rejects(api.answer(q!.questionId, { principal: { id: 'someone-else', displayName: 'X', groups: [], type: 'human' }, value: 'yes' }));
  const ok = await api.answer(q!.questionId, { principal: mockPrincipal(), value: 'yes' });
  assert.ok(ok.receipt);
});

test('B1: the mock serves GET /context with time positions and validAt at the asked moment', async () => {
  const api = createMockApi();
  const v = await api.context({ entity: 'LP-3', at: '2026-10-01T00:00:00.000Z' });
  assert.equal(v.entity.name, 'LP-3');
  assert.equal(v.assertions[0]!.validFrom.kind, 'time-only');
  assert.equal(v.assertions[0]!.validFrom.iso, undefined);
  assert.equal(v.assertions[1]!.validAt, false, 'the dated note is not valid before its own time');
  await assert.rejects(api.context({ entity: 'nope' }));
});

test('the mock implements the B2 model routes and merges a partial models patch per slot', async () => {
  const api = createMockApi();
  const s = await api.putSettings({ models: { embed: { provider: 'local', model: 'bge-m3' } } });
  assert.deepEqual(s.models, { embed: { provider: 'local', model: 'bge-m3' }, extract: { provider: 'rules' }, phrase: { provider: 'rules' } });
  let v = await api.models();
  assert.equal(v.slots.embed.chip, 'not downloaded');
  assert.equal(v.slots.extract.chip, 'off');
  const job = await api.pullModel('bge-m3');
  assert.equal((await api.pullJob(job.jobId)).state, 'done');
  v = await api.models();
  assert.equal(v.slots.embed.chip, 'ready');
  assert.equal((await api.testModelKey('anthropic')).ok, false);
  assert.deepEqual(await api.setModelKey('anthropic', 'k'), { provider: 'anthropic', present: true });
  assert.equal((await api.testModelKey('anthropic')).ok, true);
});

test('the mock Models view has sizes, a recommended model, a too-large entry and an install route with a log', async () => {
  const api = createMockApi();
  const v = await api.models();
  const embed = v.catalog.embed.find((e) => e.recommended)!;
  assert.equal(embed.model, 'bge-m3');
  assert.ok(embed.sizeBytes && embed.why);
  const big = v.catalog.phrase.find((e) => e.availability === 'too-large')!;
  assert.equal(big.label, 'too large for this Mac');
  assert.ok(big.minRamGb! * 1e9 > v.detection.totalMemBytes!);
  assert.equal((await api.installJob()).state, 'idle');
  const j = await api.installOllama();
  assert.equal(j.state, 'done');
  assert.ok(j.log.length > 0);
  assert.deepEqual(j.setup, ['brew install ollama', 'ollama serve', 'ollama pull bge-m3']);
});

test('the mock matches the service: GET /settings carries the slots, api chips check the model\'s own vendor, and a busy scenario shows downloading and failed chips', async () => {
  const api = createMockApi();
  assert.deepEqual((await api.getSettings()).models, { embed: { provider: 'rules' }, extract: { provider: 'rules' }, phrase: { provider: 'rules' } });
  await api.setModelKey('anthropic', 'k');
  await api.putSettings({ models: { phrase: { provider: 'api', model: 'gemini-2.5-flash-lite' }, extract: { provider: 'api', model: 'claude-haiku-5-5' }, embed: { provider: 'api' } } });
  const v = await api.models();
  assert.equal(v.slots.phrase.chip, 'failed: no gemini key');
  assert.equal(v.slots.extract.chip, 'ready');
  assert.equal(v.slots.embed.chip, 'failed: no hosted embedding model; rules used');

  const fetch = createMockFetch({ models: 'busy' });
  const busy = createApiClient({ baseUrl: MOCK_BASE_URL, fetch, kind: 'mock' });
  const b = await busy.models();
  assert.equal(b.slots.embed.chip, 'downloading 42%');
  assert.equal(b.slots.embed.state, 'downloading');
  assert.equal(b.slots.phrase.chip, 'failed: phrase: no answer within 20000 ms');
  assert.equal(b.slots.extract.chip, 'failed: no gemini key');
  fetch.setModelsScenario('default');
  assert.deepEqual(Object.values((await busy.models()).slots).map((x) => x.chip), ['off', 'off', 'off']);
});
