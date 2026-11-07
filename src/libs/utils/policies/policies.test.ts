import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EligibleAction, InvestigationState, SelectorContext } from '../contracts/index.ts';
import { hashInput, ReplayProvider } from '../models/replay.ts';
import { defaultSimConfig, runSimulation, SelectionSimulator } from '../models/testing/simulator.ts';
import {
  actionKey, createSelector, EpsilonGreedy, LinUcb, randomSelector, RankerReplaySelector, rankerInputHash, RulesSelector, type RecordedRanking,
} from './index.ts';

const clock = () => new Date('2026-11-07T12:00:00.000Z');
const state = { id: 'inv_t', orgId: 'org:t' } as InvestigationState;
const act = (q: string, p: string): EligibleAction => ({ questionId: q, personEntityId: p });
const ctx = (eligible: EligibleAction[], features: Record<string, Record<string, number>>): SelectorContext => ({ state, eligible, candidates: [], features });

test('rules selector: firsthand beats non-firsthand, open load lowers score, ties are deterministic', () => {
  const a = act('q1', 'pA'), b = act('q1', 'pB'), c = act('q1', 'pC');
  const sel = new RulesSelector({ clock });
  const d = sel.select(ctx([b, a, c], {
    [actionKey(a)]: { consequential: 1, firsthand: 1, recipientOpenQuestions: 1 },
    [actionKey(b)]: { consequential: 1, firsthand: 1, recipientOpenQuestions: 0 },
    [actionKey(c)]: { consequential: 1, firsthand: 0, recipientOpenQuestions: 0 },
  }));
  assert.deepEqual(d.chosen, b);
  assert.equal(d.propensity, 1);
  assert.equal(d.selector.route, 'rules');
  const again = sel.select(ctx([c, b, a], d.features ? { [actionKey(a)]: { consequential: 1, firsthand: 1, recipientOpenQuestions: 1 }, [actionKey(b)]: { consequential: 1, firsthand: 1, recipientOpenQuestions: 0 }, [actionKey(c)]: { consequential: 1, firsthand: 0 } } : {}));
  assert.deepEqual(again.chosen, b);
});

test('rules selector defers when nothing is eligible or the best score is below threshold', () => {
  const sel = new RulesSelector({ clock, threshold: 0.2 });
  assert.equal(sel.select(ctx([], {})).chosen, 'defer');
  const a = act('q', 'p');
  assert.equal(sel.select(ctx([a], { [actionKey(a)]: { consequential: 0, firsthand: 1 } })).chosen, 'defer');
  assert.equal(sel.select(ctx([a], { [actionKey(a)]: { consequential: 1, firsthand: 0, recipientOpenQuestions: 4 } })).chosen, 'defer');
});

test('(8) LinUCB beats epsilon-greedy and random on mean benefit over 300 steps for 3 seeds and never selects an ineligible action', () => {
  const means = { linucb: 0, eps: 0, rnd: 0 };
  for (const seed of [1, 2, 3]) {
    const l = runSimulation(new LinUcb({ alpha: 0.5, clock }), { seed, steps: 300 });
    const e = runSimulation(new EpsilonGreedy({ epsilon: 0.1, seed, clock }), { seed, steps: 300 });
    const r = runSimulation(randomSelector(seed, clock), { seed, steps: 300 });
    for (const res of [l, e, r]) {
      assert.equal(res.ineligibleSelections, 0);
      for (const rec of res.records) if (rec.action !== 'defer') assert.ok(rec.eligible.some((x) => actionKey(x) === actionKey(rec.action as EligibleAction)));
    }
    assert.ok(l.meanBenefit > e.meanBenefit, `seed ${seed}: linucb ${l.meanBenefit} vs eps ${e.meanBenefit}`);
    assert.ok(l.meanBenefit > r.meanBenefit, `seed ${seed}: linucb ${l.meanBenefit} vs random ${r.meanBenefit}`);
    means.linucb += l.meanBenefit / 3;
    means.eps += e.meanBenefit / 3;
    means.rnd += r.meanBenefit / 3;
  }
  assert.ok(means.linucb > means.eps && means.linucb > means.rnd);
});

test('simulator keeps hidden knowledge out of features and selection inputs', () => {
  const cfg = defaultSimConfig(5);
  const sim = new SelectionSimulator(cfg);
  const s = sim.situation(0);
  const allowed = new Set(['consequential', 'firsthand', 'recipientOpenQuestions', 'recipientAskedToday', 'candidateCount', 'gapDecidesApplicability', 'hypothesisSupportLevel', 'recency']);
  for (const f of Object.values(s.features)) for (const k of Object.keys(f)) assert.ok(allowed.has(k), k);
  const json = JSON.stringify(sim.context(s));
  assert.ok(!json.includes('knows') && !json.includes('truth') && !json.includes('responsiveness'));
  // reveals are deterministic in (situation, action); unanswered is null, never 0
  const outcomes = s.eligible.map((a) => sim.reveal(s, a));
  assert.deepEqual(outcomes, s.eligible.map((a) => sim.reveal(s, a)));
  assert.ok(outcomes.every((o) => (o.answer === 'none') === (o.benefit === null)));
});

test('LinUCB update skips unknown benefit (null) and never treats it as 0', () => {
  const m = new LinUcb({ clock });
  const base = { decisionId: 'd', investigationId: 'i', at: 'x', stateFeatures: { consequential: 1, firsthand: 1 }, eligible: [], action: act('q', 'p'), propensity: 1, effort: { questionsAsked: 1, interruptions: 1 }, missingFeedback: true };
  m.update([{ ...base, assessedBenefit: null }]);
  assert.equal(m.updates, 0);
  assert.equal(m.skippedUnknown, 1);
  assert.ok(m.b.every((x) => x === 0));
  m.update([{ ...base, assessedBenefit: { value: 1, method: 't' } }, { ...base, action: 'defer', assessedBenefit: { value: 1, method: 't' } }]);
  assert.equal(m.updates, 1);
});

test('(8) LinUCB artifact round-trip preserves parameters and decisions', () => {
  const trained = new LinUcb({ alpha: 0.4, clock });
  runSimulation(trained, { seed: 2, steps: 120 });
  const json = JSON.parse(JSON.stringify(trained.toArtifact()));
  assert.equal(json.kind, 'linucb');
  const loaded = LinUcb.fromArtifact(json, { clock });
  assert.deepEqual(loaded.aInv, trained.aInv);
  assert.deepEqual(loaded.b, trained.b);
  assert.equal(loaded.alpha, 0.4);
  assert.equal(loaded.updates, trained.updates);
  const sim = new SelectionSimulator(defaultSimConfig(2));
  for (let i = 300; i < 320; i++) {
    const s = sim.situation(i);
    assert.deepEqual(loaded.select(sim.context(s)).chosen, trained.select(sim.context(s)).chosen);
  }
  assert.throws(() => LinUcb.fromArtifact({ ...json, kind: 'other' }));
});

test('epsilon-greedy reports a real selection probability; random is uniform', () => {
  const eg = new EpsilonGreedy({ epsilon: 0.2, seed: 3, clock });
  const el = [act('q', 'a'), act('q', 'b'), act('q', 'c'), act('q', 'd')];
  eg.observe('a', 1);
  const f = Object.fromEntries(el.map((a) => [actionKey(a), {}]));
  for (let i = 0; i < 30; i++) {
    const d = eg.select(ctx(el, f));
    const greedy = (d.chosen as EligibleAction).personEntityId === 'a';
    assert.ok(Math.abs(d.propensity - (0.2 / 4 + (greedy ? 0.8 : 0))) < 1e-9);
  }
  const r = randomSelector(1, clock).select(ctx(el, f));
  assert.ok(Math.abs(r.propensity - 0.25) < 1e-9);
});

test('ranker-replay: no recording -> explicit blocked decision made by rules, labelled route rules', () => {
  const a = act('q', 'p');
  const feats = { [actionKey(a)]: { consequential: 1, firsthand: 1 } };
  const sel = new RankerReplaySelector({ clock });
  const d = sel.select(ctx([a], feats));
  assert.match(d.reason, /^blocked:/);
  assert.equal(d.selector.route, 'rules');
  assert.deepEqual(d.chosen, a);
  assert.equal(sel.blockedCount, 1);
  const empty = new RankerReplaySelector({ clock, provider: new ReplayProvider<RecordedRanking>({ id: 'fx', entries: {} }) });
  assert.match(empty.select(ctx([a], feats)).reason, /^blocked:/);
});

test('ranker-replay: plays back a recorded ranking (route replay) and refuses a mismatched input', () => {
  const a = act('q', 'pA'), b = act('q', 'pB');
  const c = ctx([a, b], { [actionKey(a)]: { consequential: 1 }, [actionKey(b)]: { consequential: 1 } });
  const good = new ReplayProvider<RecordedRanking>({ id: 'fx-1', entries: { inv_t: { inputHash: rankerInputHash(c), output: { ranking: [actionKey(b), actionKey(a)] }, recordedBy: 'labelled test recording' } } });
  const d = new RankerReplaySelector({ clock, provider: good }).select(c);
  assert.deepEqual(d.chosen, b);
  assert.equal(d.selector.route, 'replay');
  assert.match(d.selector.version, /^replay:fx-1/);
  const bad = new ReplayProvider<RecordedRanking>({ id: 'fx-2', entries: { inv_t: { inputHash: hashInput({ eligible: ['other'] }), output: { ranking: [actionKey(b)] } } } });
  const blocked = new RankerReplaySelector({ clock, provider: bad }).select(c);
  assert.match(blocked.reason, /blocked: recorded input does not match/);
  assert.equal(blocked.selector.route, 'rules');
});

test('registry maps coordinator selector ids and rejects unknown ones', () => {
  assert.equal(createSelector('rules').id, 'rules');
  assert.equal(createSelector('bandit').id, 'linucb');
  assert.equal(createSelector('ranker').id, 'ranker-replay');
  assert.equal(createSelector('random').id, 'random');
  assert.throws(() => createSelector('nope'));
});
