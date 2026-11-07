/** BUILD_BRIEF 5.1-5.4: the store metric, the measured reward and live learning (no model, no network). */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { EvaluationRecord, Principal, Selector } from '../src/libs/utils/contracts/index.ts';
import { Engine } from '../src/apps/service/engine.ts';
import { RulesSelector } from '../src/libs/utils/policies/index.ts';
import { buildSyntheticStore, SYMPTOM_TEXT } from '../src/libs/utils/models/testing/fixtures.ts';
import { makeHarness } from '../src/libs/utils/questions/testing/harness.ts';
import { expectedGain, storeHealth } from '../src/libs/utils/memory/index.ts';
import { openStore } from '../src/libs/utils/memory/index.ts';
import { DEV_FIXTURE } from './support.ts';

const NOW = new Date('2026-11-07T12:00:00.000Z');
const REQ: Principal = { id: 'person:test:req2', displayName: 'Rune Requester', groups: ['noc'], type: 'human' };
const PROBLEM = 'BGP flaps after firmware upgrade on edge router RTR-300 unit';

function engine(extra: ConstructorParameters<typeof Engine>[0] = {}): Engine {
  const e = new Engine({ dbPath: ':memory:', clock: () => NOW, ...extra });
  e.importData({ format: 'scenario-dir', path: DEV_FIXTURE });
  return e;
}

async function askAndAnswer(e: Engine, value: 'yes' | 'no' | 'unknown') {
  const r = await e.investigate({ text: PROBLEM, principal: REQ });
  assert.ok(r.question, 'the dev fixture opens a question');
  const q = e.store.get('question', r.question.questionId)!;
  const person = e.store.get('entity', q.personEntityId)!;
  const a = await e.answer(q.id, { principal: { id: person.id, displayName: person.name, groups: [], type: 'human' }, value });
  return { q, a };
}

test('store health on the dev fixture: six slots per case, singletons, thin pairs and every denominator', () => {
  const e = engine();
  try {
    const h = e.storeHealth();
    assert.equal(h.denominators.cases, 2);
    assert.equal(h.cases.length, 2);
    const rtr117 = h.cases.find((c) => c.title.startsWith('RTR-117'))!;
    assert.deepEqual(rtr117.slots, { symptom: 1, distinguishing: 0.25, attempt: 1, outcome: 1, lasting: 0, validity: 0 });
    assert.equal(rtr117.completeness, 0.5417);
    assert.equal(rtr117.singleton, false);
    // nothing retrieved yet: the weighted mean is the unweighted one, and says so through retrievals 0
    assert.equal(h.denominators.retrievals, 0);
    assert.equal(h.completeness, h.completenessUnweighted);
    assert.equal(h.denominators.windowDays, 30);
    assert.ok(h.denominators.caseClaims > 0);
    assert.equal(h.correctness, Math.round(((h.denominators.supportedClaims - h.denominators.contradictedCited - h.denominators.linksWithoutAnswer) / h.denominators.caseClaims) * 10_000) / 10_000);
    assert.equal(h.singletons, h.cases.filter((c) => c.singleton).length);
    assert.equal(h.thinPairs, h.cases.filter((c) => c.thinPair).length);
    // an empty store has no correctness (unknown, never zero)
    assert.equal(storeHealth(openStore(':memory:'), undefined, { now: NOW }).correctness, null);
  } finally {
    e.close();
  }
});

test('reward: an answer writes the measured benefit (store-metric-delta@1) on the evaluation and the question; retrievals weight the store mean', async () => {
  const e = engine();
  try {
    const { q, a } = await askAndAnswer(e, 'yes');
    const ev = e.store.get('evaluation', q.decisionId) as EvaluationRecord;
    assert.ok(ev.assessedBenefit);
    assert.equal(ev.assessedBenefit.method, 'store-metric-delta@1');
    const r = a.question.reward!;
    assert.equal(r.method, 'store-metric-delta@1');
    assert.equal(r.value, ev.assessedBenefit.value);
    assert.equal(r.delta, Math.round((r.after - r.before) * 10_000) / 10_000);
    assert.equal(r.value, Math.round((r.delta - r.burden) * 10_000) / 10_000);
    assert.ok(r.after > r.before, 'a yes adds independent support to the case');
    assert.deepEqual(r.cases, [q.candidate.scope.caseId]);
    assert.ok(e.storeHealth().denominators.retrievals >= 1);
  } finally {
    e.close();
  }
});

test('reward: no answer (dismissed: response none) leaves the benefit null, never zero', async () => {
  const e = engine();
  try {
    const r = await e.investigate({ text: PROBLEM, principal: REQ });
    const q = e.store.get('question', r.question!.questionId)!;
    const person = e.store.get('entity', q.personEntityId)!;
    await e.dismiss(q.id, { principal: { id: person.id, displayName: person.name, groups: [], type: 'human' } });
    assert.equal((e.store.get('evaluation', q.decisionId) as EvaluationRecord).assessedBenefit, null);
    assert.equal(e.store.get('question', q.id)!.reward, undefined);
  } finally {
    e.close();
  }
});

test('reward: the coordinator calls selector.update with a non-null benefit (spy selector over the rules prior)', async () => {
  const seen: EvaluationRecord[] = [];
  const rules = new RulesSelector({ clock: () => NOW });
  const spy: Selector = { id: 'spy', version: '1', route: 'rules', select: (c) => rules.select(c), update: (records) => { seen.push(...records); } };
  const h = makeHarness(buildSyntheticStore(), { selector: spy });
  const st = await h.start('p_reward', `Asset-B2: ${SYMPTOM_TEXT}`);
  const req = await h.coordinator.request(st);
  assert.ok(req.question);
  const person = h.store.get('entity', req.question.personEntityId)!;
  await h.coordinator.answer(req.question.id, 'no', { id: person.id, displayName: person.name, groups: ['noc', 'field'], type: 'human' });
  assert.equal(seen.length, 1);
  assert.ok(seen[0]!.assessedBenefit !== null);
  assert.equal(seen[0]!.assessedBenefit!.method, 'store-metric-delta@1');
  assert.equal(typeof seen[0]!.assessedBenefit!.value, 'number');
  assert.equal(seen[0]!.decisionId, req.question.decisionId);
});

test('live LinUCB: learns from the measured reward, persists to the state file and loads it back after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-linucb-'));
  const path = join(dir, 'linucb-live.json');
  try {
    const e = engine({ linucbStatePath: path });
    e.putSettings({ selectorId: 'linucb' });
    await askAndAnswer(e, 'yes');
    e.close();
    assert.ok(existsSync(path));
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.kind, 'linucb');
    assert.equal(saved.parameters.updates, 1);
    assert.equal(saved.trainingDataset.id, 'live');
    const e2 = engine({ linucbStatePath: path });
    e2.putSettings({ selectorId: 'linucb' });
    const r = await e2.investigate({ text: PROBLEM, principal: REQ });
    const d = e2.store.get('decision', r.state.decisionIds.at(-1)!)!;
    assert.match(d.reason, /after 1 updates/);
    e2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reward: for an outcome question the same record is measured again when the outcome lands', async () => {
  const seen: number[] = [];
  const e = engine();
  try {
    const { q, a } = await askAndAnswer(e, 'yes');
    assert.match(q.candidate.gapId, /outcome/);
    const first = a.question.reward!;
    await e.recordOutcome({ principal: REQ, investigationId: q.candidate.investigationId, caseId: q.candidate.scope.caseId!, result: 'recovered', lasting: 'confirmed' });
    const again = e.store.get('question', q.id)!.reward!;
    seen.push(first.after, again.after);
    assert.ok(again.outcomeAt);
    assert.ok(again.after > first.after, `lasting is now known (${seen.join(' -> ')})`);
    assert.equal(again.before, first.before);
    assert.equal((e.store.get('evaluation', q.decisionId) as EvaluationRecord).assessedBenefit!.value, again.value);
  } finally {
    e.close();
  }
});

test('reward: an unmeasurable store metric (no case, no case claim) gives no reward; the benefit stays null and the selector learns nothing', async () => {
  const seen: EvaluationRecord[] = [];
  const rules = new RulesSelector({ clock: () => NOW });
  const spy: Selector = { id: 'spy', version: '1', route: 'rules', select: (c) => rules.select(c), update: (records) => { seen.push(...records); } };
  const h = makeHarness(buildSyntheticStore(), { selector: spy });
  assert.equal(h.coordinator.measure([]), null);
  assert.equal(h.coordinator.measure(['case:none']), null);
  const st = await h.start('p_reward_null', `Asset-B2: ${SYMPTOM_TEXT}`);
  const req = await h.coordinator.request(st);
  assert.ok(req.question);
  h.coordinator.measure = () => null;
  const person = h.store.get('entity', req.question.personEntityId)!;
  const a = await h.coordinator.answer(req.question.id, 'no', { id: person.id, displayName: person.name, groups: ['noc', 'field'], type: 'human' });
  assert.equal(a.question.reward, undefined);
  assert.equal((h.store.get('evaluation', req.question.decisionId) as EvaluationRecord).assessedBenefit, null);
  assert.equal(seen.length, 0);
});

test('live LinUCB: an outcome re-measurement corrects b without observing the decision a second time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-linucb-'));
  const path = join(dir, 'linucb-live.json');
  const e = engine({ linucbStatePath: path });
  try {
    e.putSettings({ selectorId: 'linucb' });
    const { q, a } = await askAndAnswer(e, 'yes');
    const s1 = JSON.parse(readFileSync(path, 'utf8')).parameters;
    assert.equal(s1.updates, 1);
    await e.recordOutcome({ principal: REQ, investigationId: q.candidate.investigationId, caseId: q.candidate.scope.caseId!, result: 'recovered', lasting: 'confirmed' });
    const again = e.store.get('question', q.id)!.reward!;
    assert.notEqual(again.value, a.question.reward!.value);
    const s2 = JSON.parse(readFileSync(path, 'utf8')).parameters;
    assert.equal(s2.updates, 1, 'one decision, one observation');
    assert.deepEqual(s2.aInv, s1.aInv, 'the exposure is not counted twice');
    assert.notDeepEqual(s2.b, s1.b, 'the reward difference moves b');
  } finally {
    e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('§5.2 through the engine (D-B6-29): a confirmed case link without an answer lowers correctness by one claim; one with its answer does not', () => {
  const e = engine();
  try {
    const before = e.storeHealth();
    assert.equal(before.denominators.linksWithoutAnswer, 0);
    const [a, b] = e.store.list('case').map((c) => c.id);
    const base = { orgId: e.store.list('case')[0]!.orgId, title: 'link', caseIds: [a!, b!], sharedConditions: [], distinguishingConditions: [], createdBy: { route: 'test', version: '1' }, status: 'confirmed' as const };
    e.store.put('pattern', { ...base, id: 'pattern:test:answered', answerId: 'answer:test:1' });
    assert.equal(e.storeHealth().correctness, before.correctness, 'a link with its answer costs nothing');
    e.store.put('pattern', { ...base, id: 'pattern:test:unanswered' });
    const after = e.storeHealth();
    assert.equal(after.denominators.linksWithoutAnswer, 1);
    const d = after.denominators;
    assert.equal(after.correctness, Math.round(((d.supportedClaims - d.contradictedCited - 1) / d.caseClaims) * 10_000) / 10_000);
    assert.ok(after.correctness! < before.correctness!);
  } finally {
    e.close();
  }
});

test('§5.2 without the engine (review of D-B2-66..68): storeHealth counts unanswered pairing links itself, so the coordinator\'s reward and E10 see the term too', () => {
  const e = engine();
  try {
    const [a, b] = e.store.list('case').map((c) => c.id);
    const plain = (ids?: string[]) => storeHealth(e.store, undefined, { now: NOW, ...(ids ? { caseIds: ids } : {}) });
    const before = plain([a!]);
    assert.equal(before.denominators.linksWithoutAnswer, 0);
    const base = { orgId: e.store.list('case')[0]!.orgId, title: 'link', caseIds: [a!, b!], sharedConditions: [], distinguishingConditions: [], createdBy: { route: 'test', version: '1' }, status: 'confirmed' as const };
    e.store.put('pattern', { ...base, id: 'pattern:test:answered', answerId: 'answer:test:1' });
    assert.equal(plain([a!]).denominators.linksWithoutAnswer, 0, 'a link with its answer costs nothing');
    e.store.put('pattern', { ...base, id: 'pattern:test:unanswered' });
    e.store.put('pattern', { ...base, id: 'pattern:test:candidate', status: 'candidate' });
    assert.equal(plain([a!]).denominators.linksWithoutAnswer, 1, 'the touched case is linked without an answer');
    assert.equal(plain().denominators.linksWithoutAnswer, 1);
    const other = e.store.list('case').map((c) => c.id).find((id) => id !== a && id !== b);
    if (other) assert.equal(plain([other]).denominators.linksWithoutAnswer, 0, 'a case outside the link is not charged');
    assert.equal(storeHealth(e.store, undefined, { now: NOW, links: () => ({ made: 0, withoutAnswer: 0 }) }).denominators.linksWithoutAnswer, 0, 'an explicit hook still wins');
  } finally {
    e.close();
  }
});

// ---- D-B2-66: an applicability answer scopes the case; only an answer about the claim itself counts for correctness ----

const B2 = `Asset-B2: ${SYMPTOM_TEXT}`;
const REF = 'case_ref_reset';
const health = (store: Parameters<typeof storeHealth>[0], caseIds = [REF]) => storeHealth(store, undefined, { now: NOW, caseIds });

test('D-B2-66: a "No" to an applicability question is not a contradiction; the lookalike stops being cited for this unit and correctness does not fall', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p_app_no', B2);
  const req = await h.coordinator.request(st);
  assert.match(req.question!.candidate.gapId, /\|missing\|case_ref_reset\|unit\.age$/);
  const before = health(h.store);
  const person = h.store.get('entity', req.question!.personEntityId)!;
  const a = await h.coordinator.answer(req.question!.id, 'no', { id: person.id, displayName: person.name, groups: ['noc', 'field'], type: 'human' });
  // The coordinator still records the scoped-down applicability on the claim (its own note: the claim is unchanged) ...
  assert.equal(a.answer.claimUpdates[0]?.change, 'contradict');
  // ... the case is not cited for this unit any more ...
  assert.equal(a.state.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))?.applicability, 'inapplicable');
  // ... and the store metric does not read it as a contradicted claim.
  const after = health(h.store);
  assert.equal(after.denominators.contradictedCited, 0);
  assert.equal(after.correctness, before.correctness);
  assert.ok(after.cases[0]!.slots.distinguishing >= before.cases[0]!.slots.distinguishing);
  assert.ok(a.question.reward!.delta >= 0, `delta ${a.question.reward!.delta} is never negative for an applicability No`);
});

test('D-B2-66: a "Yes" to an applicability question records the value but is not a second source for the case\'s claims', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p_app_yes', B2);
  const req = await h.coordinator.request(st);
  const before = health(h.store);
  const person = h.store.get('entity', req.question!.personEntityId)!;
  const a = await h.coordinator.answer(req.question!.id, 'yes', { id: person.id, displayName: person.name, groups: ['noc', 'field'], type: 'human' });
  assert.equal(a.answer.claimUpdates[0]?.change, 'support');
  assert.ok(h.store.list('observation').some((o) => o.caseId === REF && o.condition.key === 'unit.age'), 'the answer is recorded on the case');
  const after = health(h.store);
  assert.equal(after.denominators.supportedClaims, before.denominators.supportedClaims);
  assert.equal(after.cases[0]!.slots.distinguishing, before.cases[0]!.slots.distinguishing, 'unit.age was already recorded on the case');
});

test('D-B2-66: the same contradicting answer counts against correctness when it is about the claim (an outcome) and a recommendation still cites the claim', async () => {
  const h = makeHarness(buildSyntheticStore());
  // A1 is the reference case's own unit: its investigation cites cl_c1_hyp with a standing recommendation.
  const a1 = await h.start('p_a1', `Asset-A1: ${SYMPTOM_TEXT}`);
  h.store.put('investigation', a1);
  assert.ok(!['none', 'retain-uncertainty'].includes(a1.recommendation.kind));
  assert.ok(a1.hypotheses.some((x) => x.applicability !== 'inapplicable' && x.sourceClaimIds.includes('cl_c1_hyp')));
  const st = await h.start('p_app_no2', B2);
  const req = await h.coordinator.request(st);
  const person = h.store.get('entity', req.question!.personEntityId)!;
  const res = await h.coordinator.answer(req.question!.id, 'no', { id: person.id, displayName: person.name, groups: ['noc', 'field'], type: 'human' });
  // Aim the contradiction at the claim A1's recommendation cites, so only the reading differs below.
  h.store.put('answer', { ...res.answer, claimUpdates: res.answer.claimUpdates.map((u) => ({ ...u, claimId: 'cl_c1_hyp' })) });
  const applicability = health(h.store);
  assert.equal(applicability.denominators.contradictedCited, 0, 'an applicability No while A1 still cites the claim: not a contradiction');
  // Read the very same answer as an outcome report ("did it recover?" No): now it contradicts a cited claim.
  const q = h.store.get('question', req.question!.id)!;
  h.store.put('question', { ...q, candidate: { ...q.candidate, gapId: q.candidate.gapId.replace('|missing|', '|outcome|').replace(/unit\.age$/, 'at_c1_reset') } });
  const outcome = health(h.store);
  assert.equal(outcome.denominators.contradictedCited, 1);
  assert.ok(outcome.correctness! < applicability.correctness!);
});

test('D-B2-66: an answered applicability question fills the distinguishing slot for a key the case never recorded (approximates brief 5.1\'s "explicit not applicable", D-B2-75)', () => {
  const store = buildSyntheticStore();
  const before = health(store);
  store.put('observation', {
    id: 'obs:test:model', orgId: store.get('case', REF)!.orgId, investigationId: 'inv:test', caseId: REF, at: NOW.toISOString(), reportedBy: { id: 'actor:test', displayName: 'Test' },
    condition: { key: 'unit.model', operator: 'eq', value: '__answer:differs-from-case', origin: 'reported', evidence: [], label: 'model: no (answered)' },
  });
  const after = health(store);
  assert.equal(after.cases[0]!.slots.distinguishing, before.cases[0]!.slots.distinguishing + 0.25);
  assert.ok(after.cases[0]!.completeness > before.cases[0]!.completeness);
});

test('D-B2-66: on the demo store a useful answer measures a positive delta, and neither answer to the question measures a negative one', async () => {
  const deltas: Record<string, number> = {};
  for (const value of ['yes', 'no'] as const) {
    const e = new Engine({ dbPath: ':memory:', clock: () => NOW, linucbStatePath: false, elisaDir: join(DEV_FIXTURE, '__no-elisa__') });
    try {
      const reset = await e.resetDemo('synthetic');
      const d = e.directory().find((x) => x.personEntityId === reset.defaultPersonEntityId)!;
      const r = await e.investigate({ text: PROBLEM, principal: { id: d.personEntityId, displayName: d.name, groups: d.groups, type: 'human' } });
      assert.ok(r.question, 'the demo store opens a question');
      const q = e.store.get('question', r.question.questionId)!;
      const person = e.store.get('entity', q.personEntityId)!;
      const a = await e.answer(q.id, { principal: { id: person.id, displayName: person.name, groups: [], type: 'human' }, value });
      deltas[value] = a.question.reward!.delta;
    } finally {
      e.close();
    }
  }
  assert.ok(deltas.yes! > 0, `yes: ${deltas.yes}`);
  assert.ok(deltas.no! >= 0, `no: ${deltas.no}`);
});

// ---- D-B2-67: brief 5.3 value / cost through the coordinator ----

test('D-B2-67: the coordinator measures each candidate\'s expected gain and retrieval weight; on RTR-203 the outcome question outranks the applicability one', async () => {
  const e = engine();
  try {
    const text = 'BGP sessions flapping on RTR-203 after the firmware update';
    const r = await e.investigate({ text, principal: REQ });
    assert.ok(r.question);
    const d = e.store.get('decision', r.state.decisionIds.at(-1)!)!;
    assert.equal(d.eligible.length >= 2, true, 'two candidates (software version, outcome) are eligible');
    const f = d.features!;
    assert.match(e.store.get('question', r.question.questionId)!.candidate.gapId, /\|outcome\|/);
    // the outcome report would make the unsupported advice claim supported: gain = c x 1/n on RTR-117
    const h = storeHealth(e.store, undefined, { now: NOW, caseIds: [e.store.get('question', r.question.questionId)!.candidate.scope.caseId!] });
    assert.ok(f.expectedGain! > 0);
    const c = h.cases[0]!;
    assert.equal(f.expectedGain, expectedGain({ kind: 'outcome', completeness: c.completeness, correctness: h.correctness, caseClaims: h.denominators.caseClaims, slots: c.slots, distinguishingKeys: 4, targetSupported: false }));
    assert.equal(f.retrievalWeight, 1, 'the case is being retrieved right now (+1); no earlier retrieval');
    assert.equal(f.quietHours, 0);
    assert.match(d.reason, /value\/cost/);
    // A second requester asks about RTR-117's lookalike: the case was retrieved once before, so its weight is 2.
    const other: Principal = { id: 'person:test:req3', displayName: 'Oona Other', groups: ['noc'], type: 'human' };
    const r2 = await e.investigate({ text: 'BGP flaps after firmware upgrade on edge router RTR-300 unit', principal: other });
    const d2 = e.store.get('decision', r2.state.decisionIds.at(-1)!)!;
    assert.ok(d2.features, 'a pair was chosen for the second problem');
    assert.equal(d2.features.retrievalWeight, 2);
  } finally {
    e.close();
  }
});
