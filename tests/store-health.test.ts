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
import { storeHealth } from '../src/libs/utils/memory/index.ts';
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
